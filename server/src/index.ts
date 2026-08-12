export interface Env {
  DB: D1Database;
  MEDIA: R2Bucket;
  ALLOWED_ORIGINS?: string;
  AUTH_SECRET?: string;
}

type User = { id: string; email: string; name: string };
type Json = Record<string, unknown>;

const schema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, avatar_url TEXT, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS auth_credentials (user_id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, password_hash TEXT NOT NULL, password_salt TEXT NOT NULL, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reminder_presets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, offsets_json TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', deadline TEXT, reminder_preset_id TEXT, reminder_offsets_json TEXT NOT NULL DEFAULT '[]', category_id TEXT, priority TEXT NOT NULL DEFAULT 'normal', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, completed_at TEXT, deleted_at TEXT, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_presets_user_id ON reminder_presets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user_status_deadline ON todos(user_id, status, deadline)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user_created_at ON todos(user_id, created_at)`,
];

let initialized: Promise<unknown> | null = null;

function corsHeaders(request: Request, env: Env): HeadersInit {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((item) => item.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, PUT, OPTIONS",
    "Vary": "Origin",
  };
}

function response(request: Request, env: Env, value: unknown, status = 200) {
  return Response.json(value, { status, headers: { ...corsHeaders(request, env), "Cache-Control": "no-store" } });
}

const SESSION_COOKIE = "jishi_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;

function bytesToBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function hex(bytes: Uint8Array) { return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(""); }

async function passwordHash(password: string, salt: Uint8Array) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const saltBuffer = Uint8Array.from(salt).buffer;
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBuffer, iterations: 210_000 }, material, 256);
  return hex(new Uint8Array(bits));
}

