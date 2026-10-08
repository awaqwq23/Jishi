CREATE TABLE `schedule_items` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`recurrence` text DEFAULT 'daily' NOT NULL,
	`start_date` text NOT NULL,
	`time_of_day` text,
	`weekdays_json` text DEFAULT '[]' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_items_user_kind_status` ON `schedule_items` (`user_id`,`kind`,`status`);
--> statement-breakpoint
CREATE TABLE `schedule_records` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`item_id` text NOT NULL,
	`occurrence_date` text NOT NULL,
	`completed_at` text NOT NULL,
	UNIQUE(`user_id`,`item_id`,`occurrence_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_schedule_records_user_date` ON `schedule_records` (`user_id`,`occurrence_date`);
--> statement-breakpoint
CREATE TABLE `diary_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`entry_date` text NOT NULL,
	`content` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	UNIQUE(`user_id`,`entry_date`)
);
--> statement-breakpoint
CREATE INDEX `idx_diary_entries_user_date` ON `diary_entries` (`user_id`,`entry_date`);
--> statement-breakpoint
PRAGMA optimize;
