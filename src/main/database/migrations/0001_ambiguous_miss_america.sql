CREATE TABLE `library_folders` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`parent_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`parent_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "folder_name_nonempty" CHECK(length(trim("library_folders"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `papers` (
	`id` text PRIMARY KEY NOT NULL,
	`folder_id` text,
	`title` text NOT NULL,
	`authors` text DEFAULT '' NOT NULL,
	`journal` text DEFAULT '' NOT NULL,
	`year` text DEFAULT '' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`original_name` text NOT NULL,
	`source_path` text NOT NULL,
	`translated_path` text,
	`sha256` text NOT NULL,
	`translation_status` text DEFAULT 'idle' NOT NULL,
	`translation_error` text DEFAULT '' NOT NULL,
	`page_count` integer DEFAULT 0 NOT NULL,
	`read_page` integer DEFAULT 0 NOT NULL,
	`translated_read_page` integer DEFAULT 0 NOT NULL,
	`last_read_at` text,
	`added_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`folder_id`) REFERENCES `library_folders`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "paper_title_nonempty" CHECK(length(trim("papers"."title")) > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `papers_sha256_unique` ON `papers` (`sha256`);--> statement-breakpoint
CREATE INDEX `papers_folder_idx` ON `papers` (`folder_id`);