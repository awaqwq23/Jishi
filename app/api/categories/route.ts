import { apiUser, json, prepareUser, unauthorized } from "../_lib";

export async function POST(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const body = await request.json() as { name?: string; color?: string };
  const name = body.name?.trim() ?? "";
  if (!name || name.length > 12) return json({ error: "分类名称应为 1 至 12 个字" }, 400);
  const db = await prepareUser(user);
  const category = { id: crypto.randomUUID(), name, color: body.color || "#8d82a6", isDefault: 0 };
  await db.prepare("INSERT INTO categories (id, user_id, name, color, is_default, created_at) VALUES (?, ?, ?, ?, 0, ?)").bind(category.id, user.userId, name, category.color, new Date().toISOString()).run();
  return json({ category }, 201);
}

export async function DELETE(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ error: "缺少分类 ID" }, 400);
  const db = await prepareUser(user);
  const category = await db.prepare("SELECT is_default FROM categories WHERE id = ? AND user_id = ?").bind(id, user.userId).first<{ is_default: number }>();
  if (!category || category.is_default) return json({ error: "默认分类不能删除" }, 400);
  const fallback = await db.prepare("SELECT id FROM categories WHERE user_id = ? AND is_default = 1 LIMIT 1").bind(user.userId).first<{ id: string }>();
  await db.batch([
    db.prepare("UPDATE todos SET category_id = ? WHERE user_id = ? AND category_id = ?").bind(fallback?.id ?? null, user.userId, id),
    db.prepare("DELETE FROM categories WHERE id = ? AND user_id = ?").bind(id, user.userId),
  ]);
  return json({ ok: true });
}
