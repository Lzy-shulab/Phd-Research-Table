import { shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { defaultArxivSettings, localDay } from '../../shared/arxiv'
import type { ArxivRun, ArxivSettings, ArxivSnapshot, Paper } from '../../shared/types'
import { arxivSettingsSchema } from '../../domain/research'
import { DomainError } from '../../domain/errors'
import { researchFetch } from './research-network'
import type { LibraryRepository } from '../database/repositories/library'

export interface ArxivEntry {
  arxivId: string
  pdfId: string
  title: string
  authors: string
  abstract: string
  journal: string
  publishedDate: string
  doi: string
}
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => value === undefined ? [] : Array.isArray(value) ? value : [value]
const content = (value: unknown): string => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
const parser = new XMLParser({ ignoreAttributes: false, removeNSPrefix: true, parseTagValue: false, processEntities: true })
const idPattern = /^(?:\d{4}\.\d{4,5}|[a-z-]+(?:\.[A-Z]{2})?\/\d{7})(?:v\d+)?$/
function arxivError(error: unknown) {
  const message = error instanceof Error ? error.message : '检索失败，请稍后重试。'
  if (/ERR_(?:CONNECTION|PROXY|TUNNEL|SOCKS)|fetch failed/i.test(message)) return 'arXiv 连接中断，请检查网络或系统代理后重试。已下载的文献保留。'
  if (/ERR_NAME_NOT_RESOLVED/i.test(message)) return '无法解析 arXiv 地址，请检查网络或 DNS 后重试。'
  if (/timeout|timed.out/i.test(message)) return 'arXiv 响应超时，请稍后重试。'
  return message
}

export function parseArxivFeed(xml: string): { entries: ArxivEntry[]; total: number } {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error('arXiv 返回的文献列表格式无效。')
  const root = record(parser.parse(xml) as unknown)
  if (!root.feed) throw new Error('arXiv 未返回有效的 Atom 列表。')
  const feed = record(root.feed)
  const entries: ArxivEntry[] = []
  for (const item of list(feed.entry)) {
    const entry = record(item)
    const rawId = content(entry.id)
    if (/api\/errors/i.test(rawId)) throw new Error(`arXiv 检索失败：${content(entry.summary) || content(entry.title)}`)
    let url: URL
    try { url = new URL(rawId) } catch { throw new Error('arXiv 返回了无效的文献编号。') }
    const pdfId = url.pathname.replace(/^\/abs\//, '')
    if (!['arxiv.org', 'export.arxiv.org'].includes(url.hostname) || !idPattern.test(pdfId))
      throw new Error('文献来源不是有效的 arXiv 页面。')
    const title = content(entry.title), publishedDate = content(entry.published).slice(0, 10)
    if (!title || !/^\d{4}-\d{2}-\d{2}$/.test(publishedDate)) throw new Error('arXiv 文献缺少标题或发表时间。')
    entries.push({ arxivId: pdfId.replace(/v\d+$/, ''), pdfId, title,
      authors: list(entry.author).map((author) => content(record(author).name)).join(', '),
      abstract: content(entry.summary), journal: content(entry.journal_ref) || 'arXiv', publishedDate, doi: content(entry.doi) })
  }
  const total = Number(feed.totalResults ?? entries.length)
  return { entries, total: Number.isFinite(total) ? total : entries.length }
}

export function directionTerms(direction: string) { return direction.split(/\s+AND\s+/i).map((s) => s.trim()).filter(Boolean) }
export function arxivQuery(directions: string[], from: string, through: string) {
  const query = directions.map((direction) => `(${directionTerms(direction).map((term) => `(ti:"${term}" OR abs:"${term}")`).join(' AND ')})`).join(' OR ')
  return `(${query}) AND submittedDate:[${from.replaceAll('-', '')}0000 TO ${through.replaceAll('-', '')}2359]`
}
const normalized = (text: string) => text.toLowerCase().replace(/[-‐‑–]/g, ' ').replace(/\s+/g, ' ')
export function relevance(entry: ArxivEntry, directions: string[]) {
  const title = normalized(entry.title), full = `${title} ${normalized(entry.abstract)}`
  let score = 0
  for (const direction of directions) {
    const terms = directionTerms(direction).map(normalized)
    if (terms.every((term) => full.includes(term))) {
      score += 10 + terms.length * 2
      if (terms.every((term) => title.includes(term))) score += 20
    }
  }
  return score
}
function readJson<T>(repo: LibraryRepository, key: string, fallback: T): T {
  try { return JSON.parse(repo.setting(key, JSON.stringify(fallback))) as T } catch { return fallback }
}
type Dependencies = {
  fetch: (url: string, init: RequestInit) => Promise<Response>
  now: () => Date
  wait: (ms: number, signal: AbortSignal) => Promise<void>
}

export class ArxivDailyService {
  private settings: ArxivSettings
  private runs: ArxivRun[]
  private controller: AbortController | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private progress = ''
  private lastRequest = 0
  private readonly dependencies: Dependencies
  constructor(private readonly repo: LibraryRepository,
    private readonly save: (entry: ArxivEntry, bytes: Buffer, day: string) => Promise<Paper>,
    private readonly changed: () => void, private readonly directory: string | (() => string), dependencies?: Partial<Dependencies>) {
    this.dependencies = { fetch: researchFetch, now: () => new Date(),
      wait: async (ms, signal) => { await delay(ms, undefined, { signal }) }, ...dependencies }
    const settings = arxivSettingsSchema.safeParse(readJson(repo, 'arxiv.settings', defaultArxivSettings))
    this.settings = settings.success ? settings.data : structuredClone(defaultArxivSettings)
    const runs = readJson<ArxivRun[]>(repo, 'arxiv.runs', [])
    this.runs = Array.isArray(runs) ? runs.slice(0, 20).map((run) => run.status === 'running'
      ? { ...run, status: 'interrupted', finishedAt: this.dependencies.now().toISOString(), message: '上次下载被关闭应用中断，已保存的 PDF 保留，可立即重试。' } : run) : []
    this.persist()
  }
  snapshot(): ArxivSnapshot {
    return { settings: this.settings, runs: this.runs, running: !!this.controller, progress: this.progress, directory: this.currentDirectory() }
  }
  private currentDirectory() { return typeof this.directory === 'string' ? this.directory : this.directory() }
  configure(settings: ArxivSettings) {
    if (this.controller) throw new DomainError('VALIDATION', '请先等待本次检索完成或停止检索，再修改设置。')
    this.settings = arxivSettingsSchema.parse(settings)
    this.repo.setSetting('arxiv.settings', JSON.stringify(this.settings))
    this.changed()
  }
  startAutomatic() {
    if (this.timer || this.stopped) return
    this.timer = setInterval(() => this.checkAutomatic(), 60_000)
    this.timer.unref()
    this.checkAutomatic()
  }
  checkAutomatic() {
    if (this.stopped || !this.settings.enabled || this.controller) return
    const day = localDay(this.dependencies.now())
    if (this.repo.setting('arxiv.lastAutomaticDay', '') === day) return
    this.repo.setSetting('arxiv.lastAutomaticDay', day)
    this.start()
  }
  start() {
    if (this.controller || this.stopped) return
    this.controller = new AbortController()
    void this.run(this.controller.signal).catch((error: unknown) => {
      this.controller = null
      if (!this.stopped) this.status(error instanceof Error ? error.message : '检索记录未能保存，请检查本机数据目录。')
    })
  }
  cancel() { this.controller?.abort() }
  async reveal() {
    const directory = this.currentDirectory()
    await mkdir(directory, { recursive: true })
    const error = await shell.openPath(directory)
    if (error) throw new DomainError('UNAVAILABLE', `无法打开下载目录：${error}`)
  }
  private persist() { this.repo.setSetting('arxiv.runs', JSON.stringify(this.runs.slice(0, 20))) }
  private status(value: string) { if (this.stopped) return; this.progress = value; this.changed() }
  private async request(url: string, signal: AbortSignal, maxSize: number) {
    // Only canonical arXiv endpoints, serial requests, at least 3.1 seconds apart.
    const target = new URL(url)
    if (target.protocol !== 'https:' || !['arxiv.org', 'export.arxiv.org'].includes(target.hostname)) throw new Error('仅支持 arXiv 来源。')
    const wait = Math.max(0, 3100 - (Date.now() - this.lastRequest))
    if (wait) await this.dependencies.wait(wait, signal)
    signal.throwIfAborted()
    this.lastRequest = Date.now()
    const response = await this.dependencies.fetch(url, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]), redirect: 'error',
      headers: { 'User-Agent': 'PhD-Research-Workbench/0.4 (personal arXiv reader)', Accept: maxSize > 10_000_000 ? 'application/pdf' : 'application/atom+xml' }
    })
    // A transport retry may have issued a later request than the initial timestamp.
    this.lastRequest = Date.now()
    if (!response.ok) throw new Error(`arXiv 请求失败（HTTP ${response.status}）${response.status === 429 ? '，请求受限，请稍后重试' : ''}。`)
    if (Number(response.headers.get('content-length')) > maxSize) throw new Error('文件超过允许的大小。')
    if (!response.body) throw new Error('arXiv 返回了空内容。')
    const reader = response.body.getReader(), chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        signal.throwIfAborted()
        const { done, value } = await reader.read()
        if (done) break
        size += value.length
        if (size > maxSize) throw new Error('文件超过允许的大小。')
        chunks.push(value)
      }
    } catch (error) { await reader.cancel().catch(() => undefined); throw error }
    finally { reader.releaseLock() }
    return Buffer.concat(chunks)
  }
  private async search(day: string, signal: AbortSignal) {
    const first = new Date(`${day}T12:00:00`)
    first.setDate(first.getDate() - this.settings.daysBack + 1)
    const from = localDay(first)
    const cacheKey = JSON.stringify([day, this.settings.daysBack, this.settings.directions])
    const cache = readJson<{ key: string; entries: ArxivEntry[] } | null>(this.repo, 'arxiv.cache', null)
    if (cache?.key === cacheKey && Array.isArray(cache.entries)) return cache.entries
    const found = new Map<string, ArxivEntry>()
    for (let index = 0; index < this.settings.directions.length; index += 4) {
      this.status(`正在检索研究方向 ${Math.floor(index / 4) + 1} / ${Math.ceil(this.settings.directions.length / 4)}…`)
      const query = arxivQuery(this.settings.directions.slice(index, index + 4), from, day)
      // Bounded paging retains recent candidates while limiting daily API traffic.
      for (let start = 0; start < 300; start += 100) {
        const parameters = new URLSearchParams({ search_query: query, start: String(start), max_results: '100', sortBy: 'submittedDate', sortOrder: 'descending' })
        const feed = parseArxivFeed((await this.request(`https://export.arxiv.org/api/query?${parameters}`, signal, 8 * 1024 * 1024)).toString('utf8'))
        for (const entry of feed.entries) if (entry.publishedDate >= from && entry.publishedDate <= day) found.set(entry.arxivId, entry)
        if (start + feed.entries.length >= feed.total || !feed.entries.length) break
      }
    }
    const entries = [...found.values()]
    signal.throwIfAborted()
    if (this.stopped) throw new Error('应用已关闭。')
    this.repo.setSetting('arxiv.cache', JSON.stringify({ key: cacheKey, entries }))
    return entries
  }
  private async run(signal: AbortSignal) {
    const date = localDay(this.dependencies.now())
    const run: ArxivRun = { id: randomUUID(), date, startedAt: this.dependencies.now().toISOString(), finishedAt: null,
      status: 'running', downloaded: 0, candidates: 0, message: '准备检索…', failures: [] }
    this.runs = [run, ...this.runs].slice(0, 20)
    this.persist(); this.status(run.message)
    try {
      const downloaded = this.repo.downloads()
      const quota = Math.max(0, this.settings.maxPerDay - downloaded.filter((item) => item.downloadedDate === date).length)
      if (!quota) { run.message = `今日已达到 ${this.settings.maxPerDay} 篇下载上限。`; run.status = 'success'; return }
      const seen = new Set(downloaded.map((item) => item.arxivId))
      const entries = (await this.search(date, signal)).filter((entry) => !seen.has(entry.arxivId) && relevance(entry, this.settings.directions) > 0)
        .sort((a, b) => relevance(b, this.settings.directions) - relevance(a, this.settings.directions) || b.publishedDate.localeCompare(a.publishedDate))
      run.candidates = entries.length
      this.persist()
      for (const entry of entries.slice(0, quota + 5)) {
        if (run.downloaded >= quota) break
        signal.throwIfAborted()
        this.status(`正在下载 ${run.downloaded + 1} / ${Math.min(quota, entries.length)}：${entry.title}`)
        try {
          const bytes = await this.request(`https://arxiv.org/pdf/${entry.pdfId}`, signal, 100 * 1024 * 1024)
          if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('返回内容不是 PDF，未保存。')
          signal.throwIfAborted()
          if (this.stopped) break
          await this.save(entry, bytes, date)
          if (this.stopped) break
          run.downloaded++
          this.persist()
        } catch (error) {
          if (signal.aborted) throw error
          run.failures.push(`${entry.arxivId}：${arxivError(error)}`)
          if (error instanceof Error && /HTTP (429|503)/.test(error.message)) break
        }
      }
      run.status = run.failures.length ? run.downloaded ? 'partial' : 'failed' : 'success'
      run.message = run.downloaded ? `已下载 ${run.downloaded} 篇 PDF${run.failures.length ? `，${run.failures.length} 篇下载未完成，可重试` : ''}。`
        : run.failures.length ? 'PDF 下载未完成，请查看原因后重试。' : '本次没有匹配且未下载的新文献。'
    } catch (error) {
      run.status = signal.aborted ? 'cancelled' : 'failed'
      run.message = signal.aborted ? '检索已停止，已保存的 PDF 保留。' : arxivError(error)
    } finally {
      if (!this.stopped) {
        run.finishedAt = this.dependencies.now().toISOString()
        this.controller = null
        this.persist(); this.status(run.message)
      }
    }
  }
  stop() {
    this.stopped = true
    if (this.timer) clearInterval(this.timer)
    this.controller?.abort()
    const run = this.runs.find((item) => item.status === 'running')
    if (run) { run.status = 'interrupted'; run.finishedAt = this.dependencies.now().toISOString(); run.message = '应用已关闭，已保存的 PDF 保留。'; this.persist() }
  }
}
