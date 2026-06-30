PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_message_usage` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer,
	`user_id` text DEFAULT '' NOT NULL,
	`category` text DEFAULT 'session' NOT NULL,
	`node_id` text NOT NULL,
	`model` text NOT NULL,
	`provider` text DEFAULT '' NOT NULL,
	`input_tokens` integer DEFAULT 0 NOT NULL,
	`output_tokens` integer DEFAULT 0 NOT NULL,
	`cache_read_tokens` integer DEFAULT 0 NOT NULL,
	`cache_write_tokens` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`cost_total` real,
	`created_at` text NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `user_sessions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `__new_message_usage`("id", "session_id", "user_id", "category", "node_id", "model", "provider", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens", "cost_total", "created_at") SELECT "id", "session_id", '', 'session', "node_id", "model", "provider", "input_tokens", "output_tokens", "cache_read_tokens", "cache_write_tokens", "total_tokens", "cost_total", "created_at" FROM `message_usage`;--> statement-breakpoint
DROP TABLE `message_usage`;--> statement-breakpoint
ALTER TABLE `__new_message_usage` RENAME TO `message_usage`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `mu_session_idx` ON `message_usage` (`session_id`);--> statement-breakpoint
CREATE INDEX `mu_user_idx` ON `message_usage` (`user_id`);--> statement-breakpoint
CREATE INDEX `mu_created_idx` ON `message_usage` (`created_at`);