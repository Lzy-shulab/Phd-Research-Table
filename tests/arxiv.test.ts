import { afterEach, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { defaultArxivSettings, paperMetadataDefaults } from '../src/shared/arxiv'
import type { Paper } from '../src/shared/types'

vi.mock('electron', () => ({ net: {}, shell: {}, session: {} }))
import { ArxivDailyService, arxivQuery, parseArxivFeed, relevance } from '../src/main/library/arxiv'

const entries = (ids: string[]) => `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/" xmlns:arxiv="http://arxiv.org/schemas/atom"><opensearch:totalResults>${ids.length}</opensearch:totalResults>${ids.map((id) => `<entry><id>http://arxiv.org/abs/${id}</id><title>Hyperspectral image reconstruction ${id}</title><author><name>A &amp; B</name></author><published>2026-09-07T02:00:00Z</published><summary>A hyperspectral image method with Mamba.</summary><arxiv:doi>10.1234/test</arxiv:doi></entry>`).join('')}</feed>`
const resources: { connection: DatabaseConnection; service: ArxivDailyService }[] = []
function setup(options: { fetch?: (url: string, init: RequestInit) => Promise<Response>; now?: () => Date } = {}) {
  const connection = openDatabase(':memory:', resolve('src/main/database/migrations'))
  const repo = new LibraryRepository(connection.db)
  const fetch = vi.fn(options.fetch ?? (async (url: string) => url.includes('/api/') ? new Response(entries(['2609.00001v1', '2609.00002v2', '2609.00003v1'])) : new Response(`%PDF-1.7\n${url}\n%%EOF`)))
  const save = vi.fn(async (entry, bytes: Buffer, day: string) => {
    const paper: Paper = { ...paperMetadataDefaults, ...entry, collection: 'arxiv', id: randomUUID(), collectedDate: day, folderId: null, year: '2026', notes: '',
      sourcePath: '/test/source.pdf', originalName: 'source.pdf', translatedPath: null, sha256: bytes.toString('hex'), translationStatus: 'idle', translationError: '',
      pageCount: 0, readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: 'now', updatedAt: 'now' }
    return repo.insertArxiv(paper)
  })
  const service = new ArxivDailyService(repo, save, () => undefined, '/test/Arxiv Daily', { fetch, wait: async () => undefined, now: options.now ?? (() => new Date('2026-09-08T08:00:00')) })
  service.configure({ ...defaultArxivSettings, maxPerDay: 2, directions: ['hyperspectral image'] })
  resources.push({ connection, service })
  return { service, repo, fetch, save }
}
async function finished(service: ArxivDailyService) {
  await vi.waitFor(() => expect(service.snapshot().running).toBe(false))
  return service.snapshot().runs[0]!
}
afterEach(() => { for (const { service, connection } of resources.splice(0)) { service.stop(); connection.close() } })

describe('arXiv parsing and research matching', () => {
  it('parses namespaces, encoded authors, DOI and version-independent identifiers', () => {
    const result = parseArxivFeed(entries(['2609.12345v3', 'cs.CV/0701001v1']))
    expect(result.total).toBe(2)
    expect(result.entries[0]).toMatchObject({ arxivId: '2609.12345', pdfId: '2609.12345v3', authors: 'A & B', doi: '10.1234/test', publishedDate: '2026-09-07' })
    expect(result.entries[1]!.arxivId).toBe('cs.CV/0701001')
  })
  it('rejects error feeds, HTML, entities and non-arXiv document sources', () => {
    expect(() => parseArxivFeed('<html>Proxy error</html>')).toThrow()
    expect(() => parseArxivFeed('<!DOCTYPE feed [<!ENTITY x SYSTEM "file:///test">]><feed/>')).toThrow()
    expect(() => parseArxivFeed('<feed><entry><id>http://arxiv.org/api/errors#0</id><summary>Bad query</summary></entry></feed>')).toThrow('Bad query')
    expect(() => parseArxivFeed(entries(['2609.12345v1']).replace('http://arxiv.org/abs/', 'https://publisher.example/abs/'))).toThrow('arXiv')
  })
  it('uses editable direction phrases in queries and requires every AND term for matching', () => {
    expect(arxivQuery(['Mamba AND remote sensing'], '2026-08-26', '2026-09-08')).toContain('submittedDate:[202608260000 TO 202609082359]')
    const entry = parseArxivFeed(entries(['2609.12345'])) .entries[0]!
    expect(relevance(entry, ['Mamba AND remote sensing'])).toBe(0)
    expect(relevance(entry, ['hyperspectral image'])).toBeGreaterThan(0)
  })
})
describe('Daily download orchestration', () => {
  it('downloads only arXiv PDFs, serializes starts, caps a whole day and keeps source PDFs untranslated', async () => {
    const { service, repo, fetch, save } = setup()
    service.start(); service.start()
    expect((await finished(service)).downloaded).toBe(2)
    expect(repo.papers()).toHaveLength(2)
    expect(repo.papers().every((paper) => paper.collection === 'arxiv' && paper.translationStatus === 'idle' && !paper.translatedPath)).toBe(true)
    expect(save).toHaveBeenCalledTimes(2)
    service.start(); expect((await finished(service)).message).toContain('上限')
    expect(save).toHaveBeenCalledTimes(2)
    expect(fetch.mock.calls.every(([url]) => ['arxiv.org', 'export.arxiv.org'].includes(new URL(url).hostname))).toBe(true)
  })
  it('retains IDs after removal, fills only the remaining daily quota and reuses same-day search metadata', async () => {
    const { service, repo, fetch } = setup()
    service.start(); await finished(service)
    const removed = repo.papers()[0]!
    repo.deletePaper(removed.id)
    expect(repo.downloads().find((item) => item.arxivId === removed.arxivId)?.paperId).toBeNull()
    service.configure({ ...service.snapshot().settings, maxPerDay: 3 })
    service.start(); expect((await finished(service)).downloaded).toBe(1)
    expect(repo.downloads()).toHaveLength(3)
    expect(fetch.mock.calls.filter(([url]) => url.includes('/api/'))).toHaveLength(1)
  })
  it('reports invalid PDFs and network failures accurately, and permits retry without consuming quota', async () => {
    let healthy = false
    const { service, repo } = setup({ fetch: async (url) => url.includes('/api/') ? new Response(entries(['2609.00001v1']))
      : healthy ? new Response('%PDF-1.7\nfixture') : new Response('<html>Unavailable</html>') })
    service.start(); expect((await finished(service)).status).toBe('failed')
    expect(repo.papers()).toHaveLength(0); expect(repo.downloads()).toHaveLength(0)
    healthy = true
    service.start(); expect((await finished(service)).status).toBe('success')
    expect(repo.papers()).toHaveLength(1)
  })
  it('runs automatically once per local day, respects the off switch, and allows explicit retry', async () => {
    let date = new Date('2026-09-08T23:58:00')
    const { service, fetch } = setup({ now: () => date, fetch: async () => new Response('busy', { status: 503 }) })
    service.checkAutomatic(); await finished(service)
    service.checkAutomatic(); expect(fetch).toHaveBeenCalledTimes(1)
    service.start(); await finished(service); expect(fetch).toHaveBeenCalledTimes(2)
    date = new Date('2026-09-09T00:01:00')
    service.checkAutomatic(); await finished(service); expect(fetch).toHaveBeenCalledTimes(3)
    service.configure({ ...service.snapshot().settings, enabled: false })
    date = new Date('2026-09-10T08:00:00')
    service.checkAutomatic(); expect(fetch).toHaveBeenCalledTimes(3)
  })
  it('cancels in-flight network work without claiming a successful or empty result', async () => {
    const { service, repo } = setup({ fetch: async (_url, init) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true })
    }) })
    service.start(); service.cancel()
    expect((await finished(service)).status).toBe('cancelled')
    expect(repo.downloads()).toHaveLength(0)
  })
})
