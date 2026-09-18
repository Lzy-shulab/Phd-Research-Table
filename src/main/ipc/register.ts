import { app, dialog, ipcMain, nativeTheme, powerMonitor, shell, session, type BrowserWindow } from 'electron'
import { dirname, join } from 'node:path'
import { z, ZodError } from 'zod'
import { DomainError } from '../../domain/errors'
import {
  appearanceSchema,
  idSchema,
  projectCreateSchema,
  projectPatchSchema,
  reorderSchema,
  taskCreateSchema,
  taskPatchSchema
} from '../../domain/validation'
import { TaskRepository } from '../database/repositories/tasks'
import { ProjectRepository } from '../database/repositories/projects'
import { SettingsRepository } from '../database/repositories/settings'
import type { DatabaseConnection } from '../database/db'
import type { Result } from '../../shared/types'
import { LibraryService } from '../library/service'
import { arxivSettingsSchema, publicationFields, publicationSchema } from '../../domain/research'
import { isPublicationDate } from '../../domain/validation'
import { relocateDatabase } from '../database/relocate'
import { StoragePaths } from '../library/storage-paths'
import { LibraryRepository } from '../database/repositories/library'
import { SubmissionRepository } from '../database/repositories/submissions'
import { submissionSchema } from '../../domain/submissions'
import { SubmissionReminders } from '../submissions/reminders'
import { localMetadataSchema } from '../../domain/metadata'
import { enrichMetadata, previewPublicationMetadata } from '../library/metadata'
import { DailyEncouragementService } from '../encouragement/service'
import { encouragementSourcePage } from '../../shared/encouragement'
import { InterfaceService } from '../interface/service'
import { interfacePatchSchema } from '../../domain/interface'
import { translationProviders } from '../../shared/translation'
import { AssistantService } from '../assistant/service'
import { assistantRecognitionSchema, assistantRequestSchema, assistantSettingsSchema } from '../../domain/assistant'
import { overviewRequestSchema } from '../../domain/overview'
import { PaperOverviewService } from '../library/overview'
import { UpdateService } from '../update/service'

