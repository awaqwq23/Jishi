ALTER TABLE users ADD COLUMN username TEXT;
ALTER TABLE users ADD COLUMN registration_id TEXT;
CREATE UNIQUE INDEX idx_users_username ON users(username COLLATE NOCASE);
CREATE UNIQUE INDEX idx_users_registration_id ON users(registration_id);
CREATE TABLE guest_migrations (
  user_id TEXT PRIMARY KEY,
  migration_id TEXT NOT NULL UNIQUE,
  snapshot_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);
