import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { DatabaseLocation } from '../src/main/database/location'
import { relocateDatabase } from '../src/main/database/relocate'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { StoragePaths } from '../src/main/library/storage-paths'
import { paperMetadataDefaults } from '../src/shared/arxiv'

const migrationsFolder = resolve('src/main/database/migrations')
const resources: { root: string; connections: DatabaseConnection[] }[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workbench-relocation-'))
  const profile = join(root, 'original-profile')
  const connection = openDatabase(join(profile, 'workbench.sqlite'), migrationsFolder)
  const resource = { root, connections: [connection] }; resources.push(resource)
  const location = new DatabaseLocation(profile)
  const repo = new LibraryRepository(connection.db)
  const paths = new StoragePaths(repo, connection.path)
  const project = new ProjectRepository(connection.db).create({ name: 'Migration project', description: 'Keep this description', colorKey: 'blue' })
  new TaskRepository(connection.db).create({ title: 'Preserve minutes and project', projectId: project.id, scheduledDate: '2026-09-08', startTime: '09:17', endTime: '10:43' })
  for (const collection of ['library', 'publication', 'arxiv'] as const) {
    const id = randomUUID(), now = new Date().toISOString(), collectedDate = collection === 'arxiv' ? '2026-09-08' : ''
    const directory = paths.paperDirectory({ id, collection, collectedDate })
    mkdirSync(join(directory, 'jobs', 'saved-task'), { recursive: true })
    writeFileSync(join(directory, 'source.pdf'), `%PDF-1.7\nSource ${collection}`)
    writeFileSync(join(directory, 'bilingual.pdf'), `%PDF-1.7\nTranslation ${collection}`)
    writeFileSync(join(directory, 'jobs', 'saved-task', 'log.txt'), 'Preserved translation log')
    repo.insert({ ...paperMetadataDefaults, id, collection, collectedDate, folderId: null, arxivId: collection === 'arxiv' ? '2609.12345' : null,
      title: `Paper ${collection}`, authors: 'User author', journal: 'User journal', year: '2026', notes: 'Do not lose my notes',
      originalName: `${collection}.pdf`, sourcePath: join(directory, 'source.pdf'), translatedPath: join(directory, 'bilingual.pdf'), sha256: `hash-${collection}`,
      translationStatus: 'ready', translationError: '', pageCount: 12, readPage: 4, translatedReadPage: 5, lastReadAt: now, addedAt: now, updatedAt: now })
  }
  repo.setSetting('translation.directory', 'D:/engine')
  return { root, connection, resource, location, repo, paths }
}
afterEach(() => {
  for (const resource of resources.splice(0)) {
    for (const connection of resource.connections) if (connection.sqlite.open) connection.close()
    const root = resolve(resource.root)
    if (root.startsWith(resolve(tmpdir())) && root.includes('workbench-relocation-')) rmSync(root, { recursive: true, force: true })
  }
})
describe('Database and managed PDF relocation', () => {
  it('moves all managed files and metadata with checksums, preserves minute tasks, and restarts from the locator', async () => {
    const { root, connection, resource, location, repo, paths } = fixture()
    const originals = repo.papers()
    const oldTasks = new TaskRepository(connection.db).list()
    const dataRoot = join(root, '新工作台数据')
    let active = connection
    const report = await relocateDatabase(connection, { directory: join(dataRoot, '数据库'), dataRoot, migrationsFolder,
      activate: (next) => { location.set(next.path); connection.close(); active = next; resource.connections.push(next) } })
    expect(report.retainedSources).toEqual([])
    expect(report.copiedFiles).toBe(9)
    expect(existsSync(connection.path)).toBe(false)
    expect(new TaskRepository(active.db).list()).toEqual(oldTasks)
    const movedRepo = new LibraryRepository(active.db)
    const movedPaths = new StoragePaths(movedRepo, active.path)
    for (const old of originals) {
      const moved = movedRepo.paper(old.id)
      expect(moved.notes).toBe(old.notes)
      expect(moved.readPage).toBe(4)
      expect(moved.translatedReadPage).toBe(5)
      expect(moved.updatedAt).toBe(old.updatedAt)
      expect(movedPaths.file(moved, 'source')).toBe(moved.sourcePath)
      expect(readFileSync(moved.sourcePath, 'utf8')).toContain(`Source ${moved.collection}`)
      expect(readFileSync(moved.translatedPath!, 'utf8')).toContain(`Translation ${moved.collection}`)
      expect(readFileSync(join(dirname(moved.sourcePath), 'jobs', 'saved-task', 'log.txt'), 'utf8')).toBe('Preserved translation log')
      expect(existsSync(old.sourcePath)).toBe(false)
    }
    expect(paths.snapshot).toBeDefined()
    active.close()
    const restarted = openDatabase(location.get(), migrationsFolder); resource.connections.push(restarted)
    expect(new TaskRepository(restarted.db).list()).toEqual(oldTasks)
    expect(new StoragePaths(new LibraryRepository(restarted.db), restarted.path).snapshot().directories).toEqual(report.directories)
  })
  it('moving only the database preserves the absolute default and historic PDF locations', async () => {
    const { root, connection, resource, location, repo, paths } = fixture()
    const before = repo.papers()
    const previousDirectories = paths.snapshot().directories
    let active = connection
    await relocateDatabase(connection, { directory: join(root, 'custom-database'), migrationsFolder,
      activate: (next) => { location.set(next.path); connection.close(); active = next; resource.connections.push(next) } })
    const movedRepo = new LibraryRepository(active.db)
    expect(movedRepo.papers()).toEqual(before)
    const newPaths = new StoragePaths(movedRepo, active.path)
    expect(newPaths.snapshot().directories).toEqual(previousDirectories)
    for (const paper of before) expect(readFileSync(newPaths.file(paper, 'translated'), 'utf8')).toContain('Translation')
    expect(location.get()).toBe(active.path)
  })
  it('never overwrites a destination database and rolls back a failed activation without deleting sources', async () => {
    const { root, connection, repo } = fixture()
    const target = join(root, 'occupied'); mkdirSync(target)
    const sentinel = join(target, 'workbench.sqlite'); writeFileSync(sentinel, 'Do not overwrite')
    await expect(relocateDatabase(connection, { directory: target, migrationsFolder, activate: () => {} })).rejects.toThrow('不会被覆盖')
    expect(readFileSync(sentinel, 'utf8')).toBe('Do not overwrite')
    const dataRoot = join(root, 'failed-move')
    await expect(relocateDatabase(connection, { directory: join(dataRoot, '数据库'), dataRoot, migrationsFolder, activate: () => { throw new Error('Locator unavailable') } })).rejects.toThrow('原数据保留')
    expect(existsSync(connection.path)).toBe(true)
    expect(existsSync(join(dataRoot, '数据库', 'workbench.sqlite'))).toBe(false)
    expect(repo.papers()).toHaveLength(3)
    for (const paper of repo.papers()) expect(existsSync(paper.sourcePath)).toBe(true)
    expect(connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
  })
  it('does not create a blank database when a saved external location becomes unavailable', () => {
    const { root, location } = fixture()
    writeFileSync(location.configPath, JSON.stringify({ databasePath: join(root, 'offline-drive', 'workbench.sqlite') }))
    expect(() => location.get()).toThrow('暂时不可用')
  })
})
