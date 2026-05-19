CREATE TABLE `project_codes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`code` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_project_codes_code` ON `project_codes` (`code`);--> statement-breakpoint
CREATE INDEX `idx_project_codes_project` ON `project_codes` (`project_id`);--> statement-breakpoint
INSERT OR IGNORE INTO `project_codes` (`project_id`, `code`) SELECT `id`, `project_code` FROM `projects` WHERE `project_code` IS NOT NULL AND `project_code` <> '';
