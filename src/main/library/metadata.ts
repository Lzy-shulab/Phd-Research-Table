import { setTimeout as delay } from 'node:timers/promises'
import type { LocalPaperMetadata, Paper, PublicationMetadataPreview } from '../../shared/types'
import { cleanDoi, normalizedTitle, plainMetadataText, titleSimilarity, validPaperTitle } from '../../domain/metadata'
import type { LibraryRepository } from '../database/repositories/library'
import { researchFetch } from './research-network'
import { isPublicationDate } from '../../domain/validation'

type Bibliography = Pick<LocalPaperMetadata, 'title' | 'authors' | 'journal' | 'year' | 'doi'> & { publishedDate: string }
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const firstText = (value: unknown) => plainMetadataText(Array.isArray(value) ? value[0] : value)
function dateParts(value: unknown) {
  const dates = record(value)['date-parts']
  const parts = Array.isArray(dates) && Array.isArray(dates[0]) ? dates[0] as unknown[] : []
  const year = Number(parts[0]), month = Number(parts[1]), day = Number(parts[2])
  if (!Number.isInteger(year) || year < 1800 || year > 2200) return { year: '', date: '' }
  const full = Number.isInteger(month) && month >= 1 && month <= 12 && Number.isInteger(day) && day >= 1 && day <= 31
  const date = full ? `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    : parts.length === 1 ? String(year) : parts.length === 2 && Number.isInteger(month) && month >= 1 && month <= 12 ? `${year}-${String(month).padStart(2, '0')}` : ''
  return { year: String(year), date: isPublicationDate(date) ? date : '' }
}
export function crossrefBibliography(value: unknown): Bibliography | null {
  const item = record(value), title = firstText(item.title), doi = cleanDoi(firstText(item.DOI))
  if (!validPaperTitle(title) || !doi) return null
  const date = [item['published-print'], item.published, item['published-online'], item.issued].map(dateParts).find((value) => value.year) ?? { year: '', date: '' }
  const authors = (Array.isArray(item.author) ? item.author : []).map((author) => {
    const info = record(author)
    return [plainMetadataText(info.given), plainMetadataText(info.family)].filter(Boolean).join(' ') || plainMetadataText(info.name)
  }).filter(Boolean).join(', ').slice(0, 2000)
  return { title: title.slice(0, 1000), authors, journal: firstText(item['container-title']).slice(0, 500), year: date.year, doi, publishedDate: date.date }
}
let networkQueue: Promise<unknown> = Promise.resolve()
let lastRequest = 0
const cache = new Map<string, unknown>()
async function fetchCrossref(url: string) {
  if (cache.has(url)) return cache.get(url)
  const request = networkQueue.then(async () => {
    const wait = Math.max(0, 1100 - (Date.now() - lastRequest))
    if (wait) await delay(wait)
    lastRequest = Date.now()
    const response = await researchFetch(url, { signal: AbortSignal.timeout(25_000), headers: { Accept: 'application/json', 'User-Agent': 'PhD-Research-Workbench/0.5 (personal bibliographic metadata lookup)' } })
    if (response.status === 404) return { message: {} }
    if (!response.ok) throw new Error(response.status === 429 ? '书目服务请求受限，请稍后重新识别。' : `书目服务暂时不可用（HTTP ${response.status}）。`)
    const text = await response.text()
    if (text.length > 2_000_000) throw new Error('书目服务响应过大，未自动采用。')
    const json = JSON.parse(text) as unknown
    if (cache.size >= 100) cache.delete(cache.keys().next().value!)
    cache.set(url, json)
    return json
  })
  networkQueue = request.catch(() => undefined)
  return request
}
export async function resolveBibliography(input: LocalPaperMetadata, trustedDoi: string, fetcher: (url: string) => Promise<unknown> = fetchCrossref) {
  const doi = cleanDoi(trustedDoi) || cleanDoi(input.doi)
  if (doi) {
    const result = record(await fetcher(`https://api.crossref.org/works/${encodeURIComponent(doi)}`))
    const bibliography = crossrefBibliography(result.message)
    if (bibliography && bibliography.doi.toLowerCase() === doi.toLowerCase()
      && (trustedDoi || (input.titleReliable && titleSimilarity(input.title, bibliography.title) >= 0.6)))
      return { bibliography, source: 'Crossref · DOI', message: '' }
    // A DOI printed in references must not silently assign another paper's metadata.
  }
  if (!input.titleReliable || !validPaperTitle(input.title)) return { bibliography: null, source: 'PDF', message: 'PDF 中的标题证据不足，未自动采用联网书目。可编辑标题后重新识别。' }
  const query = new URLSearchParams({ 'query.bibliographic': input.title, rows: '5', select: 'DOI,title,author,container-title,published,published-print,published-online,issued' })
  const response = record(record(await fetcher(`https://api.crossref.org/works?${query}`)).message)
  const candidates = (Array.isArray(response.items) ? response.items : []).map(crossrefBibliography).filter((item): item is Bibliography => !!item)
    .map((item) => ({ item, score: titleSimilarity(input.title, item.title) })).sort((a, b) => b.score - a.score)
  const top = candidates[0], next = candidates.find((candidate) => candidate.item.doi !== top?.item.doi && normalizedTitle(candidate.item.title) !== normalizedTitle(top?.item.title ?? ''))
  const exactDuplicates = top && candidates.some((candidate) => candidate.item.doi !== top.item.doi && normalizedTitle(candidate.item.title) === normalizedTitle(top.item.title))
  if (top && top.score >= 0.9 && !exactDuplicates && (!next || top.score - next.score >= 0.06)) return { bibliography: top.item, source: 'Crossref · 标题匹配', message: '' }
  return { bibliography: null, source: 'PDF', message: candidates.length ? '发现相近书目，但无法唯一确认，已保留 PDF 资料。' : '未找到可靠书目匹配，已保留能读取的 PDF 资料。' }
}
const metadataKeys = ['title', 'authors', 'journal', 'year', 'doi'] as const
export async function previewPublicationMetadata(input: LocalPaperMetadata, online: boolean, overrides: { title: string; doi: string }, fetcher?: (url: string) => Promise<unknown>): Promise<PublicationMetadataPreview> {
  const lookup = overrides.title ? { ...input, title: overrides.title, titleReliable: validPaperTitle(overrides.title) } : input
  const fields: PublicationMetadataPreview['fields'] = { title: input.title, authors: input.authors, journal: input.journal, doi: input.doi,
    publishedDate: input.publishedDate || (isPublicationDate(input.year) ? input.year : '') }
  let source = 'PDF', message = online ? '' : '已按设置仅读取 PDF，未联网补全。'
  if (online) {
    try {
      const result = await resolveBibliography(lookup, overrides.doi, fetcher)
      source = result.source; message = result.message
      if (result.bibliography) {
        const bibliography = { ...result.bibliography, publishedDate: result.bibliography.publishedDate || result.bibliography.year }
        for (const key of ['title', 'authors', 'journal', 'publishedDate', 'doi'] as const) if (bibliography[key]) fields[key] = bibliography[key]
      }
    } catch (error) { message = `${error instanceof Error ? error.message : '联网补全暂不可用。'} 已保留 PDF 中能读取的资料，可手动补充或重试。` }
  }
  const complete = (lookup.titleReliable || source.startsWith('Crossref')) && Object.values(fields).every(Boolean)
  return { fields, source, status: complete ? 'ready' : 'partial', message: message || (complete ? '文章资料已填入，请核对后保存。' : '已填入能够确认的资料，缺失信息可手动补充。') }
}
export async function enrichMetadata(repo: LibraryRepository, id: string, input: LocalPaperMetadata, fetcher?: (url: string) => Promise<unknown>) {
  const original = repo.paper(id)
  const online = repo.setting('metadata.online', 'true') === 'true'
  const filenameTitle = original.originalName.replace(/\.pdf$/i, '')
  const currentTitleIsManual = !!original.title && original.title !== filenameTitle && original.title !== input.title
  const lookup = currentTitleIsManual ? { ...input, title: original.title, titleReliable: validPaperTitle(original.title) } : input
  let result: { bibliography: Bibliography | null; source: string; message: string } = { bibliography: null, source: 'PDF', message: '' }
  if (online) {
    try { result = await resolveBibliography(lookup, original.doi, fetcher) }
    catch (error) { result.message = `${error instanceof Error ? error.message : '联网补全暂不可用。'} 已保留能读取的 PDF 资料，可稍后重试。` }
  }
  const current = repo.paper(id)
  let locked: string[] = []
  try { const value = JSON.parse(current.metadataLockedFields) as unknown; if (Array.isArray(value)) locked = value.filter((item): item is string => typeof item === 'string') } catch { /* Legacy rows have no explicit locks. */ }
  const fields = { ...input, ...(result.bibliography ?? {}) }
  const patch: Partial<Paper> = { pageCount: input.pageCount }
  for (const key of metadataKeys) {
    if (locked.includes(key) || !fields[key]) continue
    const canReplace = key === 'title' ? current.title === filenameTitle || !current.title : !current[key]
    if (canReplace && (key !== 'title' || result.bibliography || input.titleReliable)) patch[key] = fields[key]
  }
  if (!locked.includes('publishedDate') && !current.publishedDate && result.bibliography?.publishedDate) patch.publishedDate = result.bibliography.publishedDate
  const merged = { ...current, ...patch }
  const complete = metadataKeys.slice(0, 4).every((key) => !!merged[key]) && merged.title !== filenameTitle
  return repo.metadata(id, { ...patch, metadataStatus: complete ? 'ready' : 'partial', metadataSource: result.source,
    metadataMessage: result.message || (complete ? '文献信息已读取，可在文献信息中核对或修改。' : '部分信息未能可靠读取，可手动补充或重新识别。'), metadataCheckedAt: new Date().toISOString() })
}
