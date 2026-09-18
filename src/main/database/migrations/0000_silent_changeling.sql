CREATE TABLE `app_settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`color_key` text DEFAULT 'blue' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`archived_at` text,
	CONSTRAINT "project_name_nonempty" CHECK(length(trim("projects"."name")) > 0)
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'inbox' NOT NULL,
	`project_id` text,
	`priority` text DEFAULT 'none' NOT NULL,
	`due_date` text,
	`scheduled_date` text,
	`start_time` text,
	`end_time` text,
	`estimated_minutes` integer,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`completed_at` text,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "task_title_nonempty" CHECK(length(trim("tasks"."title")) > 0),
	CONSTRAINT "task_status_valid" CHECK("tasks"."status" in ('inbox', 'planned', 'completed')),
	CONSTRAINT "task_priority_valid" CHECK("tasks"."priority" in ('none', 'low', 'medium', 'high')),
	CONSTRAINT "task_completion_consistent" CHECK(("tasks"."status" = 'completed' AND "tasks"."completed_at" IS NOT NULL) OR ("tasks"."status" != 'completed' AND "tasks"."completed_at" IS NULL)),
	CONSTRAINT "task_schedule_status" CHECK("tasks"."status" = 'completed' OR ("tasks"."status" = 'planned' AND "tasks"."scheduled_date" IS NOT NULL) OR ("tasks"."status" = 'inbox' AND "tasks"."scheduled_date" IS NULL)),
	CONSTRAINT "task_time_needs_date" CHECK("tasks"."scheduled_date" IS NOT NULL OR ("tasks"."start_time" IS NULL AND "tasks"."end_time" IS NULL)),
	CONSTRAINT "task_end_after_start" CHECK("tasks"."end_time" IS NULL OR ("tasks"."start_time" IS NOT NULL AND "tasks"."end_time" > "tasks"."start_time")),
	CONSTRAINT "task_estimate_positive" CHECK("tasks"."estimated_minutes" IS NULL OR "tasks"."estimated_minutes" > 0)
);
--> statement-breakpoint
CREATE INDEX `tasks_scheduled_date_idx` ON `tasks` (`scheduled_date`);--> statement-breakpoint
CREATE INDEX `tasks_status_idx` ON `tasks` (`status`);--> statement-breakpoint
CREATE INDEX `tasks_project_id_idx` ON `tasks` (`project_id`);