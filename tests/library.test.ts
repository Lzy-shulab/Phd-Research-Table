import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { LibraryRepository } from '../src/main/database/repositories/library'
import type { Paper } from '../src/shared/types'
import { paperMetadataDefaults } from '../src/shared/arxiv'

const connections: DatabaseConnection[] = []
const directories: string[] = []
function database(path = ':memory:') {
  const connection = openDatabase(path, resolve('src/main/database/migrations'))
  connections.push(connection)
  return { ...connection, library: new LibraryRepository(connection.db) }
}
function paper(folderId: string | null): Paper {
  return { ...paperMetadataDefaults, id: randomUUID(), folderId, title: 'A research paper', authors: '', journal: '', year: '', notes: '',
    sourcePath: '/managed/source.pdf', originalName: 'source.pdf', translatedPath: null, sha256: randomUUID(),
    translationStatus: 'queued', translationError: '', pageCount: 10, readPage: 0, translatedReadPage: 0,
    lastReadAt: null, addedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
}
afterEach(() => {
  for (const connection of connections.splice(0)) if (connection.sqlite.open) connection.close()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})
describe('Literature persistence and folder invariants', () => {
  it('rejects folder cycles and keeps documents when a folder is removed', () => {
    const { library, sqlite } = database()
    const parent = library.createFolder({ name: 'Journals', parentId: null })
    const child = library.createFolder({ name: 'IEEE TGRS', parentId: parent.id })
    const document = library.insert(paper(parent.id))
    expect(() => library.updateFolder(parent.id, { name: 'Journals', parentId: child.id })).toThrow('自己的子文件夹')
    library.deleteFolder(parent.id)
    expect(library.folder(child.id).parentId).toBeNull()
    expect(library.paper(document.id)).toMatchObject({ folderId: null, sourcePath: document.sourcePath })
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })
  it('preserves translated output, reading position, notes and settings across restart', () => {
    const directory = mkdtempSync(join(tmpdir(), 'library-test-')); directories.push(directory)
    const path = join(directory, 'workbench.sqlite')
    const first = database(path)
    const folder = first.library.createFolder({ name: 'Reading', parentId: null })
    const document = first.library.insert(paper(folder.id))
    first.library.translation(document.id, 'ready', '', '/managed/bilingual.pdf')
    first.library.updatePaper(document.id, { readPage: 3, translatedReadPage: 7, notes: '研究线索', journal: 'IEEE TGRS' })
    first.library.setSetting('translation.auto', 'false')
    first.close()
    const second = database(path)
    expect(second.library.paper(document.id)).toMatchObject({ translationStatus: 'ready', translatedPath: '/managed/bilingual.pdf',
      readPage: 3, translatedReadPage: 7, notes: '研究线索', journal: 'IEEE TGRS', folderId: folder.id })
    expect(second.library.setting('translation.auto', 'true')).toBe('false')
    expect(second.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })
  it('deduplicates by content hash and validates folder moves', () => {
    const { library } = database()
    const document = library.insert(paper(null))
    expect(library.byHash(document.sha256)?.id).toBe(document.id)
    expect(() => library.insert({ ...document, id: randomUUID() })).toThrow()
    expect(() => library.updatePaper(document.id, { folderId: randomUUID() })).toThrow('文件夹已不存在')
    const destination = library.createFolder({ name: 'CVPR', parentId: null })
    expect(library.updatePaper(document.id, { folderId: destination.id }).folderId).toBe(destination.id)
    library.translation(document.id, 'failed', 'Network unavailable')
    expect(library.paper(document.id).sourcePath).toBe(document.sourcePath)
    expect(library.paper(document.id).translationError).toBe('Network unavailable')
  })
})
