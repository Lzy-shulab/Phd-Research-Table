export const priorities = ['none', 'low', 'medium', 'high'] as const
export const colorKeys = ['blue', 'sage', 'violet', 'amber', 'rose', 'slate'] as const
export const journalPartitions = ['1区', '2区', '3区', '4区', '非SCI', 'EI', '中文核心', '大学学报'] as const
export const publicationHonors = ['esi-highly-cited', 'esi-hot', 'cover-paper', 'best-paper'] as const
export type Priority = (typeof priorities)[number]
export type ColorKey = (typeof colorKeys)[number]
export type TaskStatus = 'inbox' | 'planned' | 'completed'
export type ReadingStatus = 'unread' | 'reading' | 'done'
export type TaskRecurrence = 'weekly'
export type Appearance = 'system' | 'light' | 'dark'
export type PublicationHonor = (typeof publicationHonors)[number]
export type Section = 'planner' | 'literature' | 'outputs' | 'submissions' | 'reports' | 'settings'
export type PlannerView =
  'inbox' | 'today' | 'upcoming' | 'calendar' | 'all' | 'completed' | 'project' | 'projects'
export type ProjectTaskAction = 'delete' | 'retain' | 'transfer'

export interface Project {
  id: string
  name: string
  description: string
  colorKey: ColorKey
  createdAt: string
  updatedAt: string
  archivedAt: string | null
}
export interface Task {
  id: string
  title: string
  description: string
  status: TaskStatus
  projectId: string | null
  priority: Priority
  // Calendar dates (YYYY-MM-DD) and wall-clock times (HH:mm) never pass through UTC.
  dueDate: string | null
  scheduledDate: string | null
  startTime: string | null
  endTime: string | null
  estimatedMinutes: number | null
  deferredUntil: string | null
  seriesId: string | null
  recurrence: TaskRecurrence | null
  occurrenceDate: string | null
  checklist: TaskChecklistItem[]
  milestone: string
  linkedPaperId: string | null
  linkedSubmissionId: string | null
  sourceType: 'manual' | 'paper' | 'submission' | 'template'
  sourceId: string | null
  order: number
  // Audit timestamps are absolute ISO 8601 UTC instants.
  createdAt: string
  updatedAt: string
  completedAt: string | null
}
export interface TaskChecklistItem {
  id: string
  text: string
  completed: boolean
}
export type TaskCreate = Pick<Task, 'title'> &
  Partial<Pick<Task, 'projectId' | 'scheduledDate' | 'startTime' | 'endTime' | 'description' | 'priority' | 'dueDate' | 'estimatedMinutes' | 'checklist' | 'milestone' | 'linkedPaperId' | 'linkedSubmissionId' | 'sourceType' | 'sourceId'>>
export type TaskPatch = Partial<
  Pick<
    Task,
    | 'title'
    | 'description'
    | 'projectId'
    | 'priority'
    | 'dueDate'
    | 'scheduledDate'
    | 'startTime'
    | 'endTime'
    | 'estimatedMinutes'
    | 'deferredUntil'
    | 'checklist'
    | 'milestone'
    | 'linkedPaperId'
    | 'linkedSubmissionId'
  >
>
export interface TaskSeriesInput extends TaskCreate {
  recurrence: TaskRecurrence
  occurrences: number
}
export interface TaskTemplate {
  id: string
  name: string
  title: string
  description: string
  projectId: string | null
  priority: Priority
  estimatedMinutes: number | null
  checklist: TaskChecklistItem[]
}
export type ProjectInput = Pick<Project, 'name' | 'description' | 'colorKey'>
export type ProjectPatch = Partial<ProjectInput> & { archived?: boolean }
export interface Snapshot {
  tasks: Task[]
  projects: Project[]
  appearance: Appearance
  databasePath: string
}
export type ErrorCode = 'VALIDATION' | 'NOT_FOUND' | 'DATABASE' | 'UNAVAILABLE' | 'FORBIDDEN'
export type Result<T> =
  { ok: true; data: T } | { ok: false; error: { code: ErrorCode; message: string } }
