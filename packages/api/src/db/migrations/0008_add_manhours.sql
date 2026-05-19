ALTER TABLE `projects` ADD COLUMN `project_code` text;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `is_provisional` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `idx_projects_code` ON `projects` (`project_code`);--> statement-breakpoint
CREATE TABLE `manhour_import_batches` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`file_name` text NOT NULL,
	`fiscal_year` integer NOT NULL,
	`org_code` text,
	`row_count` integer DEFAULT 0 NOT NULL,
	`imported_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_mh_batches_fy` ON `manhour_import_batches` (`fiscal_year`);--> statement-breakpoint
CREATE TABLE `manhour_entries` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer,
	`source` text DEFAULT 'imported' NOT NULL,
	`assignee_id` integer NOT NULL,
	`project_id` integer,
	`work_type` text DEFAULT '' NOT NULL,
	`year_month` text NOT NULL,
	`hours` real DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `manhour_import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mh_entries_batch` ON `manhour_entries` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_mh_entries_ym` ON `manhour_entries` (`year_month`);--> statement-breakpoint
CREATE INDEX `idx_mh_entries_assignee` ON `manhour_entries` (`assignee_id`);--> statement-breakpoint
CREATE INDEX `idx_mh_entries_project` ON `manhour_entries` (`project_id`);--> statement-breakpoint
CREATE TABLE `manhour_capacities` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`batch_id` integer,
	`source` text DEFAULT 'imported' NOT NULL,
	`assignee_id` integer NOT NULL,
	`year_month` text NOT NULL,
	`base_hours` real NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `manhour_import_batches`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_mh_capacities_batch` ON `manhour_capacities` (`batch_id`);--> statement-breakpoint
CREATE INDEX `idx_mh_capacities_key` ON `manhour_capacities` (`assignee_id`,`year_month`);
