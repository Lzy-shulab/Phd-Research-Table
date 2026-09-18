CREATE TABLE `arxiv_downloads` (
	`arxiv_id` text PRIMARY KEY NOT NULL,
	`paper_id` text,
	`downloaded_date` text NOT NULL,
	FOREIGN KEY (`paper_id`) REFERENCES `papers`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `arxiv_downloads_date_idx` ON `arxiv_downloads` (`downloaded_date`);--> statement-breakpoint
DROP INDEX `papers_sha256_unique`;--> statement-breakpoint
ALTER TABLE `papers` ADD `collection` text DEFAULT 'library' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `arxiv_id` text;--> statement-breakpoint
ALTER TABLE `papers` ADD `abstract` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `doi` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `published_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `collected_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `cas_partition` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `papers` ADD `jcr_quartile` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `papers_collection_hash_unique` ON `papers` (`collection`,`sha256`);--> statement-breakpoint
CREATE UNIQUE INDEX `papers_arxiv_id_unique` ON `papers` (`arxiv_id`);