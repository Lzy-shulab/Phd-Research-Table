import { dialog, shell, type BrowserWindow } from 'electron'
import { randomUUID, createHash } from 'node:crypto'
import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import { runTranslation, terminateTranslator, translationConfigTemplate, translatorExecutable } from './translator'
import type { DatabaseConnection } from '../database/db'
import { LibraryRepository } from '../database/repositories/library'
import { DomainError } from '../../domain/errors'
import type { ImportReport, LibrarySnapshot, Paper, PaperCollection, PaperVariant, PublicationInput, TranslationHealth, TranslationProgress } from '../../shared/types'
import type { TranslationProfileInput } from '../../shared/translation'
import type { EngineProgress } from './translation-progress'
import { localDay, paperMetadataDefaults } from '../../shared/arxiv'
import { ArxivDailyService, type ArxivEntry } from './arxiv'
import { StorageService } from './storage'
import { TranslationProfileStore, type SecretProtector } from './translation-profiles'
import { TranslationEngineInstaller } from './engine-installer'

const LEGACY_DEFAULT_DIRECTORY = 'D:\\Python\\zotero-pdf2zh\\server'
const MAX_PDF_SIZE = 100 * 1024 * 1024
const message = (error: unknown) => error instanceof Error ? error.message : '操作未完成。'

export interface LibraryServiceRuntime {
  translationEngineRoot: string
  translationEngineFetcher: typeof fetch
}

