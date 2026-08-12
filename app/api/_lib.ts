import { getChatGPTUser, type ChatGPTUser } from "../chatgpt-auth";
import { ensureSchema, getD1 } from "../../db/runtime";

export type ApiUser = ChatGPTUser;

export async function apiUser(request: Request): Promise<ApiUser | null> {
  const signedIn = await getChatGPTUser();
  if (signedIn) return signedIn;
  const host = new URL(request.url).hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return { userId: "local-demo", email: "demo@jishi.local", displayName: "夏日", fullName: "夏日" };
  }
  return null;
}

export function unauthorized() {
  return Response.json({ error: "请先登录后再继续" }, { status: 401 });
}

export async function prepareUser(user: ApiUser) {
  await ensureSchema();
  const db = getD1();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO users (id, email, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET email = excluded.email, updated_at = excluded.updated_at`,
  ).bind(user.userId, user.email, user.displayName, now, now).run();

  const categoryCount = await db.prepare("SELECT COUNT(*) AS count FROM categories WHERE user_id = ?").bind(user.userId).first<{ count: number }>();
  if (!categoryCount?.count) {
    await db.batch([
      ["默认", "#9e8d74", 1], ["学习", "#78928a", 0], ["娱乐", "#8d82a6", 0], ["杂项", "#b98572", 0],
    ].map(([name, color, isDefault]) => db.prepare("INSERT INTO categories (id, user_id, name, color, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.userId, name, color, isDefault, now)));
  }
  const presetCount = await db.prepare("SELECT COUNT(*) AS count FROM reminder_presets WHERE user_id = ?").bind(user.userId).first<{ count: number }>();
  if (!presetCount?.count) {
    await db.batch([
      ["默认", [720, 360, 180, 10], 1], ["仅 10 分钟前", [10], 0], ["大事件", [10080, 4320, 1440], 0],
    ].map(([name, offsets, isDefault]) => db.prepare("INSERT INTO reminder_presets (id, user_id, name, offsets_json, is_default, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(crypto.randomUUID(), user.userId, name, JSON.stringify(offsets), isDefault, now)));
  }
  return db;
}

export function json<T>(value: T, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function todoFromRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    deadline: row.deadline,
    reminderPresetId: row.reminder_preset_id,
    reminderOffsets: JSON.parse(String(row.reminder_offsets_json || "[]")),
    categoryId: row.category_id,
    priority: row.priority,
    notes: row.notes,
    status: row.status,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    deletedAt: row.deleted_at,
    updatedAt: row.updated_at,
  };
}