export function registerIpc(
  getConnection: () => DatabaseConnection,
  getWindow: () => BrowserWindow | null,
  isTrustedUrl: (url: string) => boolean,
  runtime?: { migrationsFolder: string; setRelocating: (value: boolean) => void; activateDatabase: (connection: DatabaseConnection) => void }
): () => void {
  let relocating = false
  const requests = new Set<Promise<unknown>>()
  const handle = (channel: string, handler: (...args: unknown[]) => unknown) => {
    ipcMain.handle(channel, async (event, ...args: unknown[]): Promise<Result<unknown>> => {
      const window = getWindow()
      if (
        !window ||
        event.sender !== window.webContents ||
        event.senderFrame !== window.webContents.mainFrame ||
        !isTrustedUrl(event.senderFrame.url)
      ) {
        return { ok: false, error: { code: 'FORBIDDEN', message: '无法执行此请求。' } }
      }
      try {
        if (relocating) throw new DomainError('UNAVAILABLE', '工作台数据正在迁移，请稍候。')
        const request = Promise.resolve().then(() => handler(...args))
        if (channel !== 'storage:database-choose') requests.add(request)
        try { return { ok: true, data: await request } }
        finally { requests.delete(request) }
      } catch (error) {
        if (error instanceof ZodError)
          return {
            ok: false,
            error: { code: 'VALIDATION', message: error.issues[0]?.message ?? '请求内容无效。' }
          }
        if (error instanceof DomainError)
          return { ok: false, error: { code: error.code, message: error.message } }
        console.error(`[${channel}]`, error)
        return {
          ok: false,
          error: {
            code: 'DATABASE',
            message:
              '无法访问本地数据库，修改尚未保存。请检查磁盘空间和文件夹权限后重试。'
          }
        }
      }
    })
  }
  const taskRepo = () => new TaskRepository(getConnection().db)
  const assistant = new AssistantService(getConnection)
  const overviews = new PaperOverviewService(getConnection, (title, abstract) => assistant.translateOverview(title, abstract))
  handle('library:overview', (id) => overviews.read(idSchema.parse(id)))
  handle('library:overview-generate', (input) => overviews.generate(overviewRequestSchema.parse(input)))
  handle('assistant:settings', () => assistant.snapshot())
  handle('assistant:save', (input) => assistant.save(assistantSettingsSchema.parse(input)))
  handle('assistant:recognition', (enabled) => assistant.setQuickRecognition(assistantRecognitionSchema.parse(enabled)))
  handle('assistant:test', () => assistant.test())
  handle('assistant:plan', (input) => assistant.run(assistantRequestSchema.parse(input)))
  const interfaceService = new InterfaceService(() => new SettingsRepository(getConnection().db), getWindow)
  handle('interface:snapshot', () => interfaceService.snapshot())
  handle('interface:update', (patch) => interfaceService.update(interfacePatchSchema.parse(patch)))
  handle('interface:upload', () => interfaceService.upload())
  const encouragement = new DailyEncouragementService(() => {
    const repo = new SettingsRepository(getConnection().db)
    return { read: () => repo.getEncouragement(), write: (value) => repo.setEncouragement(value) }
  })
  handle('encouragement:daily', (retry) => encouragement.get(z.boolean().optional().parse(retry)))
  handle('encouragement:source', () => shell.openExternal(encouragementSourcePage))
  const encouragementChanged = () => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('encouragement:changed') }
  const resumeEncouragement = () => { if (!relocating) void encouragement.catchUp() }
  powerMonitor.on('resume', resumeEncouragement)
  const projectRepo = () => new ProjectRepository(getConnection().db)
  const submissionRepo = () => new SubmissionRepository(getConnection().db)
  const submissionsChanged = () => { const window = getWindow(); if (window && !window.isDestroyed()) window.webContents.send('submissions:changed') }
  const reminders = new SubmissionReminders(getConnection, getWindow, () => relocating, submissionsChanged)
  let service: LibraryService | undefined
  const translationEngineSession = session.fromPartition('workbench-translation-engine-network', { cache: false })
  const library = () => service ??= new LibraryService(getConnection(), getWindow, undefined, {
    translationEngineRoot: join(app.getPath('userData'), 'translation-engine'),
    // A separate Chromium session follows the Windows proxy/PAC and certificate settings.
    translationEngineFetcher: ((input, init) => translationEngineSession.fetch(String(input), init)) as typeof fetch
  })
  const updateSession = session.fromPartition('workbench-update-network', { cache: false })
  const updates = new UpdateService({
    currentVersion: app.getVersion(),
    installable: app.isPackaged && process.platform === 'win32',
    cacheDirectory: join(app.getPath('temp'), 'PhD-Research-Workbench', 'updates'),
    getWindow,
    quit: () => app.quit(),
    // Electron's Chromium network stack follows Windows system proxy/PAC settings.
    // The Node path exists only so the development smoke test can inject a deterministic response.
    fetcher: !app.isPackaged && process.env.WORKBENCH_UPDATE_TEST_NODE_FETCH === '1'
      ? ((input, init) => globalThis.fetch(input, init))
      : ((input, init) => updateSession.fetch(String(input), init)) as typeof fetch
  })
  handle('update:snapshot', () => updates.snapshot())
  handle('update:prepare', () => updates.prepare())
  handle('update:install', async () => {
    if (requests.size > 1) throw new DomainError('VALIDATION', '请等待当前操作完成后再安装更新。')
    if (library().busy()) throw new DomainError('VALIDATION', '请等待文献下载、翻译或引擎安装完成后再安装更新。')
    await updates.install()
  })
  const folderSchema = z.object({ name: z.string().trim().min(1, '请填写文件夹名称。').max(100), parentId: idSchema.nullable() }).strict()
  const variantSchema = z.enum(['source', 'translated'])
  const translationProfileSchema = z.object({
    id: z.string().min(1).max(100).optional(),
    name: z.string().trim().min(1, '请填写配置名称。').max(80),
    provider: z.enum(translationProviders),
    model: z.string().max(300),
    baseUrl: z.string().max(2000),
    apiKey: z.string().max(10000).optional(),
    clearApiKey: z.boolean().optional()
  }).strict()
  const paperPatchSchema = z.object({
    folderId: idSchema.nullable(), title: z.string().trim().min(1, '请填写文献标题。').max(1000),
    authors: z.string().max(2000), journal: z.string().max(500), year: z.string().max(10), notes: z.string().max(50000),
    pageCount: z.number().int().min(1).max(100000), readPage: z.number().int().min(1).max(100000),
    translatedReadPage: z.number().int().min(1).max(100000), readProgress: z.number().int().min(0).max(100), lastReadAt: z.iso.datetime().nullable(),
    doi: publicationFields.doi, casPartition: publicationFields.casPartition, jcrQuartile: publicationFields.jcrQuartile,
    honors: publicationFields.honors,
    publishedDate: z.string().refine((value) => !value || isPublicationDate(value), '请输入有效发表年份、月份或日期。')
  }).partial().strict()
  handle('library:snapshot', () => library().snapshot())
  handle('metadata:enrich', async (id, input) => {
    const paper = await enrichMetadata(library().repo, idSchema.parse(id), localMetadataSchema.parse(input))
    library().changed(); return paper
  })
  handle('metadata:failed', (id, message) => {
    library().repo.metadata(idSchema.parse(id), { metadataStatus: 'failed', metadataMessage: z.string().max(700).parse(message), metadataCheckedAt: new Date().toISOString() })
    library().changed()
  })
  handle('metadata:online', (enabled) => { library().repo.setSetting('metadata.online', String(z.boolean().parse(enabled))); library().changed() })
  handle('submissions:snapshot', () => ({ submissions: submissionRepo().list(), ...reminders.snapshot() }))
  handle('submission:create', (input) => { const submission = submissionRepo().create(submissionSchema.parse(input)); submissionsChanged(); reminders.check(); return submission })
  handle('submission:update', (id, input) => { const submission = submissionRepo().update(idSchema.parse(id), submissionSchema.parse(input)); submissionsChanged(); reminders.check(); return submission })
  handle('submission:delete', (id) => { submissionRepo().delete(idSchema.parse(id)); submissionsChanged() })
  const storageKind = z.enum(['library', 'publication', 'arxiv'])
  handle('storage:snapshot', () => library().storage.snapshot())
  handle('storage:choose', (kind) => library().chooseStorageDirectory(storageKind.parse(kind)))
  handle('storage:reveal', (kind) => library().storage.reveal(z.enum(['library', 'publication', 'arxiv', 'database']).parse(kind)))
  handle('storage:database-choose', async () => {
    const window = getWindow()
    if (!runtime || !window) throw new DomainError('UNAVAILABLE', '当前运行环境不支持迁移工作台数据。')
    if (library().busy()) throw new DomainError('VALIDATION', '请等待下载和翻译完成，或停止检索后再迁移工作台数据。')
    const selected = await dialog.showOpenDialog(window, { title: '选择工作台数据保存文件夹', defaultPath: dirname(getConnection().path), properties: ['openDirectory', 'createDirectory'] })
    if (selected.canceled || !selected.filePaths[0]) return null
    relocating = true; runtime.setRelocating(true)
    try {
      await Promise.allSettled([...requests])
      await encouragement.idle()
      if (library().busy()) throw new DomainError('VALIDATION', '下载或翻译仍在进行，完成后再迁移。')
      service?.stop()
      service = undefined
      const report = await relocateDatabase(getConnection(), { directory: selected.filePaths[0], migrationsFolder: runtime.migrationsFolder, activate: runtime.activateDatabase })
      return { snapshot: new StoragePaths(new LibraryRepository(getConnection().db), getConnection().path).snapshot(), retainedSources: report.retainedSources }
    } finally {
      relocating = false; runtime.setRelocating(false)
      if (process.env.WORKBENCH_DISABLE_ARXIV_AUTO !== '1') library().arxiv.startAutomatic()
    }
  })
  handle('arxiv:settings', (settings) => library().arxiv.configure(arxivSettingsSchema.parse(settings)))
  handle('arxiv:run', () => library().arxiv.start())
  handle('arxiv:cancel', () => library().arxiv.cancel())
  handle('arxiv:directory', () => library().arxiv.reveal())
  handle('publication:pick', () => library().pickPublicationPdf())
  handle('publication:read-selected', (path) => library().readPublicationPdf(z.string().min(1).max(32000).parse(path)))
  handle('publication:metadata-preview', (input, overrides) => previewPublicationMetadata(localMetadataSchema.parse(input), library().repo.setting('metadata.online', 'true') === 'true',
    z.object({ title: z.string().max(1000), doi: publicationFields.doi }).strict().parse(overrides)))
  handle('publication:create', (path, metadata) => library().createPublication(z.string().min(1).max(32000).parse(path), publicationSchema.parse(metadata)))
  handle('library:folder-create', (input) => {
    const folder = library().repo.createFolder(folderSchema.parse(input)); library().changed(); return folder
  })
  handle('library:folder-update', (id, input) => {
    const folder = library().repo.updateFolder(idSchema.parse(id), folderSchema.parse(input)); library().changed(); return folder
  })
  handle('library:folder-delete', (id) => { library().repo.deleteFolder(idSchema.parse(id)); library().changed() })
  handle('library:pick', (folderId, translate) => library().pickPapers(idSchema.nullable().parse(folderId), z.boolean().parse(translate)))
  handle('library:import', (paths, folderId, translate) => library().importPapers(
    z.array(z.string().min(1).max(32000)).max(100).parse(paths), idSchema.nullable().parse(folderId), z.boolean().parse(translate)))
  handle('library:paper-update', (id, patch) => {
    const parsedId = idSchema.parse(id), parsedPatch = paperPatchSchema.parse(patch)
    const existing = library().repo.paper(parsedId)
    if (existing.collection === 'publication') {
      const merged = { ...existing, ...parsedPatch }
      publicationSchema.parse(Object.fromEntries(Object.keys(publicationFields).map((key) => [key, merged[key as keyof typeof merged]])))
      if (parsedPatch.publishedDate) parsedPatch.year = parsedPatch.publishedDate.slice(0, 4)
    }
    const paper = library().repo.updatePaper(parsedId, parsedPatch, true); library().changed(); return paper
  })
  handle('library:paper-delete', (id) => library().delete(idSchema.parse(id)))
  handle('library:retry', (id) => library().retry(idSchema.parse(id)))
  handle('library:read', (id, variant) => library().read(idSchema.parse(id), variantSchema.parse(variant)))
  handle('library:export', (id, variant) => library().export(idSchema.parse(id), variantSchema.parse(variant)))
  handle('library:health', () => library().health())
  handle('library:engine-install', () => library().installTranslationEngine())
  handle('library:engine-install-cancel', () => library().cancelTranslationEngineInstall())
  handle('library:translation-profiles', () => library().profiles())
  handle('library:translation-profile-save', (input) => library().saveProfile(translationProfileSchema.parse(input)))
  handle('library:translation-profile-activate', (id) => library().activateProfile(z.string().min(1).max(100).parse(id)))
  handle('library:translation-profile-delete', (id) => library().deleteProfile(z.string().min(1).max(100).parse(id)))
  handle('library:directory', () => library().chooseDirectory())
  handle('library:auto', async (enabled) => {
    const value = z.boolean().parse(enabled)
    if (value) {
      const health = await library().health()
      if (!health.installed || !health.configured) throw new DomainError('VALIDATION', health.message)
    }
    library().repo.setSetting('translation.auto', String(value)); library().changed()
  })
  handle('workbench:bootstrap', () => {
    const connection = getConnection()
    reminders.start()
    encouragement.start(encouragementChanged, () => relocating)
    if (process.env.WORKBENCH_DISABLE_ARXIV_AUTO !== '1') library().arxiv.startAutomatic()
    return {
      tasks: taskRepo().list(),
      projects: projectRepo().list(),
      appearance: new SettingsRepository(connection.db).getAppearance(),
      databasePath: connection.path
    }
  })
  handle('task:create', (input) => taskRepo().create(taskCreateSchema.parse(input)))
  handle('task:update', (id, patch) =>
    taskRepo().update(idSchema.parse(id), taskPatchSchema.parse(patch))
  )
  handle('task:complete', (id, completed) =>
    taskRepo().complete(idSchema.parse(id), z.boolean().parse(completed))
  )
  handle('task:delete', (id) => taskRepo().delete(idSchema.parse(id)))
  handle('task:reorder', (ids) => taskRepo().reorder(reorderSchema.parse(ids)))
  handle('project:create', (input) => projectRepo().create(projectCreateSchema.parse(input)))
  handle('project:update', (id, patch) =>
    projectRepo().update(idSchema.parse(id), projectPatchSchema.parse(patch))
  )
  handle('project:delete', (id, moveToId) => projectRepo().delete(idSchema.parse(id), idSchema.optional().parse(moveToId)))
  handle('settings:appearance', (input) => {
    const appearance = appearanceSchema.parse(input)
    new SettingsRepository(getConnection().db).setAppearance(appearance)
    nativeTheme.themeSource = appearance
    return appearance
  })
  return () => { encouragement.stop(); powerMonitor.removeListener('resume', resumeEncouragement); reminders.stop(); service?.stop() }
}
