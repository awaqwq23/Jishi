import { apiUser, json, prepareUser, todoFromRow, unauthorized } from "../../_lib";

const allowed = new Set(["title", "content", "deadline", "reminderPresetId", "categoryId", "priority", "notes", "status"]);

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const payload = await request.json() as Record<string, unknown>;
  const db = await prepareUser(user);
  const current = await db.prepare("SELECT * FROM todos WHERE id = ? AND user_id = ?").bind(id, user.userId).first<Record<string, unknown>>();
  if (!current) return json({ error: "待办不存在" }, 404);

  const next = { ...current } as Record<string, unknown>;
  for (const [key, value] of Object.entries(payload)) if (allowed.has(key)) next[key] = value;
  const title = String(next.title || "").trim();
  if (!title || title.length > 60) return json({ error: "标题应为 1 至 60 个字" }, 400);
  const now = new Date().toISOString();
  let completedAt = current.completed_at;
  let deletedAt = current.deleted_at;
  const status = String(next.status || current.status);
  if (status === "completed" && current.status !== "completed") completedAt = now;
  if (status === "active") { completedAt = null; deletedAt = null; }
  if (status === "deleted" && current.status !== "deleted") deletedAt = now;
  let offsets = String(current.reminder_offsets_json || "[]");
  if (next.reminderPresetId !== current.reminder_preset_id) {
    const preset = next.reminderPresetId ? await db.prepare("SELECT offsets_json FROM reminder_presets WHERE id = ? AND user_id = ?").bind(next.reminderPresetId, user.userId).first<{ offsets_json: string }>() : null;
    offsets = preset?.offsets_json || "[]";
  }
  await db.prepare(
    "UPDATE todos SET title=?, content=?, deadline=?, reminder_preset_id=?, reminder_offsets_json=?, category_id=?, priority=?, notes=?, status=?, completed_at=?, deleted_at=?, updated_at=? WHERE id=? AND user_id=?",
  ).bind(title, String(next.content || ""), next.deadline || null, next.reminderPresetId || null, offsets, next.categoryId || null, next.priority || "normal", String(next.notes || ""), status, completedAt, deletedAt, now, id, user.userId).run();
  const row = await db.prepare("SELECT * FROM todos WHERE id = ?").bind(id).first<Record<string, unknown>>();
  return json({ todo: todoFromRow(row ?? {}) });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const { id } = await context.params;
  const db = await prepareUser(user);
  await db.prepare("DELETE FROM todos WHERE id = ? AND user_id = ? AND status = 'deleted'").bind(id, user.userId).run();
  return json({ ok: true });
}