export interface WorkbenchApi {
  saveCheckinAbsence: (input: import('./reports').CheckinAbsenceInput, id?: string) => Promise<Result<import('./reports').CheckinAbsenceEntry>>
  deleteCheckinAbsence: (id: string) => Promise<Result<void>>
  saveCheckin: (input: import('./reports').CheckinInput, id?: string) => Promise<Result<import('./reports').CheckinEntry>>
  deleteCheckin: (id: string) => Promise<Result<void>>
  researchReport: () => Promise<Result<import('./reports').ReportSnapshot>>
  saveReportSettings: (input: import('./reports').ReportSettings) => Promise<Result<void>>
  saveStipend: (input: import('./reports').StipendInput, id?: string) => Promise<Result<import('./reports').StipendEntry>>
  deleteStipend: (id: string) => Promise<Result<void>>
  saveReadingDate: (input: { paperId: string; date: string }) => Promise<Result<void>>
  countdowns: () => Promise<Result<import('./countdowns').ImportantCountdown[]>>
  saveCountdown: (input: import('./countdowns').CountdownInput, id?: string) => Promise<Result<import('./countdowns').ImportantCountdown>>
  deleteCountdown: (id: string) => Promise<Result<void>>
  setWindowPalette: (palette: { background: string; foreground: string }) => Promise<Result<void>>
  generateArxivOverview: (input: { id: string; regenerate?: boolean }) => Promise<Result<import('./overview').PaperOverview>>
  updateSnapshot: () => Promise<Result<import('./update').UpdateSnapshot>>
  prepareUpdate: () => Promise<Result<import('./update').UpdateSnapshot>>
  installUpdate: () => Promise<Result<void>>
  onUpdateChanged: (handler: (snapshot: import('./update').UpdateSnapshot) => void) => () => void
  paperOverview: (id: string) => Promise<Result<import('./overview').PaperOverview | null>>
  generatePaperOverview: (input: import('./overview').PaperOverviewRequest) => Promise<Result<import('./overview').PaperOverview>>
  assistantSettings: () => Promise<Result<import('./assistant').AssistantSettings>>
  saveAssistantSettings: (input: import('./assistant').AssistantSettingsInput) => Promise<Result<import('./assistant').AssistantSettings>>
  setAssistantRecognitionEnabled: (enabled: boolean) => Promise<Result<import('./assistant').AssistantSettings>>
  testAssistant: () => Promise<Result<string>>
  planWithAssistant: (input: import('./assistant').AssistantRequest) => Promise<Result<import('./assistant').AssistantResult>>
  interfacePreferences: () => Promise<Result<import('./interface').InterfaceSnapshot>>
  updateInterfacePreferences: (patch: import('./interface').InterfacePatch) => Promise<Result<import('./interface').InterfacePreferences>>
  uploadBackground: () => Promise<Result<import('./interface').InterfaceSnapshot | null>>
  dailyEncouragement: (retry?: boolean) => Promise<Result<import('./encouragement').DailyEncouragement>>
  openEncouragementSource: () => Promise<Result<void>>
  onEncouragementChanged: (handler: () => void) => () => void
  submissionsSnapshot: () => Promise<Result<SubmissionSnapshot>>
  createSubmission: (input: SubmissionInput) => Promise<Result<Submission>>
  updateSubmission: (id: string, input: SubmissionInput) => Promise<Result<Submission>>
  deleteSubmission: (id: string) => Promise<Result<void>>
  onSubmissionsChanged: (handler: () => void) => () => void
  onOpenSubmissions: (handler: () => void) => () => void
  enrichPaperMetadata: (id: string, input: LocalPaperMetadata) => Promise<Result<Paper>>
  failPaperMetadata: (id: string, message: string) => Promise<Result<void>>
  setMetadataOnline: (enabled: boolean) => Promise<Result<void>>
  storageSnapshot: () => Promise<Result<StorageSnapshot>>
  chooseStorageDirectory: (kind: PaperCollection) => Promise<Result<StorageSnapshot | null>>
  chooseDatabaseDirectory: () => Promise<Result<{ snapshot: StorageSnapshot; retainedSources: string[] } | null>>
  revealStorageDirectory: (kind: PaperCollection | 'database') => Promise<Result<void>>
  saveArxivSettings: (settings: ArxivSettings) => Promise<Result<void>>
  runArxivDaily: () => Promise<Result<void>>
  cancelArxivDaily: () => Promise<Result<void>>
  revealArxivDirectory: () => Promise<Result<void>>
  pickPublicationPdf: () => Promise<Result<string | null>>
  readPublicationPdf: (path: string) => Promise<Result<Uint8Array>>
  previewPublicationMetadata: (input: LocalPaperMetadata, overrides: { title: string; doi: string }) => Promise<Result<PublicationMetadataPreview>>
  createPublication: (path: string | null, metadata: PublicationInput) => Promise<Result<Paper>>
  attachPublicationPdf: (id: string, path: string) => Promise<Result<Paper>>
  exportPublications: (format: 'bibtex' | 'csv', ids?: string[]) => Promise<Result<boolean>>
  librarySnapshot: () => Promise<Result<LibrarySnapshot>>
  onLibraryChanged: (handler: () => void) => () => void
  onTranslationProgress: (handler: (progress: TranslationProgress | null) => void) => () => void
  createFolder: (input: FolderInput) => Promise<Result<LibraryFolder>>
  updateFolder: (id: string, input: FolderInput) => Promise<Result<LibraryFolder>>
  deleteFolder: (id: string) => Promise<Result<void>>
  pickPapers: (folderId: string | null, translate: boolean) => Promise<Result<ImportReport>>
  importPapers: (paths: string[], folderId: string | null, translate: boolean) => Promise<Result<ImportReport>>
  droppedFilePath: (file: File) => string
  updatePaper: (id: string, patch: PaperPatch) => Promise<Result<Paper>>
  deletePaper: (id: string) => Promise<Result<void>>
  retryTranslation: (id: string) => Promise<Result<void>>
  cancelTranslation: (id: string) => Promise<Result<void>>
  setTranslationPaused: (paused: boolean) => Promise<Result<void>>
  reorderTranslations: (ids: string[]) => Promise<Result<void>>
  readPaper: (id: string, variant: PaperVariant) => Promise<Result<Uint8Array>>
  exportPaper: (id: string, variant: PaperVariant) => Promise<Result<boolean>>
  translationHealth: () => Promise<Result<TranslationHealth>>
  installTranslationEngine: () => Promise<Result<TranslationHealth>>
  cancelTranslationEngineInstall: () => Promise<Result<void>>
  translationProfiles: () => Promise<Result<import('./translation').TranslationProfilesSnapshot>>
  saveTranslationProfile: (input: import('./translation').TranslationProfileInput) => Promise<Result<import('./translation').TranslationProfilesSnapshot>>
  activateTranslationProfile: (id: string) => Promise<Result<import('./translation').TranslationProfilesSnapshot>>
  deleteTranslationProfile: (id: string) => Promise<Result<import('./translation').TranslationProfilesSnapshot>>
  chooseTranslationDirectory: () => Promise<Result<string | null>>
  setAutoTranslate: (enabled: boolean) => Promise<Result<void>>
  onBeforeClose: (handler: () => Promise<boolean>) => () => void
  bootstrap: () => Promise<Result<Snapshot>>
  createTask: (input: TaskCreate) => Promise<Result<Task>>
  createTaskSeries: (input: TaskSeriesInput) => Promise<Result<Task[]>>
  updateTaskSeries: (seriesId: string, fromDate: string, patch: TaskPatch) => Promise<Result<Task[]>>
  updateTask: (id: string, patch: TaskPatch) => Promise<Result<Task>>
  completeTask: (id: string, completed: boolean) => Promise<Result<Task>>
  deleteTask: (id: string) => Promise<Result<void>>
  reorderTasks: (ids: string[]) => Promise<Result<Task[]>>
  taskTemplates: () => Promise<Result<TaskTemplate[]>>
  saveTaskTemplate: (template: TaskTemplate) => Promise<Result<TaskTemplate[]>>
  deleteTaskTemplate: (id: string) => Promise<Result<TaskTemplate[]>>
  createProject: (input: ProjectInput) => Promise<Result<Project>>
  updateProject: (id: string, patch: ProjectPatch) => Promise<Result<Project>>
  deleteProject: (id: string, moveToId?: string, taskAction?: ProjectTaskAction) => Promise<Result<void>>
  setAppearance: (appearance: Appearance) => Promise<Result<Appearance>>
  reuseAssistantForTranslation: () => Promise<Result<import('./translation').TranslationProfilesSnapshot>>
  arxivCandidateAction: (id: string, action: 'favorite' | 'unfavorite' | 'ignore' | 'download') => Promise<Result<void>>
  retryArxivTranslations: () => Promise<Result<void>>
}

