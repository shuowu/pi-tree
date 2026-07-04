CREATE TABLE `content_cursors` (
	`user_id` text NOT NULL,
	`stream_key` text NOT NULL,
	`cursor_value` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `content_cursors_pk` ON `content_cursors` (`user_id`,`stream_key`);