export class LibraryService {
  readonly repo: LibraryRepository
  readonly arxiv: ArxivDailyService
  readonly storage: StorageService
  readonly translationProfiles: TranslationProfileStore
  private readonly engineInstaller: TranslationEngineInstaller | null
  private running = false
  private stopping = false
  private activeChild: ChildProcess | null = null
  private activePaperId: string | null = null
  private translationPaused = false
  private cancelledTranslations = new Set<string>()
  private progress: TranslationProgress | null = null
  private progressSentAt = 0
  private progressTimer: ReturnType<typeof setTimeout> | null = null
  private publicationSelections = new Set<string>()
  constructor(connection: DatabaseConnection, private readonly window: () => BrowserWindow | null, secretProtector?: SecretProtector, runtime?: LibraryServiceRuntime) {
    this.repo = new LibraryRepository(connection.db)
    this.translationPaused = this.repo.setting('translation.paused', 'false') === 'true'
    this.storage = new StorageService(this.repo, connection.path, window)
    this.translationProfiles = new TranslationProfileStore(this.repo, secretProtector)
    this.engineInstaller = runtime ? new TranslationEngineInstaller({
      rootDirectory: runtime.translationEngineRoot,
      fetcher: runtime.translationEngineFetcher,
      onChange: () => this.changed()
    }) : null
    this.arxiv = new ArxivDailyService(this.repo, (entry, bytes, day) => this.addArxiv(entry, bytes, day),
      () => this.changed(), () => this.storage.directory('arxiv'))
    for (const paper of this.repo.papers()) {
      if (paper.translationStatus === 'translating')
        this.repo.translation(paper.id, 'interrupted', '应用在翻译完成前关闭。原文已保存，可以重试。')
    }
    void this.pump()
  }
  changed() {
    const window = this.window()
    if (window && !window.isDestroyed()) window.webContents.send('library:changed')
  }
  private publishProgress(value: TranslationProgress | null) {
    const previous = this.progress
    this.progress = value
    const now = Date.now()
    if (value && previous && value.stage === previous.stage && now - this.progressSentAt < 200) {
      if (!this.progressTimer) this.progressTimer = setTimeout(() => {
        this.progressTimer = null
        this.publishProgress(this.progress)
      }, 200 - (now - this.progressSentAt))
      return
    }
    if (this.progressTimer) { clearTimeout(this.progressTimer); this.progressTimer = null }
    this.progressSentAt = now
    const window = this.window()
    if (window && !window.isDestroyed()) window.webContents.send('library:translation-progress', value)
  }
  private updateProgress(paperId: string, value: EngineProgress) {
    if (this.stopping || this.progress?.paperId !== paperId) return
    this.publishProgress({ ...this.progress, ...value,
      percent: value.percent === null ? this.progress.percent : Math.max(this.progress.percent ?? 0, value.percent),
      updatedAt: new Date().toISOString() })
  }
  directory() {
    const configured = this.repo.setting('translation.directory', '')
    if (configured) return configured
    const managed = this.engineInstaller?.managedDirectory()
    if (managed && translatorExecutable(managed)) return managed
    return process.env.WORKBENCH_DISABLE_LEGACY_TRANSLATION_ENGINE !== '1' && translatorExecutable(LEGACY_DEFAULT_DIRECTORY)
      ? LEGACY_DEFAULT_DIRECTORY : ''
  }
  busy() { return this.running || this.arxiv.busy() || this.engineInstaller?.busy() === true }
  async chooseStorageDirectory(kind: PaperCollection) {
    const result = await this.storage.choose(kind, () => {
      if (kind === 'arxiv' && this.arxiv.busy())
        throw new DomainError('VALIDATION', '请先等待本次检索完成或停止检索，再更换下载目录。')
    })
    if (result) this.changed()
    return result
  }
  snapshot(): LibrarySnapshot {
    const serverDirectory = this.directory()
    const installed = !!serverDirectory && !!translatorExecutable(serverDirectory) && !!translationConfigTemplate(serverDirectory)
    return { translationProgress: this.progress, arxiv: this.arxiv.snapshot(), folders: this.repo.folders(), papers: this.repo.papers(), metadataOnline: this.repo.setting('metadata.online', 'true') === 'true', metadataAutomatic: process.env.WORKBENCH_DISABLE_METADATA_AUTO !== '1',
      autoTranslate: installed && this.repo.setting('translation.auto', 'true') === 'true', serverDirectory, translationPaused: this.translationPaused }
  }
  async health(): Promise<TranslationHealth> {
    const serverDirectory = this.directory()
    const installed = !!serverDirectory && !!translatorExecutable(serverDirectory) && !!translationConfigTemplate(serverDirectory)
    const profiles = this.translationProfiles.snapshot()
    const activeProfile = profiles.profiles.find((profile) => profile.id === profiles.activeId)!
    let configured = activeProfile.ready
    let configurationMessage = ''
    if (configured) {
      try { this.translationProfiles.runtimeActive() }
      catch (error) { configured = false; configurationMessage = message(error) }
    }
    const installation = this.engineInstaller?.snapshot() ?? { state: 'idle' as const, progress: null, downloadedBytes: 0, totalBytes: null, message: '当前运行方式不支持自动安装。' }
    const installing = ['downloading', 'verifying', 'extracting'].includes(installation.state)
    return { installed, configured, running: !!this.activeChild, serverDirectory, activeProfile, installation,
      message: installing ? installation.message
        : !installed ? '尚未安装 PDF2zh 引擎。可一键安装官方环境，或选择已有环境。'
        : !configured ? (configurationMessage || `“${activeProfile.name}”尚未补全 API 配置`)
          : this.activeChild ? `正在使用“${activeProfile.name}”翻译文献` : `本地配置已就绪：${activeProfile.name}` }
  }
  profiles() { return this.translationProfiles.snapshot() }
  saveProfile(input: TranslationProfileInput) {
    const result = this.translationProfiles.save(input)
    this.changed()
    void this.pump()
    return result
  }
  activateProfile(id: string) {
    const result = this.translationProfiles.activate(id)
    this.changed()
    void this.pump()
    return result
  }
  deleteProfile(id: string) { const result = this.translationProfiles.delete(id); this.changed(); return result }
  async installTranslationEngine() {
    if (!this.engineInstaller) throw new DomainError('UNAVAILABLE', '当前运行方式不支持自动安装，请选择已有 PDF2zh 环境。')
    if (this.running || this.arxiv.busy()) throw new DomainError('VALIDATION', '请等待当前文献任务完成后再安装翻译引擎。')
    const directory = await this.engineInstaller.install()
    this.repo.setSetting('translation.directory', directory)
    this.changed()
    void this.pump()
    return this.health()
  }
  cancelTranslationEngineInstall() { this.engineInstaller?.stop() }
  async chooseDirectory() {
    const window = this.window()
    if (!window) throw new DomainError('UNAVAILABLE', '工作区窗口不可用。')
    const result = await dialog.showOpenDialog(window, { title: '选择 PDF2zh 引擎文件夹', properties: ['openDirectory'] })
    const directory = result.filePaths[0]
    if (result.canceled || !directory) return null
    if (!translatorExecutable(directory))
      throw new DomainError('VALIDATION', '所选文件夹中未找到 pdf2zh_next.exe；可选择官方压缩包解压后的根目录或 pdf2zh 文件夹。')
    if (this.running || this.engineInstaller?.busy()) throw new DomainError('VALIDATION', '翻译或引擎安装完成后再更换服务文件夹。')
    this.repo.setSetting('translation.directory', directory)
    this.changed()
    void this.pump()
    return directory
  }
  async pickPapers(folderId: string | null, translate: boolean): Promise<ImportReport> {
    const window = this.window()
    if (!window) throw new DomainError('UNAVAILABLE', '工作区窗口不可用。')
    const result = await dialog.showOpenDialog(window, {
      title: '添加文献 PDF', properties: ['openFile', 'multiSelections'], filters: [{ name: 'PDF 文献', extensions: ['pdf'] }]
    })
    return result.canceled ? { added: 0, duplicates: 0, failures: [] } : this.importPapers(result.filePaths, folderId, translate)
  }
  private async pdfBytes(path: string) {
    const info = await stat(path)
    if (!info.isFile() || extname(path).toLowerCase() !== '.pdf') throw new Error('请选择 PDF 文件。')
    if (info.size > MAX_PDF_SIZE) throw new Error('单篇 PDF 暂支持最大 100 MB。')
    const bytes = await readFile(path)
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件内容不是有效的 PDF。')
    return bytes
  }
  async importPapers(paths: string[], folderId: string | null, translate: boolean): Promise<ImportReport> {
    if (folderId) this.repo.folder(folderId)
    if (translate) {
      const health = await this.health()
      if (!health.installed || !health.configured) throw new DomainError('VALIDATION', health.message)
    }
    const report: ImportReport = { added: 0, duplicates: 0, failures: [] }
    const root = this.storage.directory('library')
    for (const path of paths) {
      let ownedDirectory: string | undefined
      try {
        const bytes = await this.pdfBytes(path)
        const sha256 = createHash('sha256').update(bytes).digest('hex')
        if (this.repo.byHash(sha256)) { report.duplicates++; continue }
        const id = randomUUID(), now = new Date().toISOString()
        ownedDirectory = join(root, id)
        await mkdir(ownedDirectory, { recursive: true })
        const sourcePath = join(ownedDirectory, 'source.pdf')
        await writeFile(sourcePath, bytes, { flag: 'wx' })
        this.repo.insert({ ...paperMetadataDefaults, id, folderId, title: basename(path, extname(path)), authors: '', journal: '', year: '', notes: '',
          originalName: basename(path), sourcePath, translatedPath: null, sha256,
          translationStatus: translate ? 'queued' : 'idle', translationError: '', pageCount: 0,
          readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now })
        report.added++
      } catch (error) {
        // Only clean the UUID-owned directory created by this import attempt.
        if (ownedDirectory) await rm(ownedDirectory, { recursive: true, force: true }).catch(() => undefined)
        report.failures.push(`${basename(path)}：${message(error)}`)
      }
    }
    this.changed()
    void this.pump()
    return report
  }
  private async saveOwned(bytes: Buffer, fields: PublicationInput | ArxivEntry, day?: string) {
    const collection = day ? 'arxiv' : 'publication'
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (this.repo.byHash(sha256, collection)) throw new DomainError('VALIDATION', '这份 PDF 已在当前页面中，请编辑已有卡片。')
    const now = new Date().toISOString()
    const paper: Paper = {
      ...paperMetadataDefaults, ...fields, id: randomUUID(), collection, collectedDate: day ?? '', folderId: null,
      title: fields.title, authors: fields.authors, journal: fields.journal, year: fields.publishedDate.slice(0, 4),
      honors: 'honors' in fields ? [...fields.honors] : [],
      notes: 'notes' in fields ? fields.notes : '', originalName: `${Array.from(fields.title).filter((char) => char.charCodeAt(0) >= 32).join('').replace(/[<>:"/\\|?*]/g, '_').slice(0, 140)}.pdf`,
      sourcePath: '', translatedPath: null, sha256, translationStatus: 'idle', translationError: '', metadataStatus: 'ready', metadataSource: day ? 'arXiv' : '手动填写',
      pageCount: 0, readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now
    }
    const directory = this.storage.paperDirectory(paper)
    paper.sourcePath = join(directory, 'source.pdf')
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(paper.sourcePath, bytes, { flag: 'wx' })
      if (this.stopping) throw new Error('应用已关闭，保存未完成。')
      if (day) this.repo.insertArxiv(paper); else this.repo.insert(paper)
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw error
    }
    this.changed()
    return paper
  }
  private async addArxiv(entry: ArxivEntry, bytes: Buffer, day = localDay()) {
    return this.saveOwned(bytes, entry, day)
  }
  async pickPublicationPdf() {
    const window = this.window()
    if (!window) throw new DomainError('UNAVAILABLE', '工作区窗口不可用。')
    const result = await dialog.showOpenDialog(window, { title: '选择已发表成果 PDF', properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    const selected = result.canceled ? null : result.filePaths[0] ?? null
    if (selected) {
      if (this.publicationSelections.size >= 10) this.publicationSelections.delete(this.publicationSelections.values().next().value!)
      this.publicationSelections.add(selected)
    }
    return selected
  }
  async readPublicationPdf(path: string) {
    if (!this.publicationSelections.has(path)) throw new DomainError('FORBIDDEN', '请先通过成果上传窗口选择这份 PDF。')
    try { return new Uint8Array(await this.pdfBytes(path)) }
    catch (error) { throw new DomainError('UNAVAILABLE', `PDF 未能读取：${message(error)}`) }
  }
  async createPublication(path: string | null, metadata: PublicationInput) {
    try {
      if (path) return await this.saveOwned(await this.pdfBytes(path), metadata)
      const id = randomUUID(), now = new Date().toISOString()
      const paper: Paper = {
        ...paperMetadataDefaults, ...metadata, id, collection: 'publication', folderId: null, arxivId: null,
        title: metadata.title, authors: metadata.authors, journal: metadata.journal,
        year: metadata.publishedDate.slice(0, 4), notes: metadata.notes, honors: [...metadata.honors],
        authorRole: metadata.authorRole ?? '', coFirstAuthor: metadata.coFirstAuthor ?? false,
        correspondingAuthor: metadata.correspondingAuthor ?? false, partitionYear: metadata.partitionYear ?? '',
        tags: metadata.tags ?? [], originalName: '', sourcePath: '', translatedPath: null,
        sha256: `metadata:${id}`, translationStatus: 'idle', translationError: '', pageCount: 0,
        readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now,
        metadataStatus: 'ready', metadataSource: '手动填写'
      }
      this.repo.insert(paper); this.changed(); return paper
    }
    catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', `成果未能保存：${message(error)}`)
    }
  }
  async attachPublicationPdf(id: string, path: string) {
    const paper = this.repo.paper(id)
    if (paper.collection !== 'publication') throw new DomainError('VALIDATION', '只能为科研成果补充 PDF。')
    if (paper.sourcePath) throw new DomainError('VALIDATION', '此成果已有 PDF。')
    const bytes = await this.pdfBytes(path)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    if (this.repo.byHash(sha256, 'publication')) throw new DomainError('VALIDATION', '这份 PDF 已关联到另一项成果。')
    const directory = this.storage.paperDirectory(paper)
    const sourcePath = join(directory, 'source.pdf')
    await mkdir(directory, { recursive: true })
    try {
      await writeFile(sourcePath, bytes, { flag: 'wx' })
      return this.repo.updatePaper(id, { originalName: basename(path), sourcePath, sha256 }, true)
    } catch (error) {
      await rm(directory, { recursive: true, force: true }).catch(() => undefined)
      throw new DomainError('UNAVAILABLE', `PDF 未能补充：${message(error)}`)
    } finally { this.changed() }
  }
  async exportPublications(format: 'bibtex' | 'csv', ids?: string[]) {
    const window = this.window()
    if (!window) throw new DomainError('UNAVAILABLE', '工作区窗口不可用。')
    const selected = this.repo.papers().filter((paper) => paper.collection === 'publication' && (!ids || ids.includes(paper.id)))
    if (!selected.length) throw new DomainError('VALIDATION', '没有可导出的成果记录。')
    const csvCell = (value: string) => `"${value.replaceAll('"', '""')}"`
    const body = format === 'csv'
      ? ['标题,作者,期刊或会议,发表时间,DOI,期刊分区,JCR分区,分区年份,作者身份,共同一作,通讯作者,主题标签', ...selected.map((paper) => [paper.title, paper.authors, paper.journal, paper.publishedDate, paper.doi, paper.casPartition, paper.jcrQuartile, paper.partitionYear, paper.authorRole, paper.coFirstAuthor ? '是' : '否', paper.correspondingAuthor ? '是' : '否', paper.tags.join('; ')].map(csvCell).join(','))].join('\r\n')
      : selected.map((paper, index) => `@article{workbench${paper.year || 'nd'}${index + 1},\n  title = {${paper.title}},\n  author = {${paper.authors}},\n  journal = {${paper.journal}},\n  year = {${paper.year}},\n  doi = {${paper.doi}}\n}`).join('\n\n')
    const result = await dialog.showSaveDialog(window, { title: format === 'csv' ? '导出成果 CSV' : '导出成果 BibTeX', defaultPath: `科研成果.${format === 'csv' ? 'csv' : 'bib'}`, filters: [{ name: format === 'csv' ? 'CSV' : 'BibTeX', extensions: [format === 'csv' ? 'csv' : 'bib'] }] })
    if (result.canceled || !result.filePath) return false
    await writeFile(result.filePath, `\uFEFF${body}`, 'utf8')
    return true
  }
  async retry(id: string) {
    const paper = this.repo.paper(id)
    if (paper.translationStatus === 'queued' || paper.translationStatus === 'translating') return
    if (paper.translationStatus === 'ready') throw new DomainError('VALIDATION', '此文献已有中英对照版。')
    const health = await this.health()
    if (!health.installed || !health.configured) throw new DomainError('VALIDATION', health.message)
    this.repo.translation(id, 'queued')
    this.changed()
    void this.pump()
  }
  cancelTranslation(id: string) {
    const paper = this.repo.paper(id)
    if (paper.translationStatus === 'queued') {
      this.repo.translation(id, 'idle')
      this.changed()
      return
    }
    if (paper.translationStatus !== 'translating' || this.activePaperId !== id)
      throw new DomainError('VALIDATION', '此文献当前不在翻译队列中。')
    this.cancelledTranslations.add(id)
    if (this.activeChild) terminateTranslator(this.activeChild)
  }
  setTranslationPaused(paused: boolean) {
    this.translationPaused = paused
    this.repo.setSetting('translation.paused', String(paused))
    this.changed()
    if (!paused) void this.pump()
  }
  reorderTranslations(ids: string[]) {
    this.repo.reorderTranslations(ids)
    this.changed()
  }
  private async pump() {
    if (this.running || this.stopping) return
    this.running = true
    try {
      while (!this.stopping) {
        if (this.translationPaused) break
        const paper = this.repo.papers().filter((item) => item.translationStatus === 'queued')
          .sort((a, b) => a.translationOrder - b.translationOrder || a.addedAt.localeCompare(b.addedAt))[0]
        if (!paper) break
        const health = await this.health()
        if (!health.installed || !health.configured) break
        const profile = this.translationProfiles.runtimeActive()
        this.repo.translation(paper.id, 'translating')
        this.activePaperId = paper.id
        const startedAt = new Date().toISOString()
        this.publishProgress({ paperId: paper.id, stage: '正在启动翻译引擎', percent: null, current: null, total: null, startedAt, updatedAt: startedAt })
        this.changed()
        try {
          const outputDirectory = join(dirname(paper.sourcePath), 'jobs', randomUUID())
          const output = await runTranslation(this.directory(), paper.sourcePath, outputDirectory, profile, (child) => {
            this.activeChild = child
            if (this.stopping) terminateTranslator(child)
          }, (progress) => this.updateProgress(paper.id, progress))
          if (this.stopping) break
          if (this.cancelledTranslations.has(paper.id)) throw new Error('翻译已取消。')
          // Verify a real PDF exists before declaring completion or associating it with a card.
          const bytes = await this.pdfBytes(output)
          const target = join(dirname(paper.sourcePath), 'bilingual.pdf')
          await writeFile(target, bytes)
          this.repo.translation(paper.id, 'ready', '', target)
        } catch (error) {
          if (!this.stopping) this.repo.translation(paper.id,
            this.cancelledTranslations.has(paper.id) ? 'interrupted' : 'failed',
            this.cancelledTranslations.has(paper.id) ? '翻译已取消，原文保持不变；可稍后重试。' : message(error).slice(0, 700))
        } finally {
          this.cancelledTranslations.delete(paper.id)
          this.activeChild = null
          this.activePaperId = null
          this.publishProgress(null)
        }
        if (!this.stopping) this.changed()
      }
    } finally { this.running = false }
  }
  private file(id: string, variant: PaperVariant) {
    return this.storage.file(this.repo.paper(id), variant)
  }
  async read(id: string, variant: PaperVariant) {
    const paper = this.repo.paper(id)
    if (variant === 'source' && !paper.sourcePath) throw new DomainError('VALIDATION', '此记录尚未补充 PDF。')
    try { return new Uint8Array(await this.pdfBytes(this.file(id, variant))) }
    catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', `无法读取文献：${message(error)}`)
    }
  }
  async export(id: string, variant: PaperVariant) {
    const path = this.file(id, variant), window = this.window()
    if (!window) return false
    const paper = this.repo.paper(id)
    const result = await dialog.showSaveDialog(window, { title: '导出 PDF',
      defaultPath: `${basename(paper.originalName, '.pdf')}${variant === 'translated' ? '.中英对照' : ''}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }] })
    if (result.canceled || !result.filePath) return false
    await copyFile(path, result.filePath)
    return true
  }
  async delete(id: string) {
    const paper = this.repo.paper(id)
    if (paper.translationStatus === 'translating') throw new DomainError('VALIDATION', '请等待翻译结束后再移除文献。')
    const directory = paper.sourcePath ? dirname(this.file(id, 'source')) : ''
    // Managed files go to the Windows recycle bin; the user's original upload is never removed.
    if (directory && existsSync(directory)) await shell.trashItem(directory)
    this.repo.deletePaper(id)
    this.changed()
  }
  stop() {
    this.arxiv.stop()
    this.engineInstaller?.stop()
    this.stopping = true
    this.publishProgress(null)
    if (this.activeChild) terminateTranslator(this.activeChild)
    for (const paper of this.repo.papers()) {
      if (paper.translationStatus === 'translating')
        this.repo.translation(paper.id, 'interrupted', '应用在翻译完成前关闭，原文已保留。请稍后重试。')
    }
  }
}