export interface LibraryFolder {
  id: string
  name: string
  parentId: string | null
  createdAt: string
}
export type FolderInput = Pick<LibraryFolder, 'name' | 'parentId'>
export type TranslationStatus = 'idle' | 'queued' | 'translating' | 'ready' | 'failed' | 'interrupted'
export interface TranslationProgress {
  paperId: string
  stage: string
  percent: number | null
  current: number | null
  total: number | null
  startedAt: string
  updatedAt: string
}
export type PaperVariant = 'source' | 'translated'
export type PaperCollection = 'library' | 'arxiv' | 'publication'
export interface StorageSnapshot {
  directories: Record<PaperCollection, string>
  databasePath: string
}
export interface PublicationInput {
  title: string
  authors: string
  journal: string
  publishedDate: string
  doi: string
  casPartition: string
  jcrQuartile: string
  honors: PublicationHonor[]
  notes: string
  authorRole?: string
  coFirstAuthor?: boolean
  correspondingAuthor?: boolean
  partitionYear?: string
  tags?: string[]
}
export interface PublicationMetadataPreview {
  fields: Pick<PublicationInput, 'title' | 'authors' | 'journal' | 'publishedDate' | 'doi'>
  source: string
  message: string
  status: 'ready' | 'partial'
}
export interface Paper {
  id: string
  collection: PaperCollection
  arxivId: string | null
  abstract: string
  doi: string
  publishedDate: string
  collectedDate: string
  casPartition: string
  jcrQuartile: string
  honors: PublicationHonor[]
  folderId: string | null
  title: string
  authors: string
  journal: string
  year: string
  notes: string
  originalName: string
  sourcePath: string
  translatedPath: string | null
  sha256: string
  translationStatus: TranslationStatus
  translationError: string
  pageCount: number
  readPage: number
  translatedReadPage: number
  readProgress: number
  maxReadPage: number
  readingStatus: ReadingStatus
  tags: string[]
  excerpts: PaperExcerpt[]
  highlights: PaperHighlight[]
  authorRole: string
  coFirstAuthor: boolean
  correspondingAuthor: boolean
  partitionYear: string
  matchReason: string
  arxivFavorite: boolean
  arxivIgnored: boolean
  linkedSubmissionId: string | null
  translationOrder: number
  metadataStatus: 'pending' | 'ready' | 'partial' | 'failed'
  metadataSource: string
  metadataMessage: string
  metadataCheckedAt: string | null
  metadataLockedFields: string
  lastReadAt: string | null
  addedAt: string
  updatedAt: string
}
export interface PaperExcerpt {
  id: string
  page: number
  text: string
  createdAt: string
}
export type PaperHighlightColor = 'focus' | 'method' | 'evidence' | 'question'
export interface PaperHighlightRect {
  x: number
  y: number
  width: number
  height: number
}
export interface PaperHighlight {
  id: string
  page: number
  text: string
  color: PaperHighlightColor
  rects: PaperHighlightRect[]
  createdAt: string
  variant?: PaperVariant
}
export type PaperPatch = Partial<Pick<Paper, 'folderId' | 'title' | 'authors' | 'journal' | 'year' | 'notes' | 'pageCount' | 'readPage' | 'translatedReadPage' | 'readProgress' | 'maxReadPage' | 'readingStatus' | 'tags' | 'excerpts' | 'highlights' | 'lastReadAt' | 'doi' | 'publishedDate' | 'casPartition' | 'jcrQuartile' | 'honors' | 'authorRole' | 'coFirstAuthor' | 'correspondingAuthor' | 'partitionYear' | 'matchReason' | 'arxivFavorite' | 'arxivIgnored' | 'linkedSubmissionId' | 'originalName' | 'sourcePath' | 'sha256'>>
export interface LibrarySnapshot {
  translationProgress: TranslationProgress | null
  metadataOnline: boolean
  metadataAutomatic: boolean
  arxiv: ArxivSnapshot
  folders: LibraryFolder[]
  papers: Paper[]
  autoTranslate: boolean
  serverDirectory: string
  translationPaused: boolean
}

