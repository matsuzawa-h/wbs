CREATE TABLE `projects` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE TABLE `assignees` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`is_active` integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `wbs_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` integer NOT NULL,
	`level` integer NOT NULL,
	`parent_id` integer,
	`name` text NOT NULL,
	`start_date` text,
	`duration` integer,
	`end_date` text,
	`progress` integer DEFAULT 0 NOT NULL,
	`assignee_id` integer,
	`status` text DEFAULT '' NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`assignee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_wbs_tasks_project` ON `wbs_tasks` (`project_id`);
--> statement-breakpoint
CREATE INDEX `idx_wbs_tasks_parent` ON `wbs_tasks` (`parent_id`);
--> statement-breakpoint
CREATE INDEX `idx_wbs_tasks_sort` ON `wbs_tasks` (`project_id`,`sort_order`);
