import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm'
import { DomainError } from '../../../domain/errors'
import type { FolderInput, Paper, PaperPatch, PaperCollection } from '../../../shared/types'
import type { WorkbenchDatabase } from '../db'
import { appSettings, libraryFolders, papers, arxivDownloads } from '../schema'
import { localDay } from '../../../shared/arxiv'
import { readingDatesSchema } from '../../../domain/reports'

export class LibraryRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  folders() { return this.db.select().from(libraryFolders).orderBy(asc(libraryFolders.createdAt)).all() }
  papers() { return this.db.select().from(papers).orderBy(desc(papers.addedAt)).all() }
  folder(id: string) {
    const folder = this.db.select().from(libraryFolders).where(eq(libraryFolders.id, id)).get()
    if (!folder) throw new DomainError('NOT_FOUND', '此文件夹已不存在。')
    return folder
  }
  paper(id: string): Paper {
    const paper = this.db.select().from(papers).where(eq(papers.id, id)).get()
    if (!paper) throw new DomainError('NOT_FOUND', '此文献已不存在。')
    return paper
  }
  byHash(hash: string, collection: PaperCollection = 'library') {
    return this.db.select().from(papers).where(and(eq(papers.sha256, hash), eq(papers.collection, collection))).get()
  }
  downloads() { return this.db.select().from(arxivDownloads).all() }
  insertArxiv(paper: Paper) {
    if (!paper.arxivId) throw new DomainError('VALIDATION', '缺少 arXiv 编号。')
    this.db.transaction((tx) => {
      tx.insert(papers).values(paper).run()
      tx.insert(arxivDownloads).values({ arxivId: paper.arxivId!, paperId: paper.id, downloadedDate: paper.collectedDate }).run()
    })
    return paper
  }
  createFolder(input: FolderInput) {
    if (input.parentId) this.folder(input.parentId)
    this.validateFolderDepth(null, input.parentId)
    const folder = { ...input, id: randomUUID(), createdAt: new Date().toISOString() }
    this.db.insert(libraryFolders).values(folder).run()
    return folder
  }
  updateFolder(id: string, input: FolderInput) {
    this.folder(id)
    let ancestor = input.parentId
    const visited = new Set<string>()
    while (ancestor) {
      if (ancestor === id || visited.has(ancestor))
        throw new DomainError('VALIDATION', '文件夹不能移入自己或自己的子文件夹。')
      visited.add(ancestor)
      ancestor = this.folder(ancestor).parentId
    }
    this.validateFolderDepth(id, input.parentId)
    this.db.update(libraryFolders).set(input).where(eq(libraryFolders.id, id)).run()
    return this.folder(id)
  }
  deleteFolder(id: string) {
    this.folder(id)
    // Deleting a folder promotes its children and leaves its papers unfiled via foreign keys.
    this.db.delete(libraryFolders).where(eq(libraryFolders.id, id)).run()
  }
  private validateFolderDepth(id: string | null, parentId: string | null) {
    const parentById = new Map(this.folders().map((folder) => [folder.id, folder.parentId]))
    const targetId = id ?? '__new_folder__'
    parentById.set(targetId, parentId)
    for (const folderId of parentById.keys()) {
      let current: string | null = folderId
      const visited = new Set<string>()
      let depth = 0
      while (current) {
        if (visited.has(current)) throw new DomainError('VALIDATION', '文件夹不能移入自己或自己的子文件夹。')
        visited.add(current)
        depth++
        if (depth > 3) throw new DomainError('VALIDATION', '文献文件夹最多支持三级。')
        current = parentById.get(current) ?? null
      }
    }
  }
  insert(paper: Paper) { this.db.insert(papers).values(paper).run(); return paper }
  updatePaper(id: string, patch: PaperPatch, manualMetadata = false) {
    const paper = this.paper(id)
    if (paper.collection !== 'library' && patch.folderId !== undefined && patch.folderId !== null)
      throw new DomainError('VALIDATION', 'Arxiv Daily 和科研成果在各自页面独立管理。')
    if (patch.folderId) this.folder(patch.folderId)
    let locked: string[] = []
    try { const fields = JSON.parse(paper.metadataLockedFields) as unknown; if (Array.isArray(fields)) locked = fields.filter((field): field is string => typeof field === 'string') } catch { /* Preserve older records without explicit locks. */ }
    if (manualMetadata) for (const key of ['title', 'authors', 'journal', 'year', 'doi', 'publishedDate'] as const)
      if (patch[key] !== undefined && patch[key] !== paper[key]) locked.push(key)
    const nextMax = patch.maxReadPage === undefined ? paper.maxReadPage : Math.max(paper.maxReadPage, patch.maxReadPage)
    const requestedProgress = patch.readProgress === undefined ? paper.readProgress : Math.max(paper.readProgress, patch.readProgress)
    const normalized = { ...patch, ...(patch.maxReadPage === undefined ? {} : { maxReadPage: nextMax }),
      ...(patch.readProgress === undefined ? {} : { readProgress: requestedProgress }),
      ...(patch.readingStatus === 'done' ? { readProgress: 100 } : {}),
      ...(patch.readingStatus === 'unread' ? { readProgress: 0, maxReadPage: 0 } : {}),
      ...(patch.readingStatus === 'reading' ? { readProgress: Math.min(99, Math.max(requestedProgress, paper.pageCount ? Math.round(nextMax / paper.pageCount * 100) : 0)) } : {}),
      ...(manualMetadata ? { metadataLockedFields: JSON.stringify([...new Set(locked)]) } : {}) }
    this.db.transaction(tx => {
      const now = new Date()
      tx.update(papers).set({ ...normalized, updatedAt: now.toISOString() }).where(eq(papers.id, id)).run()
      if (paper.collection !== 'publication' && patch.readingStatus === 'done' && paper.readingStatus !== 'done') {
        const key = 'research.reading-dates.v1'
        const existing = tx.select().from(appSettings).where(eq(appSettings.key, key)).get()
        let dates: Record<string, string>
        try { dates = readingDatesSchema.parse(existing ? JSON.parse(existing.value) : {}) }
        catch { throw new DomainError('VALIDATION', '阅读日期记录无法读取，本次修改未保存。') }
        if (!dates[id]) {
          const value = JSON.stringify({ ...dates, [id]: localDay(now) })
          tx.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
        }
      }
    })
    return this.paper(id)
  }
  metadata(id: string, patch: Partial<Pick<Paper, 'title' | 'authors' | 'journal' | 'year' | 'doi' | 'publishedDate' | 'pageCount' | 'metadataStatus' | 'metadataSource' | 'metadataMessage' | 'metadataCheckedAt' | 'metadataLockedFields'>>) {
    this.paper(id)
    this.db.update(papers).set({ ...patch, updatedAt: new Date().toISOString() }).where(eq(papers.id, id)).run()
    return this.paper(id)
  }
  translation(id: string, status: Paper['translationStatus'], error = '', path?: string) {
    const nextOrder = status === 'queued'
      ? Number(this.db.select({ value: sql<number>`coalesce(max(${papers.translationOrder}), 0) + 1` }).from(papers).get()?.value ?? 1)
      : undefined
    this.db.update(papers).set({
      translationStatus: status, translationError: error,
      ...(nextOrder === undefined ? {} : { translationOrder: nextOrder }),
      ...(path ? { translatedPath: path } : {}), updatedAt: new Date().toISOString()
    }).where(eq(papers.id, id)).run()
  }
  reorderTranslations(ids: string[]) {
    const queued = this.db.select().from(papers).where(inArray(papers.id, ids)).all()
    if (queued.length !== ids.length || queued.some((paper) => paper.translationStatus !== 'queued'))
      throw new DomainError('VALIDATION', '只能调整仍在排队的翻译任务。')
    this.db.transaction((tx) => ids.forEach((id, index) => tx.update(papers).set({ translationOrder: index + 1 }).where(eq(papers.id, id)).run()))
  }
  deletePaper(id: string) {
    this.paper(id)
    this.db.transaction((tx) => {
      tx.delete(papers).where(eq(papers.id, id)).run()
      tx.delete(appSettings).where(eq(appSettings.key, `paper.overview.v1.${id}`)).run()
    })
  }
  setting(key: string, fallback: string) {
    return this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value ?? fallback
  }
  setSetting(key: string, value: string) {
    this.db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
  }
}