export interface LocalPaperMetadata {
  title: string
  authors: string
  journal: string
  year: string
  doi: string
  pageCount: number
  titleReliable: boolean
  publishedDate?: string
}
export const legacySubmissionStatuses = ['draft', 'submitted', 'under_review', 'revision', 'resubmitted', 'accepted', 'rejected', 'withdrawn'] as const
export type LegacySubmissionStatus = (typeof legacySubmissionStatuses)[number]
export interface SubmissionStageInput {
  id?: string
  name: string
  occurredOn: string
}
export interface SubmissionStage {
  id: string
  submissionId: string
  name: string
  occurredOn: string
  position: number
  createdAt: string
  updatedAt: string
}
export interface SubmissionInput {
  title: string
  journal: string
  manuscriptId: string
  stages: SubmissionStageInput[]
  revisionDueDate: string | null
  reminderEnabled: boolean
  reminderDays: number
  notes: string
  revisionCompleted?: boolean
  ended?: boolean
  projectId?: string | null
  manuscriptPaperId?: string | null
  manuscriptGroupId?: string
  sourceSubmissionId?: string | null
  reviewItems?: RevisionItem[]
}
export interface Submission extends Omit<SubmissionInput, 'stages'> {
  id: string
  stages: SubmissionStage[]
  submittedDate: string | null
  currentStage: string
  createdAt: string
  updatedAt: string
  revisionCompleted: boolean
  ended: boolean
  projectId: string | null
  manuscriptPaperId: string | null
  manuscriptGroupId: string
  sourceSubmissionId: string | null
  reviewItems: RevisionItem[]
}
export interface RevisionItem {
  id: string
  reviewer: string
  content: string
  completed: boolean
  materialLink: string
  taskId: string | null
}
export interface SubmissionSnapshot {
  submissions: Submission[]
  notificationsSupported: boolean
  notificationError: string
}
export interface ImportReport {
  added: number
  duplicates: number
  failures: string[]
}
export interface TranslationHealth {
  running: boolean
  installed: boolean
  configured: boolean
  serverDirectory: string
  activeProfile: import('./translation').TranslationApiProfile
  installation: TranslationEngineInstallation
  message: string
}

