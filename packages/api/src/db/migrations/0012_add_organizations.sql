CREATE TABLE `organizations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`parent_id` integer,
	`is_active` integer DEFAULT 1 NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`note` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `idx_organizations_sort` ON `organizations` (`sort_order`);--> statement-breakpoint
CREATE INDEX `idx_organizations_parent` ON `organizations` (`parent_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_organizations_code` ON `organizations` (`code`) WHERE `code` IS NOT NULL;--> statement-breakpoint
ALTER TABLE `customers` ADD COLUMN `organization_id` integer REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `organization_id` integer REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
ALTER TABLE `assignees` ADD COLUMN `organization_id` integer REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE set null;--> statement-breakpoint
CREATE INDEX `idx_customers_organization` ON `customers` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_projects_organization` ON `projects` (`organization_id`);--> statement-breakpoint
CREATE INDEX `idx_assignees_organization` ON `assignees` (`organization_id`);
