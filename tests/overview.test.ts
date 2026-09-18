import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { extractPaperAbstract, parseOverviewTranslation } from '../src/domain/overview'
import { PaperOverviewService } from '../src/main/library/overview'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { paperMetadataDefaults } from '../src/shared/arxiv'

const resources: { directory: string; connection: DatabaseConnection }[] = []
afterEach(() => { for (const { directory, connection } of resources.splice(0)) { connection.close(); rmSync(directory, { recursive: true, force: true }) } })
const translation = { titleZh: '高光谱图像分类方法', abstractZh: '本文提出一种高光谱图像分类方法，并在两个数据集上进行了实验。' }
function setup(abstract = 'We present an image classification method and evaluate it on two datasets.') {
  const directory = mkdtempSync(join(tmpdir(), 'workbench-overview-'))
  const connection = openDatabase(join(directory, 'workbench.sqlite'), resolve('src/main/database/migrations'))
  resources.push({ directory, connection })
  const repo = new LibraryRepository(connection.db), now = new Date().toISOString()
  const paper = repo.insert({ ...paperMetadataDefaults, id: randomUUID(), folderId: null, title: 'Hyperspectral image classification', abstract,
    authors: '', journal: '', year: '', notes: 'private notes never sent', originalName: 'source.pdf', sourcePath: 'source.pdf', translatedPath: null, sha256: 'fixture',
    translationStatus: 'idle', translationError: '', pageCount: 2, readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now })
  const translate = vi.fn(async () => translation)
  const service = new PaperOverviewService(() => connection, translate)
  return { connection, repo, paper, translate, service }
}
describe('Paper overview translation', () => {
  it('extracts only a marked and bounded abstract, never introduction text', () => {
    const body = 'We present a classification method. It preserves spectral information and uses two datasets.'
    expect(extractPaperAbstract(`Title\nAbstract—${body}\nIndex Terms—classification\nI. Introduction\nUnrelated`)).toBe(body)
    expect(extractPaperAbstract(`Abstract\n${body}\n1. Introduction\nUnrelated`)).toBe(body)
    expect(extractPaperAbstract(`Introduction\n${body}`)).toBeNull()
    expect(extractPaperAbstract(`Abstract\n${body}`)).toBeNull()
  })
  it('requires exactly a Chinese title and abstract', () => {
    expect(parseOverviewTranslation('```json\n' + JSON.stringify(translation) + '\n```')).toEqual(translation)
    for (const value of [{ ...translation, summary: 'extra' }, { titleZh: 'English only', abstractZh: 'English only' }, { titleZh: '题目', abstractZh: '' }])
      expect(() => parseOverviewTranslation(JSON.stringify(value))).toThrow(/中文/)
  })
  it('deduplicates requests, persists across services, and leaves paper fields and full translation untouched', async () => {
    const { connection, repo, paper, translate, service } = setup()
    expect(service.read(paper.id)).toBeNull()
    const [one, two] = await Promise.all([service.generate({ id: paper.id }), service.generate({ id: paper.id })])
    expect(one).toEqual(two); expect(translate).toHaveBeenCalledTimes(1)
    expect(translate).toHaveBeenCalledWith(paper.title, paper.abstract)
    const restarted = new PaperOverviewService(() => connection, translate)
    expect(restarted.read(paper.id)).toEqual(one)
    await restarted.generate({ id: paper.id })
    expect(translate).toHaveBeenCalledTimes(1)
    expect(repo.paper(paper.id)).toEqual(paper)
  })
  it('rejects missing abstracts before calling AI and allows a supplied original abstract', async () => {
    const { paper, translate, service } = setup('')
    await expect(service.generate({ id: paper.id })).rejects.toThrow(/原文摘要/)
    expect(translate).not.toHaveBeenCalled()
    await expect(service.generate({ id: paper.id, sourceAbstract: 'Original abstract supplied from PDF.' })).resolves.toMatchObject(translation)
  })
  it('preserves cached results after a failed refresh and invalidates changed metadata', async () => {
    const { repo, paper, translate, service } = setup()
    const first = await service.generate({ id: paper.id })
    translate.mockRejectedValueOnce(new Error('Unavailable'))
    await expect(service.generate({ id: paper.id, regenerate: true })).rejects.toThrow('Unavailable')
    expect(service.read(paper.id)).toEqual(first)
    repo.updatePaper(paper.id, { title: 'Updated title' })
    expect(service.read(paper.id)).toBeNull()
    await service.generate({ id: paper.id })
    expect(translate).toHaveBeenLastCalledWith('Updated title', paper.abstract)
    repo.deletePaper(paper.id)
    expect(repo.setting(`paper.overview.v1.${paper.id}`, '')).toBe('')
  })
  it('does not save a translation if the paper changes while AI is responding', async () => {
    const { repo, paper, translate, service } = setup()
    translate.mockImplementationOnce(async () => { repo.updatePaper(paper.id, { title: 'Changed during request' }); return translation })
    await expect(service.generate({ id: paper.id })).rejects.toThrow(/文献信息已更新/)
    expect(service.read(paper.id)).toBeNull()
  })
})