export interface TranslationEngineInstallation {
  state: 'idle' | 'downloading' | 'verifying' | 'extracting' | 'ready' | 'error'
  progress: number | null
  downloadedBytes: number
  totalBytes: number | null
  message: string
}

export interface ArxivSettings {
  enabled: boolean
  daysBack: number
  maxPerDay: number
  // Each line is a direction; AND joins phrases within that direction.
  directions: string[]
  excludedKeywords: string[]
}
export interface ArxivCandidate {
  id: string
  arxivId: string
  pdfId: string
  title: string
  authors: string
  abstract: string
  journal: string
  publishedDate: string
  doi: string
  matchReason: string
  favorite: boolean
  ignored: boolean
  overview?: import('./overview').PaperOverview
  translationState?: 'queued' | 'translating' | 'failed'
  translationError?: string
}
export interface ArxivRun {
  id: string
  date: string
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'success' | 'partial' | 'failed' | 'cancelled' | 'interrupted'
  downloaded: number
  candidates: number
  message: string
  failures: string[]
}
export interface ArxivSnapshot {
  settings: ArxivSettings
  running: boolean
  progress: string
  runs: ArxivRun[]
  directory: string
  candidates: ArxivCandidate[]
  downloads: { id: string; status: 'queued' | 'downloading' | 'failed'; error: string }[]
  preparation: { pending: number; failed: number; ready: number; error: string }
}
