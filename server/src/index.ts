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
  `CREATE TABLE IF NOT EXISTS schedule_items (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', recurrence TEXT NOT NULL DEFAULT 'daily', start_date TEXT NOT NULL, time_of_day TEXT, weekdays_json TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)`,
  `CREATE TABLE IF NOT EXISTS schedule_records (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, item_id TEXT NOT NULL, occurrence_date TEXT NOT NULL, completed_at TEXT NOT NULL, UNIQUE(user_id,item_id,occurrence_date))`,
  `CREATE TABLE IF NOT EXISTS diary_entries (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, entry_date TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(user_id,entry_date))`,
  `CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_presets_user_id ON reminder_presets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user_status_deadline ON todos(user_id, status, deadline)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user_created_at ON todos(user_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_items_user_kind_status ON schedule_items(user_id, kind, status)`,
  `CREATE INDEX IF NOT EXISTS idx_schedule_records_user_date ON schedule_records(user_id, occurrence_date)`,
  `CREATE INDEX IF NOT EXISTS idx_diary_entries_user_date ON diary_entries(user_id, entry_date)`,
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

function scheduleItem(row: Json) {
  return { id: row.id, kind: row.kind, title: row.title, notes: row.notes, recurrence: row.recurrence, startDate: row.start_date, timeOfDay: row.time_of_day, weekdays: JSON.parse(String(row.weekdays_json || "[]")), status: row.status, createdAt: row.created_at, updatedAt: row.updated_at, deletedAt: row.deleted_at };
}

function scheduleRecord(row: Json) {
  return { id: row.id, itemId: row.item_id, occurrenceDate: row.occurrence_date, completedAt: row.completed_at };
}

function diaryEntry(row: Json) {
  return { id: row.id, entryDate: row.entry_date, content: row.content, createdAt: row.created_at, updatedAt: row.updated_at };
}

function validDate(value: unknown) {
  const text = String(value || ""); if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const [year, month, day] = text.split("-").map(Number); return new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) === text;
}
function validTime(value: unknown) { return /^([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(String(value || "")); }
function normalizedWeekdays(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [];
}
function normalizedSettings(value: unknown) {
  const settings = value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Json) } : {};
  const opacity = Number(settings.cardOpacity ?? 92); settings.cardOpacity = Number.isFinite(opacity) ? Math.max(15, Math.min(100, opacity)) : 92;
  const backgroundOpacity = Number(settings.backgroundOpacity ?? 72); settings.backgroundOpacity = Number.isFinite(backgroundOpacity) ? Math.max(15, Math.min(100, backgroundOpacity)) : 72;
  settings.acrylic = settings.acrylic !== false;
  settings.backgroundAcrylic = settings.backgroundAcrylic === true;
  return settings;
}

