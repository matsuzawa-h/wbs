-- Clear all assignee data and references so the table can be extended with
-- employee master fields. The user explicitly approved discarding the existing
-- single-name assignees so they can be re-registered through the new master UI.
UPDATE `wbs_tasks` SET `assignee_id` = NULL;
--> statement-breakpoint
DELETE FROM `assignees`;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `code` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `name_kana` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `department` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `role` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `email` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `employment_start` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `employment_end` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `works_on_holidays` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `note` text;
--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `sort_order` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_assignees_code` ON `assignees` (`code`) WHERE `code` IS NOT NULL;
