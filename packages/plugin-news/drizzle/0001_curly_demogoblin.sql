ALTER TABLE `rss_items` ADD `tag` text DEFAULT 'news' NOT NULL;--> statement-breakpoint
ALTER TABLE `rss_items` ADD `promoted_source_id` text;--> statement-breakpoint
UPDATE `rss_items` SET `tag` = 'youtube'
  WHERE (`url` LIKE '%youtube.com/%' OR `url` LIKE '%youtu.be/%') AND `tag` = 'news';