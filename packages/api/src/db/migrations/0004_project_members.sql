CREATE TABLE `project_members` (
	`project_id` integer NOT NULL,
	`employee_id` integer NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`project_id`, `employee_id`),
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`employee_id`) REFERENCES `assignees`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_project_members_project` ON `project_members` (`project_id`);
