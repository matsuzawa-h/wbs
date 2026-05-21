ALTER TABLE `manhour_import_batches` ADD `organization_id` integer REFERENCES `organizations`(`id`) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX `idx_mh_batches_organization` ON `manhour_import_batches` (`organization_id`);
--> statement-breakpoint
-- 既存バッチは org_code から organizations を引いて backfill する（0012 以前は
-- 文字列でしか持っていなかったため）。一致しないものは NULL のままとする。
UPDATE `manhour_import_batches`
   SET `organization_id` = (
     SELECT `id` FROM `organizations`
      WHERE `organizations`.`code` = `manhour_import_batches`.`org_code`
     LIMIT 1
   )
 WHERE `org_code` IS NOT NULL AND `organization_id` IS NULL;
