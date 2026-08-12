import { apiUser, json, prepareUser, todoFromRow, unauthorized } from "../_lib";

export async function GET(request: Request) {
  const user = await apiUser(request);
  if (!user) return unauthorized();
  const db = await prepareUser(user);
  await db.prepare("DELETE FROM todos WHERE user_id = ? AND status = 'deleted' AND deleted_at < datetime('now', '-30 days')").bind(user.userId).run();

  const count = await db.prepare("SELECT COUNT(*) AS count FROM todos WHERE user_id = ?").bind(user.userId).first<{ count: number }>();
  if (!count?.count && user.userId === "local-demo") {
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 26 * 60 * 60 * 1000).toISOString();
    const soon = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString();
    const old = new Date(now.getTime() - 2 * 60 * 60 * 1000).toISOString();
    const cats = await db.prepare("SELECT id, name FROM categories WHERE user_id = ?").bind(user.userId).all<{ id: string; name: string }>();
    const presets = await db.prepare("SELECT id, name, offsets_json FROM reminder_presets WHERE user_id = ?").bind(user.userId).all<{ id: string; name: string; offsets_json: string }>();
    const cat = (name: string) => cats.results.find((item) => item.name === name)?.id ?? cats.results[0]?.id;
    const preset = presets.results.find((item) => item.name === "默认") ?? presets.results[0];
    const values = [
      ["整理暑期课程笔记", "把离散数学第三章的重点整理进知识库", tomorrow, cat("学习"), "important", "完成后发给学习小组"],
      ["兑换前瞻兑换码", "兑换三个限时兑换码，记得检查站内信", soon, cat("娱乐"), "important", ""],
      ["给绿植浇水", "阳台上的薄荷和龟背竹", old, cat("杂项"), "normal", "已逾期，今天回家先处理"],
    ];
    await db.batch(values.map(([title, content, deadline, categoryId, priority, notes]) => db.prepare(
      "INSERT INTO todos (id, user_id, title, content, deadline, reminder_preset_id, reminder_offsets_json, category_id, priority, notes, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)",
    ).bind(crypto.randomUUID(), user.userId, title, content, deadline, preset?.id ?? null, preset?.offsets_json ?? "[]", categoryId, priority, notes, now.toISOString(), now.toISOString())));
  }

  const [userRow, todos, categories, presets] = await Promise.all([
    db.prepare("SELECT id, email, name, avatar_url, settings_json FROM users WHERE id = ?").bind(user.userId).first<Record<string, unknown>>(),
    db.prepare("SELECT * FROM todos WHERE user_id = ? ORDER BY CASE WHEN deadline IS NULL THEN 1 ELSE 0 END, deadline ASC, created_at DESC").bind(user.userId).all<Record<string, unknown>>(),
    db.prepare("SELECT id, name, color, is_default AS isDefault FROM categories WHERE user_id = ? ORDER BY is_default DESC, created_at ASC").bind(user.userId).all(),
    db.prepare("SELECT id, name, offsets_json AS offsetsJson, is_default AS isDefault FROM reminder_presets WHERE user_id = ? ORDER BY is_default DESC, created_at ASC").bind(user.userId).all<Record<string, unknown>>(),
  ]);

  return json({
    user: {
      id: userRow?.id,
      email: userRow?.email,
      name: userRow?.name,
      avatarUrl: userRow?.avatar_url,
      settings: JSON.parse(String(userRow?.settings_json || "{}")),
    },
    todos: todos.results.map(todoFromRow),
    categories: categories.results,
    reminderPresets: presets.results.map((item) => ({ ...item, offsets: JSON.parse(String(item.offsetsJson || "[]")), offsetsJson: undefined })),
  });
}
