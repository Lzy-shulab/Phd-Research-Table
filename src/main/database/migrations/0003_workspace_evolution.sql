CREATE TABLE `submission_events` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`revision_due_date` text,
	`occurred_at` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `submission_events_submission_idx` ON `submission_events` (`submission_id`);--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`journal` text NOT NULL,
	`manuscript_id` text DEFAULT '' NOT NULL,
	`submitted_date` text,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision_due_date` text,
	`reminder_enabled` integer DEFAULT true NOT NULL,
	`reminder_days` integer DEFAULT 3 NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "submission_title_nonempty" CHECK(length(trim("submissions"."title")) > 0),
	CONSTRAINT "submission_status_valid" CHECK("submissions"."status" in ('draft','submitted','under_review','revision','resubmitted','accepted','rejected','withdrawn'))
);
--> statement-breakpoint
CREATE INDEX `submissions_status_idx` ON `submissions` (`status`);--> statement-breakpoint
CREATE INDEX `submissions_due_idx` ON `submissions` (`revision_due_date`);--> statement-breakpoint
ALTER TABLE `papers` ADD `read_progress` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `metadata_status` text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `metadata_source` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `metadata_message` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `metadata_checked_at` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `metadata_locked_fields` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
UPDATE papers SET read_progress = CASE WHEN page_count > 0 THEN MIN(100, CAST(ROUND(MAX(read_page, translated_read_page) * 100.0 / page_count) AS INTEGER)) ELSE 0 END;
--> statement-breakpoint
UPDATE papers SET metadata_status = 'ready', metadata_source = CASE WHEN collection = 'arxiv' THEN 'arXiv' ELSE '手动填写' END WHERE collection != 'library';
