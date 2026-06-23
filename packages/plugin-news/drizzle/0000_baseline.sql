-- Baseline migration: create all news plugin tables and indexes.
-- Uses IF NOT EXISTS so this is safe on both fresh installs and existing databases.
CREATE TABLE IF NOT EXISTS `rss_feeds` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`name` text NOT NULL,
	`url` text NOT NULL,
	`tags` text DEFAULT '[]' NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL,
	`last_fetch_time` text,
	`last_fetch_status` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rss_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`title` text NOT NULL,
	`feed_id` text NOT NULL,
	`url` text NOT NULL,
	`guid` text DEFAULT '' NOT NULL,
	`published_at` text,
	`summary` text,
	`author` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `rss_items_feed_url_idx` ON `rss_items` (`feed_id`,`url`);