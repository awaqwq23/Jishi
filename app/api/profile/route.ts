import { apiUser, json, prepareUser, unauthorized } from "../_lib";

export async function PATCH(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const body = await request.json() as { name?: string; settings?: Record<string, unknown>; avatarUrl?: string };
  const db = await prepareUser(user);
  const current = await db.prepare("SELECT name, settings_json, avatar_url FROM users WHERE id = ?").bind(user.userId).first<{ name: string; settings_json: string; avatar_url: string | null }>();
  const name = body.name?.trim().slice(0, 24) || current?.name || user.displayName;
  const settings = body.settings ?? JSON.parse(current?.settings_json || "{}");
  const avatarUrl = body.avatarUrl === undefined ? current?.avatar_url : body.avatarUrl;
  await db.prepare("UPDATE users SET name = ?, settings_json = ?, avatar_url = ?, updated_at = ? WHERE id = ?").bind(name, JSON.stringify(settings), avatarUrl || null, new Date().toISOString(), user.userId).run();
  return json({ user: { id: user.userId, email: user.email, name, settings, avatarUrl } });
}
