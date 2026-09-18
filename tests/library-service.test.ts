import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import type { BrowserWindow } from 'electron'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'

const engine = vi.hoisted(() => ({ run: vi.fn(), installed: vi.fn(), config: vi.fn(), stop: vi.fn() }))
const arxivNetwork = vi.hoisted(() => ({ fetch: vi.fn() }))
const picker = vi.hoisted(() => ({ showOpenDialog: vi.fn(), openPath: vi.fn(), trashItem: vi.fn() }))
vi.mock('electron', () => ({
  dialog: picker, shell: picker, net: arxivNetwork, session: { fromPartition: () => arxivNetwork },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() }
}))
vi.mock('../src/main/library/translator', () => ({ runTranslation: engine.run, translatorExecutable: engine.installed, translationConfigTemplate: engine.config, terminateTranslator: engine.stop }))
import { LibraryService } from '../src/main/library/service'
import type { SecretProtector } from '../src/main/library/translation-profiles'
import { defaultArxivSettings, localDay } from '../src/shared/arxiv'
import type { PublicationInput } from '../src/shared/types'

const resources: { connection: DatabaseConnection; service: LibraryService; directory: string }[] = []
const protector: SecretProtector = {
  available: () => true,
  encrypt: (value) => Buffer.from(`protected:${value}`).toString('base64'),
  decrypt: (value) => Buffer.from(value, 'base64').toString('utf8').replace(/^protected:/, '')
}
function setup(withWindow = false) {
  const directory = mkdtempSync(join(tmpdir(), 'library-service-'))
  const connection = openDatabase(join(directory, 'workbench.sqlite'), resolve('src/main/database/migrations'))
  const service = new LibraryService(connection, () => withWindow ? { isDestroyed: () => false, webContents: { send: vi.fn() } } as unknown as BrowserWindow : null, protector)
  service.translationProfiles.save({ id: 'siliconflow-api', name: 'SiliconFlow 自有额度', provider: 'siliconflow', model: 'Qwen/Qwen3-8B', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'test-key' })
  const config = join(directory, 'engine', 'config')
  mkdirSync(config, { recursive: true }); writeFileSync(join(config, 'config.toml.example'), '')
  service.repo.setSetting('translation.directory', join(directory, 'engine'))
  const source = join(directory, 'input.pdf')
  // A signature-only fixture isolates job orchestration. Real PDF rendering/translation is tested in Electron.
  writeFileSync(source, '%PDF-1.7\nservice test fixture\n%%EOF')
  resources.push({ connection, service, directory })
  return { directory, connection, service, source }
}
const successfulEngine = async (_directory: string, _source: string, output: string) => {
  mkdirSync(output, { recursive: true })
  const path = join(output, 'source.no_watermark.zh-CN.dual.pdf')
  writeFileSync(path, '%PDF-1.7\nstub bilingual output\n%%EOF')
  return path
}
beforeEach(() => { engine.run.mockReset(); engine.installed.mockReturnValue('installed'); engine.config.mockReturnValue('config'); engine.stop.mockReset() })
afterEach(async () => {
  for (const resource of resources.splice(0)) {
    resource.service.stop()
    await vi.waitFor(() => expect(resource.service.snapshot().papers.some((p) => p.translationStatus === 'translating')).toBe(false))
    resource.connection.close()
    rmSync(resource.directory, { recursive: true, force: true })
  }
})
describe('Library jobs with a stub translation process', () => {
  it('keeps papers idle when translation is requested before an engine is configured', async () => {
    const { service, source } = setup()
    await service.importPapers([source], null, false)
    const paper = service.snapshot().papers[0]!
    engine.installed.mockReturnValue(null)
    engine.config.mockReturnValue(null)

    await expect(service.retry(paper.id)).rejects.toThrow('尚未安装 PDF2zh 引擎')
    expect(service.repo.paper(paper.id).translationStatus).toBe('idle')
    expect(service.snapshot().autoTranslate).toBe(false)
  })

  it('previews only user-selected publication PDFs without saving records and preserves a year-only date on save', async () => {
    const { service, source } = setup(true)
    await expect(service.readPublicationPdf(source)).rejects.toThrow('请先通过成果上传窗口选择')
    picker.showOpenDialog.mockResolvedValueOnce({ canceled: false, filePaths: [source] })
    expect(await service.pickPublicationPdf()).toBe(source)
    expect(Buffer.from(await service.readPublicationPdf(source)).equals(readFileSync(source))).toBe(true)
    expect(service.snapshot().papers).toEqual([])
    picker.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] })
    expect(await service.pickPublicationPdf()).toBeNull()
    const paper = await service.createPublication(source, { title: 'Year only publication', authors: 'A', journal: 'Journal', publishedDate: '2024', doi: '', casPartition: '', jcrQuartile: '', honors: [], notes: '' })
    expect(paper.year).toBe('2024'); expect(paper.publishedDate).toBe('2024')
  })
  it('keeps old and new PDFs readable across independent directory changes and restart; translations follow each source', async () => {
    const { service, source, directory, connection } = setup(true)
    await service.importPapers([source], null, false)
    const metadata = { title: 'Storage publication', authors: 'A', journal: 'Test', publishedDate: '2026-09-08', doi: '', casPartition: '', jcrQuartile: '', honors: [], notes: '' }
    await service.createPublication(source, metadata)
    let id = '2609.12345'
    const day = localDay()
    arxivNetwork.fetch.mockImplementation(async (url: string) => new Response(url.includes('/api/')
      ? `<feed><entry><id>https://arxiv.org/abs/${id}v1</id><title>Hyperspectral image test</title><published>${day}T00:00:00Z</published></entry></feed>`
      : `%PDF-1.7\nArxiv storage ${id}\n%%EOF`))
    service.arxiv.configure({ ...defaultArxivSettings, maxPerDay: 2, directions: ['hyperspectral image'] })
    service.arxiv.start()
    await vi.waitFor(() => expect(service.arxiv.snapshot().running).toBe(false), { timeout: 8000 })
    const originals = service.repo.papers()
    expect(originals).toHaveLength(3)
    const directories = { library: join(directory, '新文献'), publication: join(directory, '新成果'), arxiv: join(directory, '每日下载') }
    for (const kind of ['library', 'publication', 'arxiv'] as const) {
      mkdirSync(directories[kind]); picker.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [directories[kind]] })
      await service.chooseStorageDirectory(kind)
    }
    expect(service.storage.snapshot().directories).toEqual(directories)
    expect(service.arxiv.snapshot().directory).toBe(directories.arxiv)
    for (const paper of originals) expect((await service.read(paper.id, 'source')).length).toBeGreaterThan(0)
    engine.run.mockImplementation(successfulEngine)
    const old = originals.find((paper) => paper.collection === 'arxiv')!
    await service.retry(old.id)
    await vi.waitFor(() => expect(service.repo.paper(old.id).translationStatus).toBe('ready'))
    expect(dirname(service.repo.paper(old.id).translatedPath!)).toBe(dirname(old.sourcePath))
    const next = join(directory, 'next.pdf'); writeFileSync(next, '%PDF-1.7\nNew location\n%%EOF')
    await service.importPapers([next], null, true)
    await service.createPublication(next, metadata)
    id = '2609.12346'
    // Change the search terms to avoid the intentionally cached metadata from the first run.
    service.arxiv.configure({ ...defaultArxivSettings, maxPerDay: 2, directions: ['hyperspectral'] })
    service.arxiv.start()
    await vi.waitFor(() => expect(service.arxiv.snapshot().running).toBe(false), { timeout: 10000 })
    const added = service.repo.papers().filter((paper) => !originals.some((old) => old.id === paper.id))
    expect(added).toHaveLength(3)
    for (const paper of added) expect(paper.sourcePath).toBe(join(directories[paper.collection], ...(paper.collection === 'arxiv' ? [day] : []), paper.id, 'source.pdf'))
    await vi.waitFor(() => expect(service.repo.papers().some((paper) => paper.translationStatus === 'translating')).toBe(false))
    service.stop()
    const restarted = new LibraryService(connection, () => null)
    try {
      expect(restarted.storage.snapshot().directories).toEqual(directories)
      for (const paper of restarted.repo.papers()) {
        expect((await restarted.read(paper.id, 'source')).length).toBeGreaterThan(0)
        if (paper.translatedPath) expect((await restarted.read(paper.id, 'translated')).length).toBeGreaterThan(0)
      }
    } finally { restarted.stop() }
    expect(readFileSync(source, 'utf8')).toContain('service test fixture')
  }, 20_000)
  it('preserves settings on cancellation or invalid folders, and opens only configured locations', async () => {
    const { service, directory, source } = setup(true)
    const before = service.storage.snapshot()
    picker.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] })
    expect(await service.chooseStorageDirectory('library')).toBeNull()
    for (const path of [source, join(directory, 'disconnected-drive')]) {
      picker.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [path] })
      await expect(service.chooseStorageDirectory('library')).rejects.toThrow('原设置已保留')
      expect(service.storage.snapshot()).toEqual(before)
    }
    picker.openPath.mockResolvedValue('')
    await service.storage.reveal('library')
    expect(picker.openPath).toHaveBeenLastCalledWith(before.directories.library)
    picker.openPath.mockResolvedValue('access denied')
    await expect(service.storage.reveal('database')).rejects.toThrow('无法打开')
  })
  it('translates a daily PDF only after explicit retry and keeps the bilingual file beside its dated original', async () => {
    const { service } = setup()
    const day = localDay()
    arxivNetwork.fetch.mockImplementation(async (url: string) => new Response(url.includes('/api/')
      ? `<feed><entry><id>https://arxiv.org/abs/2609.12345v1</id><title>Hyperspectral image test</title><published>${day}T00:00:00Z</published></entry></feed>`
      : '%PDF-1.7\nArxiv source fixture\n%%EOF'))
    service.arxiv.configure({ ...defaultArxivSettings, maxPerDay: 1, directions: ['hyperspectral image'] })
    service.arxiv.start()
    await vi.waitFor(() => expect(service.arxiv.snapshot().running).toBe(false), { timeout: 8000 })
    const paper = service.repo.papers()[0]!
    expect(paper.translationStatus).toBe('idle')
    expect(paper.sourcePath).toContain(join('Arxiv Daily', day, paper.id))
    expect(engine.run).not.toHaveBeenCalled()
    engine.run.mockImplementation(successfulEngine)
    await service.retry(paper.id)
    await vi.waitFor(() => expect(service.repo.paper(paper.id).translationStatus).toBe('ready'))
    expect(Buffer.from(await service.read(paper.id, 'translated')).toString()).toContain('stub bilingual output')
    expect(engine.run).toHaveBeenCalledTimes(1)
  }, 10_000)
  it('stores publications separately from the same reading PDF, persists metadata and never queues translation', async () => {
    const { service, source } = setup()
    await service.importPapers([source], null, false)
    const metadata: PublicationInput = { title: 'Published paper', authors: 'A, B', journal: 'Journal', doi: '10.1234/test', publishedDate: '2026-09-08', casPartition: '1区', jcrQuartile: 'Q1', honors: ['esi-hot'], notes: 'Test' }
    const publication = await service.createPublication(source, metadata)
    expect(publication).toMatchObject({ ...metadata, collection: 'publication', year: '2026', translationStatus: 'idle' })
    expect(service.repo.paper(publication.id).honors).toEqual(['esi-hot'])
    expect(Buffer.from(await service.read(publication.id, 'source'))).toEqual(readFileSync(source))
    expect(service.repo.papers()).toHaveLength(2)
    await expect(service.createPublication(source, metadata)).rejects.toThrow('当前页面')
    expect(engine.run).not.toHaveBeenCalled()
    const folder = service.repo.createFolder({ name: 'Reading', parentId: null })
    expect(() => service.repo.updatePaper(publication.id, { folderId: folder.id })).toThrow('独立管理')
  })
  it('imports valid signatures, deduplicates content and rejects non-PDFs without losing originals', async () => {
    const { service, source, directory } = setup()
    const invalid = join(directory, 'invalid.pdf'); writeFileSync(invalid, 'plain text')
    const report = await service.importPapers([source, source, invalid], null, false)
    expect(report).toMatchObject({ added: 1, duplicates: 1 })
    expect(report.failures).toHaveLength(1)
    const paper = service.snapshot().papers[0]!
    expect(Buffer.from(await service.read(paper.id, 'source'))).toEqual(readFileSync(source))
    expect(engine.run).not.toHaveBeenCalled()
    expect(readFileSync(source, 'utf8')).toContain('service test fixture')
  })
  it('keeps one job per paper and associates only the completed output with the original card', async () => {
    const { service, source } = setup()
    engine.run.mockImplementation(successfulEngine)
    await service.importPapers([source], null, true)
    const paper = service.snapshot().papers[0]!
    await service.retry(paper.id); await service.retry(paper.id)
    await vi.waitFor(() => expect(service.repo.paper(paper.id).translationStatus).toBe('ready'))
    expect(engine.run).toHaveBeenCalledTimes(1)
    expect(service.snapshot().papers).toHaveLength(1)
    expect(Buffer.from(await service.read(paper.id, 'translated')).toString()).toContain('stub bilingual output')
  })
  it('retains original content after failure and recovers on an explicit retry', async () => {
    const { service, source } = setup()
    engine.run.mockRejectedValueOnce(new Error('Network unavailable'))
    await service.importPapers([source], null, true)
    const paper = service.snapshot().papers[0]!
    await vi.waitFor(() => expect(service.repo.paper(paper.id).translationStatus).toBe('failed'))
    expect(service.repo.paper(paper.id).translationError).toBe('Network unavailable')
    expect(Buffer.from(await service.read(paper.id, 'source'))).toEqual(readFileSync(source))
    engine.run.mockImplementation(successfulEngine)
    await service.retry(paper.id)
    await vi.waitFor(() => expect(service.repo.paper(paper.id).translationStatus).toBe('ready'))
    expect(service.repo.paper(paper.id).translationError).toBe('')
  })
  it('reports missing output as failed and blocks managed-path substitution', async () => {
    const { service, source, connection, directory } = setup()
    engine.run.mockResolvedValue(join(directory, 'missing.dual.pdf'))
    await service.importPapers([source], null, true)
    const paper = service.snapshot().papers[0]!
    await vi.waitFor(() => expect(service.repo.paper(paper.id).translationStatus).toBe('failed'))
    expect(service.repo.paper(paper.id).translatedPath).toBeNull()
    connection.sqlite.prepare('UPDATE papers SET source_path = ? WHERE id = ?').run(source, paper.id)
    await expect(service.read(paper.id, 'source')).rejects.toThrow('不在托管目录')
  })
  it('marks an interrupted in-flight job on restart and keeps its source available', async () => {
    const { service, source, connection } = setup()
    await service.importPapers([source], null, false)
    const paper = service.snapshot().papers[0]!
    service.repo.translation(paper.id, 'translating')
    const restarted = new LibraryService(connection, () => null)
    expect(restarted.repo.paper(paper.id).translationStatus).toBe('interrupted')
    expect(Buffer.from(await restarted.read(paper.id, 'source'))).toEqual(readFileSync(source))
    restarted.stop()
    expect(engine.run).not.toHaveBeenCalled()
  })
})
