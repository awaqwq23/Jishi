import { env } from "cloudflare:workers";

let schemaReady: Promise<void> | null = null;

export function getD1(): D1Database {
  if (!env.DB) throw new Error("数据库连接暂不可用");
  return env.DB;
}

export function ensureSchema(): Promise<void> {
  if (schemaReady) return schemaReady;
  const db = getD1();
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT NOT NULL, name TEXT NOT NULL, avatar_url TEXT, settings_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS categories (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, color TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS reminder_presets (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, offsets_json TEXT NOT NULL, is_default INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS todos (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, title TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', deadline TEXT, reminder_preset_id TEXT, reminder_offsets_json TEXT NOT NULL DEFAULT '[]', category_id TEXT, priority TEXT NOT NULL DEFAULT 'normal', notes TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL, completed_at TEXT, deleted_at TEXT, updated_at TEXT NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_categories_user_id ON categories(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reminder_presets_user_id ON reminder_presets(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_todos_user_status_deadline ON todos(user_id, status, deadline)`,
    `CREATE INDEX IF NOT EXISTS idx_todos_user_created_at ON todos(user_id, created_at)`,
    `PRAGMA optimize`,
  ];
  schemaReady = db.batch(statements.map((sql) => db.prepare(sql))).then(() => undefined);
  return schemaReady;
}
