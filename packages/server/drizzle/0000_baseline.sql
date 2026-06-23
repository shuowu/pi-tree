-- Baseline migration: create all tables and indexes.
-- Uses IF NOT EXISTS so this is safe on both fresh installs and existing databases.
CREATE TABLE IF NOT EXISTS `glossary_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`term` text NOT NULL,
	`definition` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `glossary_user_source_idx` ON `glossary_entries` (`user_id`,`source_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `source_tags` (
	`source_id` text NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`type` text DEFAULT 'book' NOT NULL,
	`title` text NOT NULL,
	`subtitle` text,
	`author` text DEFAULT '' NOT NULL,
	`year` integer,
	`source` text DEFAULT 'library' NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`error` text,
	`metadata` text,
	`cover_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `tags` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `tags_name_unique` ON `tags` (`name`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`title` text DEFAULT 'Session' NOT NULL,
	`context` text DEFAULT '{"mode":"reading"}' NOT NULL,
	`session_file` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`created_at` text NOT NULL,
	`last_active_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_source_config` (
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`config` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `usc_user_source_idx` ON `user_source_config` (`user_id`,`source_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `user_source_progress` (
	`user_id` text NOT NULL,
	`source_id` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`last_node_id` text,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `usp_user_source_idx` ON `user_source_progress` (`user_id`,`source_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY NOT NULL,
	`display_name` text NOT NULL,
	`avatar_url` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
