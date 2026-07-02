CREATE TABLE `memo_tags` (
	`memo_id` integer NOT NULL,
	`tag_id` integer NOT NULL,
	FOREIGN KEY (`memo_id`) REFERENCES `memos`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tag_id`) REFERENCES `tags`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `memos` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`source_id` text,
	`session_id` integer,
	`node_id` text,
	`origin` text DEFAULT 'manual' NOT NULL,
	`pinned` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `user_sessions`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `memo_user_idx` ON `memos` (`user_id`);--> statement-breakpoint
CREATE INDEX `memo_user_source_idx` ON `memos` (`user_id`,`source_id`);--> statement-breakpoint
CREATE INDEX `memo_updated_idx` ON `memos` (`updated_at`);
--> statement-breakpoint
-- FTS5 full-text search index for memos
CREATE VIRTUAL TABLE IF NOT EXISTS memos_fts USING fts5(
  title, content,
  content='memos', content_rowid='id'
);
--> statement-breakpoint
-- Auto-sync triggers
CREATE TRIGGER IF NOT EXISTS memos_fts_ai AFTER INSERT ON memos BEGIN
  INSERT INTO memos_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memos_fts_ad AFTER DELETE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
END;
--> statement-breakpoint
CREATE TRIGGER IF NOT EXISTS memos_fts_au AFTER UPDATE ON memos BEGIN
  INSERT INTO memos_fts(memos_fts, rowid, title, content) VALUES('delete', old.id, old.title, old.content);
  INSERT INTO memos_fts(rowid, title, content) VALUES (new.id, new.title, new.content);
END;