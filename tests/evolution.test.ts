import { afterEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { EventEmitter } from 'node:events'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { SubmissionRepository } from '../src/main/database/repositories/submissions'
import { paperMetadataDefaults } from '../src/shared/arxiv'
import type { LocalPaperMetadata, SubmissionInput } from '../src/shared/types'
import { inferLocalMetadata, type PdfMetadataEvidence } from '../src/domain/metadata'
import { submissionSchema } from '../src/domain/submissions'
import { revisionReminder } from '../src/shared/submissions'

const notices = vi.hoisted(() => ({ show: vi.fn(), supported: true }))
vi.mock('electron', () => ({ session: {}, Notification: class extends EventEmitter {
  static isSupported() { return notices.supported }
  show() { notices.show() }
  close() {}
} }))
import { crossrefBibliography, enrichMetadata, resolveBibliography } from '../src/main/library/metadata'
import { SubmissionReminders } from '../src/main/submissions/reminders'
const resources: { root: string; connection: DatabaseConnection }[] = []
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'workbench-evolution-'))
  const connection = openDatabase(join(root, 'workbench.sqlite'), resolve('src/main/database/migrations'))
  resources.push({ root, connection })
  return { connection, library: new LibraryRepository(connection.db), submissions: new SubmissionRepository(connection.db) }
}
afterEach(() => { notices.show.mockReset(); for (const { root, connection } of resources.splice(0)) { connection.close(); if (root.startsWith(tmpdir()) && root.includes('workbench-evolution-')) rmSync(root, { recursive: true, force: true }) } })
const bibliography = { title: ['Reliable Hyperspectral Image Reconstruction'], DOI: '10.1234/hsi', author: [{ given: 'Alice', family: 'Smith' }, { name: 'Research Group' }], 'container-title': ['Journal of Imaging'], published: { 'date-parts': [[2025, 8, 19]] } }
const local: LocalPaperMetadata = { title: bibliography.title[0]!, authors: 'Alice Smith', journal: '', year: '', doi: '10.1234/hsi', pageCount: 20, titleReliable: true }
const input: SubmissionInput = { title: 'An imaging manuscript', journal: 'Imaging Journal', manuscriptId: 'J-26-101', stages: [{ name: 'Submitted to Journal', occurredOn: '2026-09-01' }], revisionDueDate: null, reminderEnabled: true, reminderDays: 3, notes: '' }

