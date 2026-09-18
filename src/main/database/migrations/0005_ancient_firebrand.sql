CREATE TABLE `submission_stages` (
	`id` text PRIMARY KEY NOT NULL,
	`submission_id` text NOT NULL,
	`name` text NOT NULL,
	`occurred_on` text NOT NULL,
	`position` integer NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "submission_stage_name_nonempty" CHECK(length(trim("submission_stages"."name")) > 0)
);
--> statement-breakpoint
CREATE INDEX `submission_stages_submission_idx` ON `submission_stages` (`submission_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `submission_stages_position_unique` ON `submission_stages` (`submission_id`,`position`);--> statement-breakpoint
INSERT INTO `submission_stages` (`id`,`submission_id`,`name`,`occurred_on`,`position`,`created_at`,`updated_at`)
SELECT
	e.`id`,
	e.`submission_id`,
	CASE e.`to_status`
		WHEN 'draft' THEN '准备投稿'
		WHEN 'submitted' THEN '已投稿'
		WHEN 'under_review' THEN '审稿中'
		WHEN 'revision' THEN '返修中'
		WHEN 'resubmitted' THEN '已提交返修'
		WHEN 'accepted' THEN '已录用'
		WHEN 'rejected' THEN '已拒稿'
		WHEN 'withdrawn' THEN '已撤稿'
		ELSE e.`to_status`
	END,
	CASE WHEN e.`from_status` IS NULL AND s.`submitted_date` IS NOT NULL
		THEN s.`submitted_date` ELSE date(e.`occurred_at`, 'localtime') END,
	row_number() OVER (PARTITION BY e.`submission_id` ORDER BY e.`occurred_at`, e.`id`) - 1,
	e.`occurred_at`,
	e.`occurred_at`
FROM `submission_events` e
JOIN `submissions` s ON s.`id` = e.`submission_id`
WHERE e.`from_status` IS NULL OR e.`from_status` <> e.`to_status`;--> statement-breakpoint
INSERT INTO `submission_stages` (`id`,`submission_id`,`name`,`occurred_on`,`position`,`created_at`,`updated_at`)
SELECT
	lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' ||
		printf('%x', 8 + (abs(random()) % 4)) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6))),
	s.`id`,
	CASE s.`status`
		WHEN 'draft' THEN '准备投稿'
		WHEN 'submitted' THEN '已投稿'
		WHEN 'under_review' THEN '审稿中'
		WHEN 'revision' THEN '返修中'
		WHEN 'resubmitted' THEN '已提交返修'
		WHEN 'accepted' THEN '已录用'
		WHEN 'rejected' THEN '已拒稿'
		WHEN 'withdrawn' THEN '已撤稿'
		ELSE s.`status`
	END,
	coalesce(s.`submitted_date`, date(s.`created_at`, 'localtime')),
	0,
	s.`created_at`,
	s.`updated_at`
FROM `submissions` s
WHERE NOT EXISTS (SELECT 1 FROM `submission_stages` stage WHERE stage.`submission_id` = s.`id`);
