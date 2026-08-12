import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  name: text("name").notNull(),
  avatarUrl: text("avatar_url"),
  settingsJson: text("settings_json").notNull().default("{}"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    color: text("color").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_categories_user_id").on(table.userId)],
);

export const reminderPresets = sqliteTable(
  "reminder_presets",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    name: text("name").notNull(),
    offsetsJson: text("offsets_json").notNull(),
    isDefault: integer("is_default", { mode: "boolean" }).notNull().default(false),
    createdAt: text("created_at").notNull(),
  },
  (table) => [index("idx_reminder_presets_user_id").on(table.userId)],
);

export const todos = sqliteTable(
  "todos",
  {
    id: text("id").primaryKey(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull().default(""),
    deadline: text("deadline"),
    reminderPresetId: text("reminder_preset_id"),
    reminderOffsetsJson: text("reminder_offsets_json").notNull().default("[]"),
    categoryId: text("category_id"),
    priority: text("priority").notNull().default("normal"),
    notes: text("notes").notNull().default(""),
    status: text("status").notNull().default("active"),
    createdAt: text("created_at").notNull(),
    completedAt: text("completed_at"),
    deletedAt: text("deleted_at"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_todos_user_status_deadline").on(table.userId, table.status, table.deadline),
    index("idx_todos_user_created_at").on(table.userId, table.createdAt),
  ],
);
