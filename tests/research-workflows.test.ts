import { afterEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { SubmissionRepository } from '../src/main/database/repositories/submissions'
import { paperMetadataDefaults } from '../src/shared/arxiv'
import { revisionReminder } from '../src/shared/submissions'

const connections: DatabaseConnection[] = []
const setup = () => {
  const connection = openDatabase(':memory:', resolve('src/main/database/migrations'))
  connections.push(connection)
  return connection
}
afterEach(() => { for (const connection of connections.splice(0)) connection.close() })

describe('Connected research workflows', () => {
  it('creates independent weekly occurrences and only syncs future entries on explicit request', () => {
    const connection = setup(), projects = new ProjectRepository(connection.db), tasks = new TaskRepository(connection.db)
    const project = projects.create({ name: '组会', description: '', colorKey: 'sage' })
    const series = tasks.createSeries({ title: '每周组会', projectId: project.id, scheduledDate: '2026-09-07', recurrence: 'weekly', occurrences: 3 })
    expect(series.map((task) => task.scheduledDate)).toEqual(['2026-09-07', '2026-09-14', '2026-09-21'])
    tasks.complete(series[0]!.id, true)
    expect(tasks.get(series[1]!.id).status).not.toBe('completed')
    tasks.update(series[1]!.id, { title: '本周组会改期讨论' })
    expect(tasks.get(series[2]!.id).title).toBe('每周组会')
    tasks.updateSeries(series[0]!.seriesId!, '2026-09-14', { priority: 'high' })
    expect(tasks.list().filter((task) => task.occurrenceDate! >= '2026-09-14').every((task) => task.priority === 'high')).toBe(true)
  })

  it('keeps last and furthest reading positions separate and reserves 100 percent for manual completion', () => {
    const connection = setup(), library = new LibraryRepository(connection.db), id = randomUUID(), now = new Date().toISOString()
    library.insert({ ...paperMetadataDefaults, id, collection: 'library', folderId: null, title: 'Paper', authors: 'A', journal: 'J', year: '2026', notes: '', originalName: 'paper.pdf', sourcePath: 'C:/managed/source.pdf', translatedPath: null, sha256: 'hash', translationStatus: 'idle', translationError: '', pageCount: 10, readPage: 1, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now })
    expect(library.updatePaper(id, { readPage: 10, maxReadPage: 10, readingStatus: 'reading', readProgress: 100 })).toMatchObject({ readPage: 10, maxReadPage: 10, readingStatus: 'reading', readProgress: 99 })
    expect(library.updatePaper(id, { readPage: 3 })).toMatchObject({ readPage: 3, maxReadPage: 10, readProgress: 99 })
    expect(library.updatePaper(id, { readingStatus: 'done' })).toMatchObject({ readPage: 3, maxReadPage: 10, readingStatus: 'done', readProgress: 100 })
  })

  it('persists normalized colored PDF highlights without changing the source file', () => {
    const connection = setup(), library = new LibraryRepository(connection.db), id = randomUUID(), now = new Date().toISOString()
    library.insert({ ...paperMetadataDefaults, id, collection: 'library', folderId: null, title: 'Paper', authors: 'A', journal: 'J', year: '2026', notes: '', originalName: 'paper.pdf', sourcePath: 'C:/managed/source.pdf', translatedPath: null, sha256: 'highlight-hash', translationStatus: 'idle', translationError: '', pageCount: 4, readPage: 1, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now })
    const highlight = { id: randomUUID(), page: 2, text: 'selected paragraph', color: 'method' as const, rects: [{ x: 0.12, y: 0.32, width: 0.56, height: 0.025 }], createdAt: now }
    expect(library.updatePaper(id, { highlights: [highlight] })).toMatchObject({ sourcePath: 'C:/managed/source.pdf', highlights: [highlight] })
    expect(new LibraryRepository(connection.db).paper(id).highlights).toEqual([highlight])
  })

  it('removes completed or ended revision deadlines from active reminders while retaining the date', () => {
    const connection = setup(), submissions = new SubmissionRepository(connection.db)
    const input = { title: 'Paper', journal: 'Journal', manuscriptId: '', stages: [{ name: 'Major revision', occurredOn: '2026-09-01' }], revisionDueDate: '2026-09-10', reminderEnabled: true, reminderDays: 3, notes: '' }
    const base = submissions.create(input)
    expect(revisionReminder(base, '2026-09-11')?.label).toContain('逾期')
    const completed = submissions.update(base.id, { ...input, stages: base.stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn })), revisionCompleted: true })
    expect(completed.revisionDueDate).toBe('2026-09-10')
    expect(revisionReminder(completed, '2026-09-11')).toBeNull()
    const ended = submissions.update(base.id, { ...input, stages: completed.stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn })), revisionCompleted: false, ended: true })
    expect(revisionReminder(ended, '2026-09-11')).toBeNull()
  })
})