async function bootstrap(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  await env.DB.prepare("DELETE FROM todos WHERE user_id=? AND status='deleted' AND deleted_at < datetime('now','-30 days')").bind(user.id).run();
  const [profile, todos, categories, presets, schedules, scheduleRecords, diaryEntries] = await Promise.all([
    env.DB.prepare("SELECT id,email,name,avatar_url,settings_json FROM users WHERE id=?").bind(user.id).first<Json>(),
    env.DB.prepare("SELECT * FROM todos WHERE user_id=? ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,deadline ASC,created_at DESC").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT id,name,color,is_default isDefault FROM categories WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT id,name,offsets_json,is_default isDefault FROM reminder_presets WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT * FROM schedule_items WHERE user_id=? ORDER BY status,created_at DESC").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT * FROM schedule_records WHERE user_id=? ORDER BY occurrence_date DESC").bind(user.id).all<Json>(),
    env.DB.prepare("SELECT * FROM diary_entries WHERE user_id=? ORDER BY entry_date DESC").bind(user.id).all<Json>(),
  ]);
  return response(request, env, {
    user: { id: profile?.id, email: profile?.email, name: profile?.name, avatarUrl: profile?.avatar_url, settings: JSON.parse(String(profile?.settings_json || "{}")) },
    todos: todos.results.map(todo), categories: categories.results,
    reminderPresets: presets.results.map((item) => ({ id: item.id, name: item.name, isDefault: item.isDefault, offsets: JSON.parse(String(item.offsets_json || "[]")) })),
    schedules: schedules.results.map(scheduleItem),
    scheduleRecords: scheduleRecords.results.map(scheduleRecord),
    diaryEntries: diaryEntries.results.map(diaryEntry),
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
  const target = await env.DB.prepare("SELECT id,name,color,is_default FROM categories WHERE id=? AND user_id=?").bind(id, user.id).first<Json>();
  if (!target) return response(request, env, { error: "分类不存在" }, 404);
  if (request.method === "PATCH") {
    const body = await request.json<Json>(); const name = String(body.name || target.name || "").trim(); const color = String(body.color || target.color || "#8d82a6");
    if (!name || name.length > 12) return response(request, env, { error: "分类名称应为 1 至 12 个字" }, 400);
    if (!/^#[0-9a-f]{6}$/i.test(color)) return response(request, env, { error: "分类颜色格式不正确" }, 400);
    await env.DB.prepare("UPDATE categories SET name=?,color=? WHERE id=? AND user_id=?").bind(name, color, id, user.id).run();
    return response(request, env, { category: { id, name, color, isDefault: Number(target.is_default || 0) } });
  }
  const count = await env.DB.prepare("SELECT COUNT(*) count FROM categories WHERE user_id=?").bind(user.id).first<{ count: number }>();
  if ((count?.count || 0) <= 1) return response(request, env, { error: "至少需要保留一个分类" }, 400);
  const fallback = await env.DB.prepare("SELECT id FROM categories WHERE user_id=? AND id<>? ORDER BY is_default DESC,created_at LIMIT 1").bind(user.id, id).first<{ id: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE todos SET category_id=? WHERE user_id=? AND category_id=?").bind(fallback?.id || null, user.id, id),
    env.DB.prepare("DELETE FROM categories WHERE id=? AND user_id=?").bind(id, user.id),
    env.DB.prepare("UPDATE categories SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE user_id=?").bind(fallback?.id || "", user.id),
  ]); return response(request, env, { ok: true, fallbackId: fallback?.id || null });
}

async function presets(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  if (request.method === "POST") {
    const body = await request.json<Json>(); const name = String(body.name || "").trim(); const offsets = Array.isArray(body.offsets) ? [...new Set(body.offsets.map(Number).filter((value) => Number.isFinite(value) && value > 0))].slice(0, 8) : [];
    if (!name || name.length > 20 || !offsets.length) return response(request, env, { error: "请填写 1 至 20 个字的名称和有效提醒时间" }, 400); const preset = { id: crypto.randomUUID(), name, offsets, isDefault: 0 };
    await env.DB.prepare("INSERT INTO reminder_presets (id,user_id,name,offsets_json,is_default,created_at) VALUES (?,?,?,?,0,?)").bind(preset.id, user.id, name, JSON.stringify(offsets), new Date().toISOString()).run(); return response(request, env, { preset }, 201);
  }
  const id = new URL(request.url).searchParams.get("id"); if (!id) return response(request, env, { error: "缺少提醒组 ID" }, 400);
  const target = await env.DB.prepare("SELECT id,name,offsets_json,is_default FROM reminder_presets WHERE id=? AND user_id=?").bind(id, user.id).first<Json>();
  if (!target) return response(request, env, { error: "提醒组不存在" }, 404);
  if (request.method === "PATCH") {
    const body = await request.json<Json>(); const name = String(body.name || target.name || "").trim(); const offsets = Array.isArray(body.offsets) ? [...new Set(body.offsets.map(Number).filter((value) => Number.isFinite(value) && value > 0))].slice(0, 8) : JSON.parse(String(target.offsets_json || "[]"));
    if (!name || name.length > 20 || !offsets.length) return response(request, env, { error: "请填写 1 至 20 个字的名称和有效提醒时间" }, 400);
    const serialized = JSON.stringify(offsets);
    await env.DB.batch([
      env.DB.prepare("UPDATE reminder_presets SET name=?,offsets_json=? WHERE id=? AND user_id=?").bind(name, serialized, id, user.id),
      env.DB.prepare("UPDATE todos SET reminder_offsets_json=?,updated_at=? WHERE user_id=? AND reminder_preset_id=? AND status='active'").bind(serialized, new Date().toISOString(), user.id, id),
    ]);
    return response(request, env, { preset: { id, name, offsets, isDefault: Number(target.is_default || 0) } });
  }
  const count = await env.DB.prepare("SELECT COUNT(*) count FROM reminder_presets WHERE user_id=?").bind(user.id).first<{ count: number }>();
  if ((count?.count || 0) <= 1) return response(request, env, { error: "至少需要保留一个提醒组" }, 400);
  const fallback = await env.DB.prepare("SELECT id FROM reminder_presets WHERE user_id=? AND id<>? ORDER BY is_default DESC,created_at LIMIT 1").bind(user.id, id).first<{ id: string }>();
  await env.DB.batch([
    env.DB.prepare("UPDATE todos SET reminder_preset_id=NULL WHERE user_id=? AND reminder_preset_id=?").bind(user.id, id),
    env.DB.prepare("DELETE FROM reminder_presets WHERE id=? AND user_id=?").bind(id, user.id),
    env.DB.prepare("UPDATE reminder_presets SET is_default=CASE WHEN id=? THEN 1 ELSE 0 END WHERE user_id=?").bind(fallback?.id || "", user.id),
  ]); return response(request, env, { ok: true, fallbackId: fallback?.id || null });
}

async function schedules(request: Request, env: Env, user: User, id?: string) {
  await prepareUser(env, user);
  const now = new Date().toISOString();
  if (request.method === "POST" && !id) {
    const body = await request.json<Json>();
    const kind = body.kind === "habit" ? "habit" : "routine";
    const title = String(body.title || "").trim();
    const recurrence = String(body.recurrence || "daily");
    const startDate = String(body.startDate || now.slice(0, 10));
    const weekdays = normalizedWeekdays(body.weekdays);
    const timeOfDay = kind === "routine" && body.timeOfDay ? String(body.timeOfDay) : null;
    if (!title || title.length > 80) return response(request, env, { error: "计划名称应为 1 至 80 个字" }, 400);
    if (!new Set(["once", "daily", "weekly", "custom", "holidays"]).has(recurrence)) return response(request, env, { error: "重复规则无效" }, 400);
    if (!validDate(startDate) || (timeOfDay !== null && !validTime(timeOfDay))) return response(request, env, { error: "日期或时间格式无效" }, 400);
    if ((recurrence === "weekly" || recurrence === "custom") && !weekdays.length) return response(request, env, { error: "请至少选择一个星期" }, 400);
    const itemId = crypto.randomUUID();
    await env.DB.prepare("INSERT INTO schedule_items (id,user_id,kind,title,notes,recurrence,start_date,time_of_day,weekdays_json,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,'active',?,?)")
      .bind(itemId, user.id, kind, title, String(body.notes || "").slice(0, 2000), recurrence, startDate, timeOfDay, JSON.stringify(weekdays), now, now).run();
    const row = await env.DB.prepare("SELECT * FROM schedule_items WHERE id=? AND user_id=?").bind(itemId, user.id).first<Json>();
    return response(request, env, { item: scheduleItem(row || {}) }, 201);
  }
  if (!id) return response(request, env, { error: "缺少计划 ID" }, 400);
  const current = await env.DB.prepare("SELECT * FROM schedule_items WHERE id=? AND user_id=?").bind(id, user.id).first<Json>();
  if (!current) return response(request, env, { error: "计划不存在" }, 404);
  if (request.method === "DELETE") {
    if (current.status !== "deleted") return response(request, env, { error: "请先将计划移入回收站" }, 400);
    await env.DB.batch([
      env.DB.prepare("DELETE FROM schedule_records WHERE item_id=? AND user_id=?").bind(id, user.id),
      env.DB.prepare("DELETE FROM schedule_items WHERE id=? AND user_id=?").bind(id, user.id),
    ]);
    return response(request, env, { ok: true });
  }
  const body = await request.json<Json>();
  const title = String(body.title === undefined ? current.title : body.title).trim();
  const recurrence = String(body.recurrence === undefined ? current.recurrence : body.recurrence);
  const startDate = String(body.startDate === undefined ? current.start_date : body.startDate);
  const weekdays = body.weekdays === undefined ? JSON.parse(String(current.weekdays_json || "[]")) : normalizedWeekdays(body.weekdays);
  const requestedTime = body.timeOfDay === undefined ? current.time_of_day : body.timeOfDay;
  const timeOfDay = current.kind === "routine" && requestedTime ? String(requestedTime) : null;
  const status = String(body.status === undefined ? current.status : body.status);
  if (!title || title.length > 80 || !new Set(["once", "daily", "weekly", "custom", "holidays"]).has(recurrence)) return response(request, env, { error: "计划内容或重复规则无效" }, 400);
  if (!validDate(startDate) || (timeOfDay !== null && !validTime(timeOfDay)) || !new Set(["active", "deleted"]).has(status)) return response(request, env, { error: "计划日期、时间或状态无效" }, 400);
  if ((recurrence === "weekly" || recurrence === "custom") && !weekdays.length) return response(request, env, { error: "请至少选择一个星期" }, 400);
  const deletedAt = status === "deleted" ? (current.deleted_at || now) : null;
  await env.DB.prepare("UPDATE schedule_items SET title=?,notes=?,recurrence=?,start_date=?,time_of_day=?,weekdays_json=?,status=?,deleted_at=?,updated_at=? WHERE id=? AND user_id=?")
    .bind(title, String(body.notes === undefined ? current.notes : body.notes).slice(0, 2000), recurrence, startDate, timeOfDay, JSON.stringify(weekdays), status, deletedAt, now, id, user.id).run();
  const row = await env.DB.prepare("SELECT * FROM schedule_items WHERE id=? AND user_id=?").bind(id, user.id).first<Json>();
  return response(request, env, { item: scheduleItem(row || {}) });
}

async function scheduleCompletion(request: Request, env: Env, user: User, id: string) {
  await prepareUser(env, user);
  const body = await request.json<Json>(); const occurrenceDate = String(body.occurrenceDate || ""); const completed = body.completed !== false;
  if (!validDate(occurrenceDate)) return response(request, env, { error: "完成日期无效" }, 400);
  const item = await env.DB.prepare("SELECT id FROM schedule_items WHERE id=? AND user_id=? AND status='active'").bind(id, user.id).first();
  if (!item) return response(request, env, { error: "计划不存在或已在回收站" }, 404);
  if (!completed) {
    await env.DB.prepare("DELETE FROM schedule_records WHERE item_id=? AND user_id=? AND occurrence_date=?").bind(id, user.id, occurrenceDate).run();
    return response(request, env, { record: null });
  }
  const now = new Date().toISOString(); const recordId = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO schedule_records (id,user_id,item_id,occurrence_date,completed_at) VALUES (?,?,?,?,?) ON CONFLICT(user_id,item_id,occurrence_date) DO UPDATE SET completed_at=excluded.completed_at")
    .bind(recordId, user.id, id, occurrenceDate, now).run();
  const row = await env.DB.prepare("SELECT * FROM schedule_records WHERE user_id=? AND item_id=? AND occurrence_date=?").bind(user.id, id, occurrenceDate).first<Json>();
  return response(request, env, { record: scheduleRecord(row || {}) });
}

async function diary(request: Request, env: Env, user: User, entryDate: string) {
  await prepareUser(env, user);
  if (!validDate(entryDate)) return response(request, env, { error: "日记日期无效" }, 400);
  const body = await request.json<Json>(); const content = String(body.content ?? "");
  if (content.length > 100_000) return response(request, env, { error: "单篇日记不能超过 100000 个字" }, 413);
  const now = new Date().toISOString(); const id = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO diary_entries (id,user_id,entry_date,content,created_at,updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT(user_id,entry_date) DO UPDATE SET content=excluded.content,updated_at=excluded.updated_at")
    .bind(id, user.id, entryDate, content, now, now).run();
  const row = await env.DB.prepare("SELECT * FROM diary_entries WHERE user_id=? AND entry_date=?").bind(user.id, entryDate).first<Json>();
  return response(request, env, { entry: diaryEntry(row || {}) });
}

async function snapshot(env: Env, user: User, section: string) {
  if (section === "config") {
    const [profile, categories, presets] = await Promise.all([
      env.DB.prepare("SELECT name,settings_json FROM users WHERE id=?").bind(user.id).first<Json>(),
      env.DB.prepare("SELECT name,color,is_default isDefault FROM categories WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all<Json>(),
      env.DB.prepare("SELECT name,offsets_json,is_default isDefault FROM reminder_presets WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all<Json>(),
    ]);
    return { name: profile?.name, settings: JSON.parse(String(profile?.settings_json || "{}")), categories: categories.results, reminderPresets: presets.results.map((item) => ({ name: item.name, offsets: JSON.parse(String(item.offsets_json || "[]")), isDefault: item.isDefault })) };
  }
  if (section === "todos") {
    const rows = await env.DB.prepare("SELECT t.*,c.name category_name,p.name preset_name FROM todos t LEFT JOIN categories c ON c.id=t.category_id LEFT JOIN reminder_presets p ON p.id=t.reminder_preset_id WHERE t.user_id=? ORDER BY t.created_at").bind(user.id).all<Json>();
    return { items: rows.results.map((row) => ({ ...todo(row), categoryName: row.category_name, presetName: row.preset_name })) };
  }
  if (section === "schedules" || section === "routines" || section === "habits") {
    const kind = section === "habits" ? "habit" : "routine";
    const kindFilter = section === "schedules" ? "" : " AND kind=?";
    const itemQuery = env.DB.prepare(`SELECT * FROM schedule_items WHERE user_id=?${kindFilter} ORDER BY created_at`);
    const recordQuery = env.DB.prepare(`SELECT r.* FROM schedule_records r JOIN schedule_items i ON i.id=r.item_id WHERE r.user_id=?${section === "schedules" ? "" : " AND i.kind=?"} ORDER BY r.occurrence_date`);
    const [items, records] = await Promise.all([
      (section === "schedules" ? itemQuery.bind(user.id) : itemQuery.bind(user.id, kind)).all<Json>(),
      (section === "schedules" ? recordQuery.bind(user.id) : recordQuery.bind(user.id, kind)).all<Json>(),
    ]);
    return { items: items.results.map(scheduleItem), records: records.results.map(scheduleRecord) };
  }
  if (section === "diary") {
    const rows = await env.DB.prepare("SELECT * FROM diary_entries WHERE user_id=? ORDER BY entry_date").bind(user.id).all<Json>();
    return { entries: rows.results.map(diaryEntry) };
  }
  throw new Error("不支持的数据分区");
}

function markdownSnapshot(section: string, data: Json) {
  const title: Record<string, string> = { config: "账户配置", todos: "待办", schedules: "定期任务", routines: "定期任务", habits: "习惯", diary: "日记" };
  const lines = [`# 记时 · ${title[section] || section}`, "", `导出时间：${new Date().toISOString()}`, ""];
  if (section === "config") return [...lines, `- 昵称：${data.name || ""}`, `- 设置：\`${JSON.stringify(data.settings || {})}\``, "", "## 分类", ...((data.categories as Json[] || []).map((item) => `- ${item.name} (${item.color})`)), "", "## 提醒组", ...((data.reminderPresets as Json[] || []).map((item) => `- ${item.name}：${(item.offsets as number[] || []).join(", ")} 分钟`))].join("\n");
  if (section === "diary") return [...lines, ...((data.entries as Json[] || []).flatMap((item) => [`## ${item.entryDate}`, "", String(item.content || ""), ""]))].join("\n");
  const items = (data.items as Json[] || []);
  return [...lines, ...items.flatMap((item) => [`## ${item.title || "未命名"}`, "", `- 状态：${item.status || "active"}`, item.deadline ? `- 截止：${item.deadline}` : `- 规则：${item.recurrence || ""}${item.timeOfDay ? ` · ${item.timeOfDay}` : ""}`, item.content || item.notes ? "" : "", String(item.content || item.notes || ""), ""])].join("\n");
}

async function exportData(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  const url = new URL(request.url); const section = url.searchParams.get("section") || "todos"; const format = url.searchParams.get("format") === "md" ? "md" : "json";
  const data = await snapshot(env, user, section); const exportedAt = new Date().toISOString();
  const body = format === "md" ? markdownSnapshot(section, data as Json) : JSON.stringify({ schemaVersion: 1, section, exportedAt, data }, null, 2);
  const extension = format === "md" ? "md" : "json"; const filename = `jishi-${section}-${exportedAt.slice(0, 10)}.${extension}`;
  return new Response(body, { headers: { ...corsHeaders(request, env), "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="${filename}"`, "Cache-Control": "no-store" } });
}

async function runBatch(env: Env, statements: D1PreparedStatement[]) {
  for (let index = 0; index < statements.length; index += 75) await env.DB.batch(statements.slice(index, index + 75));
}

async function importData(request: Request, env: Env, user: User) {
  await prepareUser(env, user);
  const contentLength = Number(request.headers.get("content-length") || 0); if (Number.isFinite(contentLength) && contentLength > 10 * 1024 * 1024) return response(request, env, { error: "导入文件不能超过 10MB" }, 413);
  const section = new URL(request.url).searchParams.get("section") || ""; const envelope = await request.json<Json>();
  if (Number(envelope.schemaVersion) !== 1 || envelope.section !== section || !envelope.data || typeof envelope.data !== "object") return response(request, env, { error: "导入文件格式或分区不匹配" }, 400);
  const data = envelope.data as Json; const now = new Date().toISOString(); const statements: D1PreparedStatement[] = [];
  if (section === "config") {
    const settings = normalizedSettings(data.settings); const name = String(data.name || user.name).trim().slice(0, 24) || user.name;
    const categories = Array.isArray(data.categories) ? data.categories.slice(0, 100) as Json[] : []; const presets = Array.isArray(data.reminderPresets) ? data.reminderPresets.slice(0, 100) as Json[] : [];
    statements.push(env.DB.prepare("UPDATE users SET name=?,settings_json=?,updated_at=? WHERE id=?").bind(name, JSON.stringify(settings), now, user.id));
    statements.push(env.DB.prepare("UPDATE todos SET category_id=NULL,reminder_preset_id=NULL WHERE user_id=?").bind(user.id), env.DB.prepare("DELETE FROM categories WHERE user_id=?").bind(user.id), env.DB.prepare("DELETE FROM reminder_presets WHERE user_id=?").bind(user.id));
    const safeCategories = categories.length ? categories : [{ name: "默认", color: "#9e8d74", isDefault: 1 }];
    safeCategories.forEach((item, index) => statements.push(env.DB.prepare("INSERT INTO categories (id,user_id,name,color,is_default,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, String(item.name || `分类 ${index + 1}`).slice(0, 12), /^#[0-9a-f]{6}$/i.test(String(item.color)) ? item.color : "#9e8d74", index === 0 ? 1 : 0, now)));
    const safePresets = presets.length ? presets : [{ name: "默认", offsets: [10], isDefault: 1 }];
    safePresets.forEach((item, index) => { const offsets = Array.isArray(item.offsets) ? item.offsets.map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 8) : [10]; statements.push(env.DB.prepare("INSERT INTO reminder_presets (id,user_id,name,offsets_json,is_default,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, String(item.name || `提醒组 ${index + 1}`).slice(0, 20), JSON.stringify(offsets.length ? offsets : [10]), index === 0 ? 1 : 0, now)); });
  } else if (section === "todos") {
    const items = Array.isArray(data.items) ? data.items.slice(0, 5000) as Json[] : [];
    const [categories, presets] = await Promise.all([env.DB.prepare("SELECT id,name FROM categories WHERE user_id=?").bind(user.id).all<Json>(), env.DB.prepare("SELECT id,name,offsets_json FROM reminder_presets WHERE user_id=?").bind(user.id).all<Json>()]);
    const categoryMap = new Map(categories.results.map((item) => [String(item.name), String(item.id)])); const presetMap = new Map(presets.results.map((item) => [String(item.name), item]));
    statements.push(env.DB.prepare("DELETE FROM todos WHERE user_id=?").bind(user.id));
    for (const item of items) { const title = String(item.title || "").trim().slice(0, 60); if (!title) continue; const preset = presetMap.get(String(item.presetName || "")); const status = new Set(["active", "completed", "deleted"]).has(String(item.status)) ? String(item.status) : "active"; statements.push(env.DB.prepare("INSERT INTO todos (id,user_id,title,content,deadline,reminder_preset_id,reminder_offsets_json,category_id,priority,notes,status,created_at,completed_at,deleted_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, title, String(item.content || ""), item.deadline || null, preset?.id || null, preset?.offsets_json || JSON.stringify(Array.isArray(item.reminderOffsets) ? item.reminderOffsets : []), categoryMap.get(String(item.categoryName || "")) || null, new Set(["low", "normal", "important", "urgent"]).has(String(item.priority)) ? item.priority : "normal", String(item.notes || ""), status, String(item.createdAt || now), item.completedAt || null, item.deletedAt || null, now)); }
  } else if (section === "schedules" || section === "routines" || section === "habits") {
    const legacyKind = section === "habits" ? "habit" : "routine"; const items = Array.isArray(data.items) ? data.items.slice(0, 2000) as Json[] : []; const records = Array.isArray(data.records) ? data.records.slice(0, 20000) as Json[] : []; const idMap = new Map<string, string>();
    if (section === "schedules") statements.push(env.DB.prepare("DELETE FROM schedule_records WHERE user_id=?").bind(user.id), env.DB.prepare("DELETE FROM schedule_items WHERE user_id=?").bind(user.id));
    else statements.push(env.DB.prepare("DELETE FROM schedule_records WHERE user_id=? AND item_id IN (SELECT id FROM schedule_items WHERE user_id=? AND kind=?)").bind(user.id, user.id, legacyKind), env.DB.prepare("DELETE FROM schedule_items WHERE user_id=? AND kind=?").bind(user.id, legacyKind));
    for (const item of items) { const title = String(item.title || "").trim().slice(0, 80); if (!title || !validDate(item.startDate)) continue; const recurrence = new Set(["once", "daily", "weekly", "custom", "holidays"]).has(String(item.recurrence)) ? String(item.recurrence) : "daily"; const kind = section === "schedules" && item.kind === "habit" ? "habit" : legacyKind; const newId = crypto.randomUUID(); idMap.set(String(item.id), newId); statements.push(env.DB.prepare("INSERT INTO schedule_items (id,user_id,kind,title,notes,recurrence,start_date,time_of_day,weekdays_json,status,created_at,updated_at,deleted_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(newId, user.id, kind, title, String(item.notes || "").slice(0, 2000), recurrence, item.startDate, kind === "routine" && validTime(item.timeOfDay) ? item.timeOfDay : null, JSON.stringify(normalizedWeekdays(item.weekdays)), item.status === "deleted" ? "deleted" : "active", String(item.createdAt || now), now, item.status === "deleted" ? String(item.deletedAt || now) : null)); }
    for (const record of records) { const itemId = idMap.get(String(record.itemId)); if (itemId && validDate(record.occurrenceDate)) statements.push(env.DB.prepare("INSERT OR IGNORE INTO schedule_records (id,user_id,item_id,occurrence_date,completed_at) VALUES (?,?,?,?,?)").bind(crypto.randomUUID(), user.id, itemId, record.occurrenceDate, String(record.completedAt || now))); }
  } else if (section === "diary") {
    const entries = Array.isArray(data.entries) ? data.entries.slice(0, 10000) as Json[] : []; statements.push(env.DB.prepare("DELETE FROM diary_entries WHERE user_id=?").bind(user.id));
    for (const item of entries) if (validDate(item.entryDate)) statements.push(env.DB.prepare("INSERT INTO diary_entries (id,user_id,entry_date,content,created_at,updated_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, item.entryDate, String(item.content || "").slice(0, 100_000), String(item.createdAt || now), now));
  } else return response(request, env, { error: "不支持的数据分区" }, 400);
  await runBatch(env, statements); return response(request, env, { ok: true, imported: Math.max(0, statements.length - 1) });
}

async function profile(request: Request, env: Env, user: User) {
  await prepareUser(env, user); const body = await request.json<Json>(); const current = await env.DB.prepare("SELECT name,settings_json,avatar_url FROM users WHERE id=?").bind(user.id).first<Json>();
  const name = String(body.name || current?.name || user.name).trim().slice(0, 24); const settings = normalizedSettings(body.settings ?? JSON.parse(String(current?.settings_json || "{}"))); const avatarUrl = body.avatarUrl === undefined ? current?.avatar_url : body.avatarUrl;
  await env.DB.prepare("UPDATE users SET name=?,settings_json=?,avatar_url=?,updated_at=? WHERE id=?").bind(name, JSON.stringify(settings), avatarUrl || null, new Date().toISOString(), user.id).run(); return response(request, env, { user: { id: user.id, email: user.email, name, settings, avatarUrl } });
}

async function media(request: Request, env: Env, user: User) {
  const kind = new URL(request.url).searchParams.get("kind") === "avatar" ? "avatar" : "background"; const key = `users/${user.id}/${kind}`;
  if (request.method === "DELETE") { await env.MEDIA.delete(key); return response(request, env, { ok: true }); }
  if (request.method === "PUT") {
    const type = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
    const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (!allowedTypes.has(type)) return response(request, env, { error: "只支持 JPEG、PNG、WebP 或 GIF 图片" }, 400);
    const bytes = await request.arrayBuffer();
    if (!bytes.byteLength) return response(request, env, { error: "图片内容为空" }, 400);
    if (bytes.byteLength > 5 * 1024 * 1024) return response(request, env, { error: "图片不能超过 5MB" }, 413);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
    return response(request, env, { url: `/api/media?kind=${kind}&v=${Date.now()}` });
  }
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
      if (url.pathname === "/api/categories" && (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE")) return categories(request, env, user);
      if (url.pathname === "/api/presets" && (request.method === "POST" || request.method === "PATCH" || request.method === "DELETE")) return presets(request, env, user);
      if (url.pathname === "/api/schedules" && request.method === "POST") return schedules(request, env, user);
      const scheduleMatch = url.pathname.match(/^\/api\/schedules\/([^/]+)$/); if (scheduleMatch && (request.method === "PATCH" || request.method === "DELETE")) return schedules(request, env, user, scheduleMatch[1]);
      const completionMatch = url.pathname.match(/^\/api\/schedules\/([^/]+)\/completion$/); if (completionMatch && request.method === "PUT") return scheduleCompletion(request, env, user, completionMatch[1]);
      const diaryMatch = url.pathname.match(/^\/api\/diary\/(\d{4}-\d{2}-\d{2})$/); if (diaryMatch && request.method === "PUT") return diary(request, env, user, diaryMatch[1]);
      if (url.pathname === "/api/data/export" && request.method === "GET") return exportData(request, env, user);
      if (url.pathname === "/api/data/import" && request.method === "POST") return importData(request, env, user);
      if (url.pathname === "/api/profile" && request.method === "PATCH") return profile(request, env, user);
      if (url.pathname === "/api/media" && (request.method === "GET" || request.method === "PUT" || request.method === "DELETE")) return media(request, env, user);
      return response(request, env, { error: "接口不存在" }, 404);
    } catch (error) { return response(request, env, { error: error instanceof Error ? error.message : "服务器暂时不可用" }, 500); }
  },
} satisfies ExportedHandler<Env>;
