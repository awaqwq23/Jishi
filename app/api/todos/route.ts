import { apiUser, json, prepareUser, todoFromRow, unauthorized } from "../_lib";

const priorities = new Set(["low", "normal", "important", "urgent"]);

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const payload = await request.json() as Record<string, unknown>;
  const title = String(payload.title || "").trim();
  if (!title) return json({ error: "待办标题不能为空" }, 400);
  if (title.length > 60) return json({ error: "待办标题不能超过 60 个字" }, 400);
  const priority = priorities.has(String(payload.priority)) ? String(payload.priority) : "normal";
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const db = await prepareUser(user);
  const presetId = payload.reminderPresetId ? String(payload.reminderPresetId) : null;
  let offsets: number[] = [];
  if (presetId) {
    const preset = await db.prepare("SELECT offsets_json FROM reminder_presets WHERE id = ? AND user_id = ?").bind(presetId, user.userId).first<{ offsets_json: string }>();
    offsets = JSON.parse(preset?.offsets_json || "[]");
  }
  await db.prepare(
    "INSERT INTO todos (id, user_id, title, content, deadline, reminder_preset_id, reminder_offsets_json, category_id, priority, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
  ).bind(id, user.userId, title, String(payload.content || "").trim(), payload.deadline ? String(payload.deadline) : null, presetId, JSON.stringify(offsets), payload.categoryId ? String(payload.categoryId) : null, priority, String(payload.notes || "").trim(), now, now).run();
  const row = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return json({ todo: todoFromRow(row ?? {}) }, 201);
}
