import { apiUser, json, prepareUser, unauthorized } from "../_lib";

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const body = await request.json() as { name?: string; offsets?: number[] };
  const name = body.name?.trim() ?? "";
  const offsets = (body.offsets ?? []).filter((value) => Number.isFinite(value) && value > 0).slice(0, 8);
  if (!name || !offsets.length) return json({ error: "请填写名称和至少一个提醒时间" }, 400);
  const db = await prepareUser(user);
  const preset = { id: crypto.randomUUID(), name, offsets, isDefault: 0 };
  await db.prepare("INSERT INTO reminder_presets (id, user_id, name, offsets_json, is_default, created_at) VALUES (?, ?, ?, ?, 0, ?)").bind(preset.id, user.userId, name, JSON.stringify(offsets), new Date().toISOString()).run();
  return json({ preset }, 201);
}