async function authKey(env: Env) {
  if (!env.AUTH_SECRET || env.AUTH_SECRET.length < 32) throw new Error("AUTH_SECRET 必须至少为 32 个字符");
  return crypto.subtle.importKey("raw", new TextEncoder().encode(env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function createSession(env: Env, user: User) {
  const payload = bytesToBase64Url(new TextEncoder().encode(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + SESSION_SECONDS })));
  const signature = await crypto.subtle.sign("HMAC", await authKey(env), new TextEncoder().encode(payload));
  return `${payload}.${bytesToBase64Url(new Uint8Array(signature))}`;
}

async function sessionUser(request: Request, env: Env): Promise<User | null> {
  const cookie = request.headers.get("cookie") || "";
  const token = cookie.split(/;\s*/).find((item) => item.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  if (!token) return null;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return null;
  try {
    const valid = await crypto.subtle.verify("HMAC", await authKey(env), base64UrlToBytes(signature), new TextEncoder().encode(payload));
    if (!valid) return null;
    const value = JSON.parse(new TextDecoder().decode(base64UrlToBytes(payload))) as User & { exp: number };
    if (!value.id || !value.email || value.exp < Math.floor(Date.now() / 1000)) return null;
    return { id: value.id, email: value.email, name: value.name || value.email.split("@")[0] };
  } catch { return null; }
}

function sessionCookie(request: Request, token: string, maxAge = SESSION_SECONDS) {
  const secure = (request.headers.get("x-forwarded-proto") || new URL(request.url).protocol.replace(":", "")) === "https";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${maxAge === 0 ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT" : ""}${secure ? "; Secure" : ""}`;
}

function authResponse(request: Request, env: Env, value: unknown, cookie: string, status = 200) {
  return Response.json(value, { status, headers: { ...corsHeaders(request, env), "Cache-Control": "no-store", "Set-Cookie": cookie } });
}

async function userFrom(request: Request, env: Env): Promise<User | null> {
  const session = await sessionUser(request, env);
  if (session) return session;
  const email = request.headers.get("oai-authenticated-user-email") || request.headers.get("x-auth-request-email");
  const id = request.headers.get("oai-authenticated-user-id") || email;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const gatewayName = request.headers.get("x-auth-request-user");
  let name = gatewayName || email || "";
  if (!gatewayName && encodedName) { try { name = decodeURIComponent(encodedName); } catch { name = email || ""; } }
  if (id && email) return { id, email, name };
  return null;
}

async function register(request: Request, env: Env) {
  await ensureDb(env);
  const body = await request.json<Json>();
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const name = String(body.name || email.split("@")[0]).trim().slice(0, 24);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 160) return response(request, env, { error: "请输入有效邮箱地址" }, 400);
  if (password.length < 8 || password.length > 128) return response(request, env, { error: "密码长度应为 8 至 128 位" }, 400);
  if (!name) return response(request, env, { error: "请输入昵称" }, 400);
  const exists = await env.DB.prepare("SELECT user_id FROM auth_credentials WHERE email=?").bind(email).first();
  if (exists) return response(request, env, { error: "该邮箱已经注册" }, 409);
  const id = crypto.randomUUID(); const now = new Date().toISOString(); const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await passwordHash(password, salt);
  await env.DB.batch([
    env.DB.prepare("INSERT INTO users (id,email,name,created_at,updated_at) VALUES (?,?,?,?,?)").bind(id, email, name, now, now),
    env.DB.prepare("INSERT INTO auth_credentials (user_id,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?)").bind(id, email, hash, hex(salt), now),
  ]);
  const user = { id, email, name }; const token = await createSession(env, user);
  return authResponse(request, env, { user }, sessionCookie(request, token), 201);
}

async function login(request: Request, env: Env) {
  await ensureDb(env);
  const body = await request.json<Json>(); const email = String(body.email || "").trim().toLowerCase(); const password = String(body.password || "");
  const account = await env.DB.prepare("SELECT a.user_id,a.password_hash,a.password_salt,u.name FROM auth_credentials a JOIN users u ON u.id=a.user_id WHERE a.email=?").bind(email).first<{ user_id: string; password_hash: string; password_salt: string; name: string }>();
  if (!account || (await passwordHash(password, Uint8Array.from(account.password_salt.match(/.{2}/g) || [], (part) => parseInt(part, 16)))) !== account.password_hash) return response(request, env, { error: "邮箱或密码不正确" }, 401);
  const user = { id: account.user_id, email, name: account.name }; const token = await createSession(env, user);
  return authResponse(request, env, { user }, sessionCookie(request, token));
}

async function ensureDb(env: Env) {
  if (!initialized) initialized = env.DB.batch(schema.map((sql) => env.DB.prepare(sql)));
  await initialized;
}

async function prepareUser(env: Env, user: User) {
  await ensureDb(env);
  const now = new Date().toISOString();
  await env.DB.prepare(`INSERT INTO users (id,email,name,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at`).bind(user.id, user.email, user.name, now, now).run();
  const categoryCount = await env.DB.prepare("SELECT COUNT(*) count FROM categories WHERE user_id=?").bind(user.id).first<{ count: number }>();
  if (!categoryCount?.count) {
    await env.DB.batch([["默认", "#9e8d74", 1], ["学习", "#78928a", 0], ["娱乐", "#8d82a6", 0], ["杂项", "#b98572", 0]].map(([name, color, primary]) => env.DB.prepare("INSERT INTO categories (id,user_id,name,color,is_default,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, name, color, primary, now)));
  }
  const presetCount = await env.DB.prepare("SELECT COUNT(*) count FROM reminder_presets WHERE user_id=?").bind(user.id).first<{ count: number }>();
  if (!presetCount?.count) {
    await env.DB.batch([["默认", [720, 360, 180, 10], 1], ["仅 10 分钟前", [10], 0], ["大事件", [10080, 4320, 1440], 0]].map(([name, offsets, primary]) => env.DB.prepare("INSERT INTO reminder_presets (id,user_id,name,offsets_json,is_default,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, name, JSON.stringify(offsets), primary, now)));
  }
}

function todo(row: Json) {
  return { id: row.id, title: row.title, content: row.content, deadline: row.deadline, reminderPresetId: row.reminder_preset_id, reminderOffsets: JSON.parse(String(row.reminder_offsets_json || "[]")), categoryId: row.category_id, priority: row.priority, notes: row.notes, status: row.status, createdAt: row.created_at, completedAt: row.completed_at, deletedAt: row.deleted_at, updatedAt: row.updated_at };
}

async function bootstrap(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  await env.DB.prepare("DELETE FROM todos WHERE user_id=? AND status='deleted' AND deleted_at < datetime('now','-30 days')").bind(user.id).run();
  const [profile, todos, categories, presets] = await Promise.all([
    env.DB.prepare("SELECT id,email,name,avatar_url,settings_json FROM users WHERE id=?").bind(user.id).first<Json>(),
    env.DB.prepare("SELECT * FROM todos WHERE user_id=? ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,deadline ASC,created_at DESC").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT id,name,color,is_default isDefault FROM categories WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT id,name,offsets_json,is_default isDefault FROM reminder_presets WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all<Json>(),
  ]);
  return response(request, env, {
    user: { id: profile?.id, email: profile?.email, name: profile?.name, avatarUrl: profile?.avatar_url, settings: JSON.parse(String(profile?.settings_json || "{}")) },
    todos: todos.results.map(todo), categories: categories.results,
    reminderPresets: presets.results.map((item) => ({ id: item.id, name: item.name, isDefault: item.isDefault, offsets: JSON.parse(String(item.offsets_json || "[]")) })),
  });
}

async function createTodo(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  const body = await request.json<Json>();
  const title = String(body.title || "").trim();
  if (!title || title.length > 60) return response(request, env, { error: "标题应为 1 至 60 个字" }, 400);
  const now = new Date().toISOString(); const id = crypto.randomUUID();
  const presetId = body.reminderPresetId ? String(body.reminderPresetId) : null;
  const preset = presetId ? await env.DB.prepare("SELECT offsets_json FROM reminder_presets WHERE id=? AND user_id=?").bind(presetId, user.id).first<{ offsets_json: string }>() : null;
  await env.DB.prepare("INSERT INTO todos (id,user_id,title,content,deadline,reminder_preset_id,reminder_offsets_json,category_id,priority,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)").bind(id, user.id, title, String(body.content || ""), body.deadline || null, presetId, preset?.offsets_json || "[]", body.categoryId || null, body.priority || "normal", String(body.notes || ""), now, now).run();
  const row = await env.DB.prepare("SELECT * FROM todos WHERE id=?").bind(id).first<Json>();
  return response(request, env, { todo: todo(row || {}) }, 201);
}

async function updateTodo(request: Request, env: Env, user: User, id: string) {
  await prepareUser(env, user); const body = await request.json<Json>();
  const current = await env.DB.prepare("SELECT * FROM todos WHERE id=? AND user_id=?").bind(id, user.id).first<Json>();
  if (!current) return response(request, env, { error: "待办不存在" }, 404);
  const pick = (camel: string, snake: string) => body[camel] === undefined ? current[snake] : body[camel];
  const title = String(pick("title", "title") || "").trim(); if (!title || title.length > 60) return response(request, env, { error: "标题应为 1 至 60 个字" }, 400);
  const status = String(pick("status", "status")); const now = new Date().toISOString();
  let completedAt = current.completed_at; let deletedAt = current.deleted_at;
  if (status === "completed" && current.status !== "completed") completedAt = now;
  if (status === "deleted" && current.status !== "deleted") deletedAt = now;
  if (status === "active") { completedAt = null; deletedAt = null; }
  const presetId = pick("reminderPresetId", "reminder_preset_id");
  const preset = presetId ? await env.DB.prepare("SELECT offsets_json FROM reminder_presets WHERE id=? AND user_id=?").bind(presetId, user.id).first<{ offsets_json: string }>() : null;
  await env.DB.prepare("UPDATE todos SET title=?,content=?,deadline=?,reminder_preset_id=?,reminder_offsets_json=?,category_id=?,priority=?,notes=?,status=?,completed_at=?,deleted_at=?,updated_at=? WHERE id=? AND user_id=?").bind(title, pick("content", "content") || "", pick("deadline", "deadline") || null, presetId || null, preset?.offsets_json || "[]", pick("categoryId", "category_id") || null, pick("priority", "priority") || "normal", pick("notes", "notes") || "", status, completedAt, deletedAt, now, id, user.id).run();
  const row = await env.DB.prepare("SELECT * FROM todos WHERE id=?").bind(id).first<Json>();
  return response(request, env, { todo: todo(row || {}) });
}

async function categories(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  if (request.method === "POST") { const body = await request.json<Json>(); const name = String(body.name || "").trim(); if (!name || name.length > 12) return response(request, env, { error: "分类名称应为 1 至 12 个字" }, 400); const category = { id: crypto.randomUUID(), name, color: String(body.color || "#8d82a6"), isDefault: 0 }; await env.DB.prepare("INSERT INTO categories (id,user_id,name,color,is_default,created_at) VALUES (?,?,?,?,0,?)").bind(category.id, user.id, name, category.color, new Date().toISOString()).run(); return response(request, env, { category }, 201); }
  const id = new URL(request.url).searchParams.get("id"); if (!id) return response(request, env, { error: "缺少分类 ID" }, 400);
  const target = await env.DB.prepare("SELECT is_default FROM categories WHERE id=? AND user_id=?").bind(id, user.id).first<{ is_default: number }>(); if (!target || target.is_default) return response(request, env, { error: "默认分类不能删除" }, 400);
  const fallback = await env.DB.prepare("SELECT id FROM categories WHERE user_id=? AND is_default=1").bind(user.id).first<{ id: string }>();
  await env.DB.batch([env.DB.prepare("UPDATE todos SET category_id=? WHERE user_id=? AND category_id=?").bind(fallback?.id || null, user.id, id), env.DB.prepare("DELETE FROM categories WHERE id=? AND user_id=?").bind(id, user.id)]); return response(request, env, { ok: true });
}

async function createPreset(request: Request, env: Env, user: User) {
  await prepareUser(env, user); const body = await request.json<Json>(); const name = String(body.name || "").trim(); const offsets = Array.isArray(body.offsets) ? body.offsets.map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 8) : [];
  if (!name || !offsets.length) return response(request, env, { error: "请填写名称和提醒时间" }, 400); const preset = { id: crypto.randomUUID(), name, offsets, isDefault: 0 };
  await env.DB.prepare("INSERT INTO reminder_presets (id,user_id,name,offsets_json,is_default,created_at) VALUES (?,?,?,?,0,?)").bind(preset.id, user.id, name, JSON.stringify(offsets), new Date().toISOString()).run(); return response(request, env, { preset }, 201);
}

async function profile(request: Request, env: Env, user: User) {
  await prepareUser(env, user); const body = await request.json<Json>(); const current = await env.DB.prepare("SELECT name,settings_json,avatar_url FROM users WHERE id=?").bind(user.id).first<Json>();
  const name = String(body.name || current?.name || user.name).trim().slice(0, 24); const settings = body.settings ?? JSON.parse(String(current?.settings_json || "{}")); const avatarUrl = body.avatarUrl === undefined ? current?.avatar_url : body.avatarUrl;
  await env.DB.prepare("UPDATE users SET name=?,settings_json=?,avatar_url=?,updated_at=? WHERE id=?").bind(name, JSON.stringify(settings), avatarUrl || null, new Date().toISOString(), user.id).run(); return response(request, env, { user: { id: user.id, email: user.email, name, settings, avatarUrl } });
}

async function media(request: Request, env: Env, user: User) {
  const kind = new URL(request.url).searchParams.get("kind") === "avatar" ? "avatar" : "background"; const key = `users/${user.id}/${kind}`;
  if (request.method === "PUT") { const type = request.headers.get("content-type") || "image/jpeg"; if (!type.startsWith("image/")) return response(request, env, { error: "只支持图片" }, 400); const bytes = await request.arrayBuffer(); if (bytes.byteLength > 5 * 1024 * 1024) return response(request, env, { error: "图片不能超过 5MB" }, 413); await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } }); return response(request, env, { url: `/api/media?kind=${kind}&v=${Date.now()}` }); }
  const object = await env.MEDIA.get(key); if (!object) return new Response(null, { status: 404, headers: corsHeaders(request, env) }); return new Response(object.body, { headers: { ...corsHeaders(request, env), "Content-Type": object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private,max-age=3600" } });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url); if (url.pathname === "/health") return response(request, env, { status: "ok", service: "jishi-api" });
    try {
      if (url.pathname === "/api/auth/register" && request.method === "POST") return register(request, env);
      if (url.pathname === "/api/auth/login" && request.method === "POST") return login(request, env);
      if (url.pathname === "/api/auth/logout" && request.method === "POST") return authResponse(request, env, { ok: true }, sessionCookie(request, "", 0));
      const user = await userFrom(request, env); if (!user) return response(request, env, { error: "请先登录后再继续" }, 401);
      if (url.pathname === "/api/bootstrap" && request.method === "GET") return bootstrap(request, env, user);
      if (url.pathname === "/api/todos" && request.method === "POST") return createTodo(request, env, user);
      const todoMatch = url.pathname.match(/^\/api\/todos\/([^/]+)$/); if (todoMatch && request.method === "PATCH") return updateTodo(request, env, user, todoMatch[1]);
      if (todoMatch && request.method === "DELETE") { await prepareUser(env, user); await env.DB.prepare("DELETE FROM todos WHERE id=? AND user_id=? AND status='deleted'").bind(todoMatch[1], user.id).run(); return response(request, env, { ok: true }); }
      if (url.pathname === "/api/categories" && (request.method === "POST" || request.method === "DELETE")) return categories(request, env, user);
      if (url.pathname === "/api/presets" && request.method === "POST") return createPreset(request, env, user);
      if (url.pathname === "/api/profile" && request.method === "PATCH") return profile(request, env, user);
      if (url.pathname === "/api/media" && (request.method === "GET" || request.method === "PUT")) return media(request, env, user);
      return response(request, env, { error: "接口不存在" }, 404);
    } catch (error) { return response(request, env, { error: error instanceof Error ? error.message : "服务器暂时不可用" }, 500); }
  },
} satisfies ExportedHandler<Env>;
