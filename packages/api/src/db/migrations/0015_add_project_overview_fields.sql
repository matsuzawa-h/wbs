ALTER TABLE `projects` ADD `description` text;
--> statement-breakpoint
ALTER TABLE `projects` ADD `status` text DEFAULT 'active' NOT NULL;
