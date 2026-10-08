ALTER TABLE `papers` ADD `max_read_page` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `reading_status` text DEFAULT 'unread' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `tags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `excerpts` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `author_role` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `co_first_author` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `corresponding_author` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `partition_year` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `match_reason` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `arxiv_favorite` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `arxiv_ignored` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `linked_submission_id` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `translation_order` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `revision_completed` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `ended` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `project_id` text REFERENCES projects(id);--> statement-breakpoint
ALTER TABLE `submissions` ADD `manuscript_paper_id` text REFERENCES papers(id);--> statement-breakpoint
ALTER TABLE `submissions` ADD `manuscript_group_id` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `submissions` ADD `source_submission_id` text;--> statement-breakpoint
ALTER TABLE `submissions` ADD `review_items` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `deferred_until` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `series_id` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `recurrence` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `occurrence_date` text;--> statement-breakpoint
ALTER TABLE `tasks` ADD `checklist` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `milestone` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `linked_paper_id` text REFERENCES papers(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `linked_submission_id` text REFERENCES submissions(id);--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_type` text DEFAULT 'manual' NOT NULL;--> statement-breakpoint
ALTER TABLE `tasks` ADD `source_id` text;--> statement-breakpoint
UPDATE `papers`
SET `max_read_page` = max(`read_page`, `translated_read_page`),
    `reading_status` = CASE
      WHEN `read_progress` >= 100 THEN 'done'
      WHEN max(`read_page`, `translated_read_page`) > 0 THEN 'reading'
      ELSE 'unread'
    END,
    `read_progress` = CASE WHEN `read_progress` >= 100 THEN 100 ELSE min(`read_progress`, 99) END;--> statement-breakpoint
UPDATE `submissions` SET `manuscript_group_id` = `id` WHERE `manuscript_group_id` = '';
