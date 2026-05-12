ALTER TABLE `wbs_tasks` ADD COLUMN `actual_start_date` text;
--> statement-breakpoint
ALTER TABLE `wbs_tasks` ADD COLUMN `actual_end_date` text;
--> statement-breakpoint
ALTER TABLE `wbs_tasks` ADD COLUMN `planned_hours` real;
--> statement-breakpoint
ALTER TABLE `wbs_tasks` ADD COLUMN `actual_hours` real;
