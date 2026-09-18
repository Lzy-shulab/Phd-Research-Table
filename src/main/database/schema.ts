import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, index, uniqueIndex, check, type AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { ColorKey, Priority, TaskStatus, TranslationStatus, PaperCollection, Paper, PublicationHonor, LegacySubmissionStatus } from '../../shared/types'

export const projects = sqliteTable(
  'projects',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    colorKey: text('color_key').$type<ColorKey>().notNull().default('blue'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    archivedAt: text('archived_at')
  },
  (t) => [check('project_name_nonempty', sql`length(trim(${t.name})) > 0`)]
)
export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').$type<TaskStatus>().notNull().default('inbox'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    priority: text('priority').$type<Priority>().notNull().default('none'),
    dueDate: text('due_date'),
    scheduledDate: text('scheduled_date'),
    startTime: text('start_time'),
    endTime: text('end_time'),
    estimatedMinutes: integer('estimated_minutes'),
    order: integer('sort_order').notNull().default(0),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
    completedAt: text('completed_at')
  },
  (t) => [
    index('tasks_scheduled_date_idx').on(t.scheduledDate),
    index('tasks_status_idx').on(t.status),
    index('tasks_project_id_idx').on(t.projectId),
    check('task_title_nonempty', sql`length(trim(${t.title})) > 0`),
    check('task_status_valid', sql`${t.status} in ('inbox', 'planned', 'completed')`),
    check('task_priority_valid', sql`${t.priority} in ('none', 'low', 'medium', 'high')`),
    check(
      'task_completion_consistent',
      sql`(${t.status} = 'completed' AND ${t.completedAt} IS NOT NULL) OR (${t.status} != 'completed' AND ${t.completedAt} IS NULL)`
    ),
    check(
      'task_schedule_status',
      sql`${t.status} = 'completed' OR (${t.status} = 'planned' AND ${t.scheduledDate} IS NOT NULL) OR (${t.status} = 'inbox' AND ${t.scheduledDate} IS NULL)`
    ),
    check(
      'task_time_needs_date',
      sql`${t.scheduledDate} IS NOT NULL OR (${t.startTime} IS NULL AND ${t.endTime} IS NULL)`
    ),
    check(
      'task_end_after_start',
      sql`${t.endTime} IS NULL OR (${t.startTime} IS NOT NULL AND ${t.endTime} > ${t.startTime})`
    ),
    check('task_estimate_positive', sql`${t.estimatedMinutes} IS NULL OR ${t.estimatedMinutes} > 0`)
  ]
)
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull()
})

export const libraryFolders = sqliteTable('library_folders', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  parentId: text('parent_id').references((): AnySQLiteColumn => libraryFolders.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull()
}, (t) => [check('folder_name_nonempty', sql`length(trim(${t.name})) > 0`)])

export const papers = sqliteTable('papers', {
  id: text('id').primaryKey(),
  collection: text('collection').$type<PaperCollection>().notNull().default('library'),
  arxivId: text('arxiv_id'),
  abstract: text('abstract').notNull().default(''),
  doi: text('doi').notNull().default(''),
  publishedDate: text('published_date').notNull().default(''),
  collectedDate: text('collected_date').notNull().default(''),
  casPartition: text('cas_partition').notNull().default(''),
  jcrQuartile: text('jcr_quartile').notNull().default(''),
  honors: text('honors', { mode: 'json' }).$type<PublicationHonor[]>().notNull().default(sql`'[]'`),
  folderId: text('folder_id').references(() => libraryFolders.id, { onDelete: 'set null' }),
  title: text('title').notNull(),
  authors: text('authors').notNull().default(''),
  journal: text('journal').notNull().default(''),
  year: text('year').notNull().default(''),
  notes: text('notes').notNull().default(''),
  originalName: text('original_name').notNull(),
  sourcePath: text('source_path').notNull(),
  translatedPath: text('translated_path'),
  sha256: text('sha256').notNull(),
  translationStatus: text('translation_status').$type<TranslationStatus>().notNull().default('idle'),
  translationError: text('translation_error').notNull().default(''),
  pageCount: integer('page_count').notNull().default(0),
  readPage: integer('read_page').notNull().default(0),
  translatedReadPage: integer('translated_read_page').notNull().default(0),
  readProgress: integer('read_progress').notNull().default(0),
  metadataStatus: text('metadata_status').$type<Paper['metadataStatus']>().notNull().default('pending'),
  metadataSource: text('metadata_source').notNull().default(''),
  metadataMessage: text('metadata_message').notNull().default(''),
  metadataCheckedAt: text('metadata_checked_at'),
  metadataLockedFields: text('metadata_locked_fields').notNull().default('[]'),
  lastReadAt: text('last_read_at'),
  addedAt: text('added_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (t) => [index('papers_folder_idx').on(t.folderId),
  uniqueIndex('papers_collection_hash_unique').on(t.collection, t.sha256),
  uniqueIndex('papers_arxiv_id_unique').on(t.arxivId),
  check('paper_title_nonempty', sql`length(trim(${t.title})) > 0`)])

// Keep download history even after a user removes a PDF, preventing repeated daily downloads.
export const arxivDownloads = sqliteTable('arxiv_downloads', {
  arxivId: text('arxiv_id').primaryKey(),
  paperId: text('paper_id').references(() => papers.id, { onDelete: 'set null' }),
  downloadedDate: text('downloaded_date').notNull()
}, (t) => [index('arxiv_downloads_date_idx').on(t.downloadedDate)])

export const submissions = sqliteTable('submissions', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  journal: text('journal').notNull(),
  manuscriptId: text('manuscript_id').notNull().default(''),
  submittedDate: text('submitted_date'),
  status: text('status').$type<LegacySubmissionStatus>().notNull().default('draft'),
  revisionDueDate: text('revision_due_date'),
  reminderEnabled: integer('reminder_enabled', { mode: 'boolean' }).notNull().default(true),
  reminderDays: integer('reminder_days').notNull().default(3),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (t) => [index('submissions_status_idx').on(t.status), index('submissions_due_idx').on(t.revisionDueDate),
  check('submission_title_nonempty', sql`length(trim(${t.title})) > 0`),
  check('submission_status_valid', sql`${t.status} in ('draft','submitted','under_review','revision','resubmitted','accepted','rejected','withdrawn')`)])
export const submissionEvents = sqliteTable('submission_events', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  fromStatus: text('from_status').$type<LegacySubmissionStatus>(),
  toStatus: text('to_status').$type<LegacySubmissionStatus>().notNull(),
  revisionDueDate: text('revision_due_date'),
  occurredAt: text('occurred_at').notNull(),
  note: text('note').notNull().default('')
}, (t) => [index('submission_events_submission_idx').on(t.submissionId)])
export const submissionStages = sqliteTable('submission_stages', {
  id: text('id').primaryKey(),
  submissionId: text('submission_id').notNull().references(() => submissions.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  occurredOn: text('occurred_on').notNull(),
  position: integer('position').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
}, (t) => [
  index('submission_stages_submission_idx').on(t.submissionId),
  uniqueIndex('submission_stages_position_unique').on(t.submissionId, t.position),
  check('submission_stage_name_nonempty', sql`length(trim(${t.name})) > 0`)
])
