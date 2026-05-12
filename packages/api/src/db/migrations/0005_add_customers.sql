CREATE TABLE `customers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text,
	`name` text NOT NULL,
	`contact_name` text,
	`contact_email` text,
	`contact_phone` text,
	`address` text,
	`is_active` integer DEFAULT 1 NOT NULL,
	`note` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_customers_sort` ON `customers` (`sort_order`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uniq_customers_code` ON `customers` (`code`) WHERE `code` IS NOT NULL;
--> statement-breakpoint
ALTER TABLE `projects` ADD COLUMN `customer_id` integer REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE set null;
--> statement-breakpoint
CREATE INDEX `idx_projects_customer` ON `projects` (`customer_id`);