describe('Bibliographic evidence and reading progress', () => {
  it('uses first-page title typography and author lines, leaves unsupported publication fields empty', () => {
    const evidence: PdfMetadataEvidence = { title: 'Microsoft Word - Draft', authors: 'admin', journal: '', publishedDate: '', doi: '', pageHeight: 800, pageCount: 8, originalName: 'download.pdf', spans: [
      { text: 'Reliable Hyperspectral Image', x: 40, y: 710, height: 18 }, { text: 'Reconstruction with Spatial Priors', x: 40, y: 685, height: 18 },
      { text: 'Alice Smith, Bob Jones', x: 40, y: 655, height: 11 }, { text: 'University of Example', x: 40, y: 634, height: 9 },
      { text: 'Abstract: This study investigates spatial priors.', x: 40, y: 560, height: 10 }
    ] }
    expect(inferLocalMetadata(evidence)).toMatchObject({ title: 'Reliable Hyperspectral Image Reconstruction with Spatial Priors', titleReliable: true, authors: 'Alice Smith, Bob Jones', year: '', journal: '', pageCount: 8 })
    expect(inferLocalMetadata({ ...evidence, spans: [], originalName: 'scanned_document.pdf' })).toMatchObject({ titleReliable: false, authors: '', year: '', journal: '', doi: '' })
  })
  it('checks DOI against title evidence, rejects ambiguous near matches, and handles invalid dates', async () => {
    expect(crossrefBibliography(bibliography)).toMatchObject({ authors: 'Alice Smith, Research Group', year: '2025', publishedDate: '2025-08-19' })
    expect(crossrefBibliography({ ...bibliography, published: { 'date-parts': [[2025, 2, 30]] } })?.publishedDate).toBe('')
    const valid = await resolveBibliography(local, '', async () => ({ message: bibliography }))
    expect(valid.source).toBe('Crossref · DOI')
    const mismatch = await resolveBibliography({ ...local, title: 'Completely unrelated research about astronomy' }, '', async (url) => ({ message: url.includes('works?') ? { items: [bibliography] } : bibliography }))
    expect(mismatch.bibliography).toBeNull()
    const ambiguous = await resolveBibliography({ ...local, doi: '' }, '', async () => ({ message: { items: [bibliography, { ...bibliography, DOI: '10.1234/other' }] } }))
    expect(ambiguous.bibliography).toBeNull()
    const failedDoi = await resolveBibliography(local, '', async (url) => ({ message: url.includes('works?') ? { items: [bibliography] } : {} }))
    expect(failedDoi.source).toBe('Crossref · 标题匹配')
  })
  it('preserves manual changes including intentionally blank fields and never reduces reading progress', async () => {
    const { library } = fixture(), now = new Date().toISOString()
    library.insert({ ...paperMetadataDefaults, id: 'paper', folderId: null, title: 'download', authors: '', journal: '', year: '', notes: 'Private notes', originalName: 'download.pdf', sourcePath: 'C:/fixture/source.pdf', translatedPath: null, sha256: 'hash', translationStatus: 'idle', translationError: '', pageCount: 0, readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now })
    const first = await enrichMetadata(library, 'paper', local, async () => ({ message: bibliography }))
    expect(first).toMatchObject({ title: local.title, journal: 'Journal of Imaging', year: '2025', metadataStatus: 'ready' })
    library.updatePaper('paper', { authors: 'My corrected author', journal: '', publishedDate: '' }, true)
    const result = await enrichMetadata(library, 'paper', local, async () => ({ message: bibliography }))
    expect(result).toMatchObject({ authors: 'My corrected author', journal: '', publishedDate: '', notes: 'Private notes', metadataStatus: 'partial' })
    library.updatePaper('paper', { readPage: 10, readProgress: 50 })
    expect(library.updatePaper('paper', { readPage: 2, readProgress: 10 })).toMatchObject({ readPage: 2, readProgress: 50 })
    library.setSetting('metadata.online', 'false')
    const fetch = vi.fn()
    await enrichMetadata(library, 'paper', local, fetch)
    expect(fetch).not.toHaveBeenCalled()
  })
  it('retains reliable PDF fields on network errors without claiming the bibliography is complete', async () => {
    const { library } = fixture(), now = new Date().toISOString()
    library.insert({ ...paperMetadataDefaults, id: 'paper', folderId: null, title: 'download', authors: '', journal: '', year: '', notes: '', originalName: 'download.pdf', sourcePath: 'C:/fixture/source.pdf', translatedPath: null, sha256: 'hash', translationStatus: 'idle', translationError: '', pageCount: 0, readPage: 0, translatedReadPage: 0, lastReadAt: null, addedAt: now, updatedAt: now })
    const paper = await enrichMetadata(library, 'paper', local, async () => { throw new Error('HTTP 429') })
    expect(paper).toMatchObject({ title: local.title, authors: local.authors, journal: '', year: '', metadataStatus: 'partial' })
    expect(paper.metadataMessage).toContain('HTTP 429')
  })
})
describe('Submissions and revision reminders', () => {
  it('stores ordered custom status names and dates, preserves stage IDs on edits, and deletes stages atomically', () => {
    const { connection, submissions } = fixture()
    const created = submissions.create(input)
    expect(created).toMatchObject({ currentStage: 'Submitted to Journal', submittedDate: '2026-09-01' })
    const firstId = created.stages[0]!.id
    const withEditor = submissions.update(created.id, { ...input, stages: [
      { id: firstId, name: 'Submitted to Journal', occurredOn: '2026-09-01' },
      { name: 'With editor', occurredOn: '2026-09-10' }
    ] })
    expect(withEditor.stages.map(({ name, occurredOn }) => ({ name, occurredOn }))).toEqual([
      { name: 'Submitted to Journal', occurredOn: '2026-09-01' }, { name: 'With editor', occurredOn: '2026-09-10' }
    ])
    const deadline = submissions.update(created.id, { ...input, stages: withEditor.stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn })), revisionDueDate: '2026-09-15' })
    expect(deadline.stages.map((stage) => stage.id)).toEqual(withEditor.stages.map((stage) => stage.id))
    submissions.delete(created.id)
    expect(submissions.list()).toEqual([])
    expect(connection.sqlite.prepare('SELECT * FROM submission_stages').all()).toEqual([])
  })
  it('validates real dates, chronological stages and reminder deadlines', () => {
    expect(submissionSchema.safeParse({ ...input, stages: [{ name: 'Submitted', occurredOn: '2026-02-30' }] }).success).toBe(false)
    expect(submissionSchema.safeParse({ ...input, revisionDueDate: '2026-08-30' }).success).toBe(false)
    expect(submissionSchema.safeParse({ ...input, stages: [{ name: 'Later', occurredOn: '2026-09-10' }, { name: 'Earlier', occurredOn: '2026-09-01' }] }).success).toBe(false)
    const { submissions } = fixture()
    const revision = submissions.create({ ...input, stages: [{ name: 'Major Revision', occurredOn: '2026-12-20' }], revisionDueDate: '2027-01-02' })
    expect(revisionReminder(revision, '2026-12-30')?.days).toBe(3)
    expect(revisionReminder(revision, '2027-01-03')?.label).toContain('逾期 1 天')
    expect(revisionReminder({ ...revision, reminderEnabled: false }, '2027-01-03')).toBeNull()
  })
  it('catches up once per day across restart and pauses during relocation', () => {
    const { connection, submissions } = fixture()
    submissions.create({ ...input, stages: [{ name: 'Major Revision', occurredOn: '2026-09-01' }], revisionDueDate: '2026-09-11' })
    let paused = false
    const service = new SubmissionReminders(() => connection, () => null, () => paused, () => {})
    service.check(new Date(2026, 8, 7, 12)); expect(notices.show).toHaveBeenCalledTimes(0)
    service.check(new Date(2026, 8, 8, 12)); service.check(new Date(2026, 8, 8, 14)); expect(notices.show).toHaveBeenCalledTimes(1)
    service.stop()
    const restarted = new SubmissionReminders(() => connection, () => null, () => paused, () => {})
    restarted.check(new Date(2026, 8, 8, 16)); expect(notices.show).toHaveBeenCalledTimes(1)
    paused = true; restarted.check(new Date(2026, 8, 9, 12)); expect(notices.show).toHaveBeenCalledTimes(1)
    paused = false; restarted.check(new Date(2026, 8, 12, 12)); expect(notices.show).toHaveBeenCalledTimes(2)
    restarted.stop()
  })
})
