CREATE TABLE `personal_tasks` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`employee_id` integer NOT NULL,
	`project_id` integer,
	`name` text DEFAULT '' NOT NULL,
	`start_date` text,
	`duration` integer,
	`end_date` text,
	`actual_start_date` text,
	`actual_end_date` text,
	`planned_hours` real,
	`actual_hours` real,
	`progress` integer DEFAULT 0 NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`employee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_personal_tasks_employee` ON `personal_tasks` (`employee_id`);--> statement-breakpoint
CREATE INDEX `idx_personal_tasks_project` ON `personal_tasks` (`project_id`);
