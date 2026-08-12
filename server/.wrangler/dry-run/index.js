var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/index.ts
var schema = [
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, avatar_url TEXT, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reminder_presets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, offsets_json TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', deadline TEXT, reminder_preset_id TEXT, reminder_offsets_json TEXT NOT NULL DEFAULT '[]', category_id TEXT, priority TEXT NOT NULL DEFAULT 'normal', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, completed_at TEXT, deleted_at TEXT, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_reminder_presets_user_id ON reminder_presets(user_id)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user_status_deadline ON todos(user_id, status, deadline)`,
  `CREATE INDEX IF NOT EXISTS idx_todos_user_created_at ON todos(user_id, created_at)`
];
var initialized = null;
function corsHeaders(request, env) {
  const origin = request.headers.get("origin") || "";
  const allowed = (env.ALLOWED_ORIGINS || "http://localhost:3000").split(",").map((item) => item.trim());
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, PUT, OPTIONS",
    "Vary": "Origin"
  };
}
__name(corsHeaders, "corsHeaders");
function response(request, env, value, status = 200) {
  return Response.json(value, { status, headers: { ...corsHeaders(request, env), "Cache-Control": "no-store" } });
}
__name(response, "response");
function userFrom(request) {
  const url = new URL(request.url);
  const email = request.headers.get("oai-authenticated-user-email") || request.headers.get("x-auth-request-email");
  const id = request.headers.get("oai-authenticated-user-id") || email;
  const encodedName = request.headers.get("oai-authenticated-user-full-name");
  const gatewayName = request.headers.get("x-auth-request-user");
  let name = gatewayName || email || "";
  if (!gatewayName && encodedName) {
    try {
      name = decodeURIComponent(encodedName);
    } catch {
      name = email || "";
    }
  }
  if (id && email) return { id, email, name };
  if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return { id: "local-demo", email: "demo@jishi.local", name: "\u590F\u65E5" };
  return null;
}
__name(userFrom, "userFrom");
async function ensureDb(env) {
  if (!initialized) initialized = env.DB.batch(schema.map((sql) => env.DB.prepare(sql)));
  await initialized;
}
__name(ensureDb, "ensureDb");
async function prepareUser(env, user) {
  await ensureDb(env);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  await env.DB.prepare(`INSERT INTO users (id,email,name,created_at,updated_at) VALUES (?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET email=excluded.email,updated_at=excluded.updated_at`).bind(user.id, user.email, user.name, now, now).run();
  const categoryCount = await env.DB.prepare("SELECT COUNT(*) count FROM categories WHERE user_id=?").bind(user.id).first();
  if (!categoryCount?.count) {
    await env.DB.batch([["\u9ED8\u8BA4", "#9e8d74", 1], ["\u5B66\u4E60", "#78928a", 0], ["\u5A31\u4E50", "#8d82a6", 0], ["\u6742\u9879", "#b98572", 0]].map(([name, color, primary]) => env.DB.prepare("INSERT INTO categories (id,user_id,name,color,is_default,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, name, color, primary, now)));
  }
  const presetCount = await env.DB.prepare("SELECT COUNT(*) count FROM reminder_presets WHERE user_id=?").bind(user.id).first();
  if (!presetCount?.count) {
    await env.DB.batch([["\u9ED8\u8BA4", [720, 360, 180, 10], 1], ["\u4EC5 10 \u5206\u949F\u524D", [10], 0], ["\u5927\u4E8B\u4EF6", [10080, 4320, 1440], 0]].map(([name, offsets, primary]) => env.DB.prepare("INSERT INTO reminder_presets (id,user_id,name,offsets_json,is_default,created_at) VALUES (?,?,?,?,?,?)").bind(crypto.randomUUID(), user.id, name, JSON.stringify(offsets), primary, now)));
  }
}
__name(prepareUser, "prepareUser");
function todo(row) {
  return { id: row.id, title: row.title, content: row.content, deadline: row.deadline, reminderPresetId: row.reminder_preset_id, reminderOffsets: JSON.parse(String(row.reminder_offsets_json || "[]")), categoryId: row.category_id, priority: row.priority, notes: row.notes, status: row.status, createdAt: row.created_at, completedAt: row.completed_at, deletedAt: row.deleted_at, updatedAt: row.updated_at };
}
__name(todo, "todo");
async function bootstrap(request, env, user) {
  await prepareUser(env, user);
  await env.DB.prepare("DELETE FROM todos WHERE user_id=? AND status='deleted' AND deleted_at < datetime('now','-30 days')").bind(user.id).run();
  const [profile2, todos, categories2, presets] = await Promise.all([
    env.DB.prepare("SELECT id,email,name,avatar_url,settings_json FROM users WHERE id=?").bind(user.id).first(),
    env.DB.prepare("SELECT * FROM todos WHERE user_id=? ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END,deadline ASC,created_at DESC").bind(user.id).all(),
    env.DB.prepare("SELECT id,name,color,is_default isDefault FROM categories WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all(),
    env.DB.prepare("SELECT id,name,offsets_json,is_default isDefault FROM reminder_presets WHERE user_id=? ORDER BY is_default DESC,created_at").bind(user.id).all()
  ]);
  return response(request, env, {
    user: { id: profile2?.id, email: profile2?.email, name: profile2?.name, avatarUrl: profile2?.avatar_url, settings: JSON.parse(String(profile2?.settings_json || "{}")) },
    todos: todos.results.map(todo),
    categories: categories2.results,
    reminderPresets: presets.results.map((item) => ({ id: item.id, name: item.name, isDefault: item.isDefault, offsets: JSON.parse(String(item.offsets_json || "[]")) }))
  });
}
__name(bootstrap, "bootstrap");
async function createTodo(request, env, user) {
  await prepareUser(env, user);
  const body = await request.json();
  const title = String(body.title || "").trim();
  if (!title || title.length > 60) return response(request, env, { error: "\u6807\u9898\u5E94\u4E3A 1 \u81F3 60 \u4E2A\u5B57" }, 400);
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const id = crypto.randomUUID();
  const presetId = body.reminderPresetId ? String(body.reminderPresetId) : null;
  const preset = presetId ? await env.DB.prepare("SELECT offsets_json FROM reminder_presets WHERE id=? AND user_id=?").bind(presetId, user.id).first() : null;
  await env.DB.prepare("INSERT INTO todos (id,user_id,title,content,deadline,reminder_preset_id,reminder_offsets_json,category_id,priority,notes,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,'active',?,?)").bind(id, user.id, title, String(body.content || ""), body.deadline || null, presetId, preset?.offsets_json || "[]", body.categoryId || null, body.priority || "normal", String(body.notes || ""), now, now).run();
  const row = await env.DB.prepare("SELECT * FROM todos WHERE id=?").bind(id).first();
  return response(request, env, { todo: todo(row || {}) }, 201);
}
__name(createTodo, "createTodo");
async function updateTodo(request, env, user, id) {
  await prepareUser(env, user);
  const body = await request.json();
  const current = await env.DB.prepare("SELECT * FROM todos WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!current) return response(request, env, { error: "\u5F85\u529E\u4E0D\u5B58\u5728" }, 404);
  const pick = /* @__PURE__ */ __name((camel, snake) => body[camel] === void 0 ? current[snake] : body[camel], "pick");
  const title = String(pick("title", "title") || "").trim();
  if (!title || title.length > 60) return response(request, env, { error: "\u6807\u9898\u5E94\u4E3A 1 \u81F3 60 \u4E2A\u5B57" }, 400);
  const status = String(pick("status", "status"));
  const now = (/* @__PURE__ */ new Date()).toISOString();
  let completedAt = current.completed_at;
  let deletedAt = current.deleted_at;
  if (status === "completed" && current.status !== "completed") completedAt = now;
  if (status === "deleted" && current.status !== "deleted") deletedAt = now;
  if (status === "active") {
    completedAt = null;
    deletedAt = null;
  }
  const presetId = pick("reminderPresetId", "reminder_preset_id");
  const preset = presetId ? await env.DB.prepare("SELECT offsets_json FROM reminder_presets WHERE id=? AND user_id=?").bind(presetId, user.id).first() : null;
  await env.DB.prepare("UPDATE todos SET title=?,content=?,deadline=?,reminder_preset_id=?,reminder_offsets_json=?,category_id=?,priority=?,notes=?,status=?,completed_at=?,deleted_at=?,updated_at=? WHERE id=? AND user_id=?").bind(title, pick("content", "content") || "", pick("deadline", "deadline") || null, presetId || null, preset?.offsets_json || "[]", pick("categoryId", "category_id") || null, pick("priority", "priority") || "normal", pick("notes", "notes") || "", status, completedAt, deletedAt, now, id, user.id).run();
  const row = await env.DB.prepare("SELECT * FROM todos WHERE id=?").bind(id).first();
  return response(request, env, { todo: todo(row || {}) });
}
__name(updateTodo, "updateTodo");
async function categories(request, env, user) {
  await prepareUser(env, user);
  if (request.method === "POST") {
    const body = await request.json();
    const name = String(body.name || "").trim();
    if (!name || name.length > 12) return response(request, env, { error: "\u5206\u7C7B\u540D\u79F0\u5E94\u4E3A 1 \u81F3 12 \u4E2A\u5B57" }, 400);
    const category = { id: crypto.randomUUID(), name, color: String(body.color || "#8d82a6"), isDefault: 0 };
    await env.DB.prepare("INSERT INTO categories (id,user_id,name,color,is_default,created_at) VALUES (?,?,?,?,0,?)").bind(category.id, user.id, name, category.color, (/* @__PURE__ */ new Date()).toISOString()).run();
    return response(request, env, { category }, 201);
  }
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return response(request, env, { error: "\u7F3A\u5C11\u5206\u7C7B ID" }, 400);
  const target = await env.DB.prepare("SELECT is_default FROM categories WHERE id=? AND user_id=?").bind(id, user.id).first();
  if (!target || target.is_default) return response(request, env, { error: "\u9ED8\u8BA4\u5206\u7C7B\u4E0D\u80FD\u5220\u9664" }, 400);
  const fallback = await env.DB.prepare("SELECT id FROM categories WHERE user_id=? AND is_default=1").bind(user.id).first();
  await env.DB.batch([env.DB.prepare("UPDATE todos SET category_id=? WHERE user_id=? AND category_id=?").bind(fallback?.id || null, user.id, id), env.DB.prepare("DELETE FROM categories WHERE id=? AND user_id=?").bind(id, user.id)]);
  return response(request, env, { ok: true });
}
__name(categories, "categories");
async function createPreset(request, env, user) {
  await prepareUser(env, user);
  const body = await request.json();
  const name = String(body.name || "").trim();
  const offsets = Array.isArray(body.offsets) ? body.offsets.map(Number).filter((value) => Number.isFinite(value) && value > 0).slice(0, 8) : [];
  if (!name || !offsets.length) return response(request, env, { error: "\u8BF7\u586B\u5199\u540D\u79F0\u548C\u63D0\u9192\u65F6\u95F4" }, 400);
  const preset = { id: crypto.randomUUID(), name, offsets, isDefault: 0 };
  await env.DB.prepare("INSERT INTO reminder_presets (id,user_id,name,offsets_json,is_default,created_at) VALUES (?,?,?,?,0,?)").bind(preset.id, user.id, name, JSON.stringify(offsets), (/* @__PURE__ */ new Date()).toISOString()).run();
  return response(request, env, { preset }, 201);
}
__name(createPreset, "createPreset");
async function profile(request, env, user) {
  await prepareUser(env, user);
  const body = await request.json();
  const current = await env.DB.prepare("SELECT name,settings_json,avatar_url FROM users WHERE id=?").bind(user.id).first();
  const name = String(body.name || current?.name || user.name).trim().slice(0, 24);
  const settings = body.settings ?? JSON.parse(String(current?.settings_json || "{}"));
  const avatarUrl = body.avatarUrl === void 0 ? current?.avatar_url : body.avatarUrl;
  await env.DB.prepare("UPDATE users SET name=?,settings_json=?,avatar_url=?,updated_at=? WHERE id=?").bind(name, JSON.stringify(settings), avatarUrl || null, (/* @__PURE__ */ new Date()).toISOString(), user.id).run();
  return response(request, env, { user: { id: user.id, email: user.email, name, settings, avatarUrl } });
}
__name(profile, "profile");
async function media(request, env, user) {
  const kind = new URL(request.url).searchParams.get("kind") === "avatar" ? "avatar" : "background";
  const key = `users/${user.id}/${kind}`;
  if (request.method === "PUT") {
    const type = request.headers.get("content-type") || "image/jpeg";
    if (!type.startsWith("image/")) return response(request, env, { error: "\u53EA\u652F\u6301\u56FE\u7247" }, 400);
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 5 * 1024 * 1024) return response(request, env, { error: "\u56FE\u7247\u4E0D\u80FD\u8D85\u8FC7 5MB" }, 413);
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: type } });
    return response(request, env, { url: `/api/media?kind=${kind}&v=${Date.now()}` });
  }
  const object = await env.MEDIA.get(key);
  if (!object) return new Response(null, { status: 404, headers: corsHeaders(request, env) });
  return new Response(object.body, { headers: { ...corsHeaders(request, env), "Content-Type": object.httpMetadata?.contentType || "image/jpeg", "Cache-Control": "private,max-age=3600" } });
}
__name(media, "media");
var index_default = {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    const url = new URL(request.url);
    if (url.pathname === "/health") return response(request, env, { status: "ok", service: "jishi-api" });
    const user = userFrom(request);
    if (!user) return response(request, env, { error: "\u8BF7\u5148\u767B\u5F55\u540E\u518D\u7EE7\u7EED" }, 401);
    try {
      if (url.pathname === "/api/bootstrap" && request.method === "GET") return bootstrap(request, env, user);
      if (url.pathname === "/api/todos" && request.method === "POST") return createTodo(request, env, user);
      const todoMatch = url.pathname.match(/^\/api\/todos\/([^/]+)$/);
      if (todoMatch && request.method === "PATCH") return updateTodo(request, env, user, todoMatch[1]);
      if (todoMatch && request.method === "DELETE") {
        await prepareUser(env, user);
        await env.DB.prepare("DELETE FROM todos WHERE id=? AND user_id=? AND status='deleted'").bind(todoMatch[1], user.id).run();
        return response(request, env, { ok: true });
      }
      if (url.pathname === "/api/categories" && (request.method === "POST" || request.method === "DELETE")) return categories(request, env, user);
      if (url.pathname === "/api/presets" && request.method === "POST") return createPreset(request, env, user);
      if (url.pathname === "/api/profile" && request.method === "PATCH") return profile(request, env, user);
      if (url.pathname === "/api/media" && (request.method === "GET" || request.method === "PUT")) return media(request, env, user);
      return response(request, env, { error: "\u63A5\u53E3\u4E0D\u5B58\u5728" }, 404);
    } catch (error) {
      return response(request, env, { error: error instanceof Error ? error.message : "\u670D\u52A1\u5668\u6682\u65F6\u4E0D\u53EF\u7528" }, 500);
    }
  }
};
export {
  index_default as default
};
//# sourceMappingURL=index.js.map
