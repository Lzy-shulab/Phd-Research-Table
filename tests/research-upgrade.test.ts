import { describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase } from '../src/main/database/db'
import { LibraryRepository } from '../src/main/database/repositories/library'
import { publicationSchema, arxivSettingsSchema } from '../src/domain/research'

describe('Research workspace upgrade', () => {
  it('preserves every old paper field, folder, task, setting and translation path when upgrading a nonempty v0.3 database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'research-upgrade-'))
    const migrations = join(directory, 'old-migrations')
    mkdirSync(join(migrations, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(resolve('src/main/database/migrations/meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.slice(0, 2)
    writeFileSync(join(migrations, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) copyFileSync(resolve('src/main/database/migrations', `${entry.tag}.sql`), join(migrations, `${entry.tag}.sql`))
    const path = join(directory, 'workbench.sqlite')
    const old = openDatabase(path, migrations)
    const tables = ['papers', 'library_folders', 'tasks', 'projects', 'app_settings']
    let before: Record<string, Record<string, unknown>[]>
    try {
      old.sqlite.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES ('project','原项目','then','then')").run()
      old.sqlite.prepare("INSERT INTO tasks(id,title,project_id,status,scheduled_date,start_time,end_time,created_at,updated_at) VALUES ('plan','分钟计划','project','planned','2026-09-12','09:17','10:43','then','then')").run()
      old.sqlite.prepare("INSERT INTO library_folders(id,name,created_at) VALUES ('folder','原期刊文件夹','then')").run()
      old.sqlite.prepare("INSERT INTO papers(id,folder_id,title,authors,journal,year,notes,original_name,source_path,translated_path,sha256,translation_status,page_count,read_page,translated_read_page,added_at,updated_at) VALUES ('paper','folder','原文献','原作者','期刊','2025','原笔记','input.pdf','C:/managed/source.pdf','C:/managed/bilingual.pdf','hash','ready',20,7,13,'then','then')").run()
      old.sqlite.prepare("INSERT INTO app_settings(key,value) VALUES ('translation.directory','D:/engine')").run()
      before = Object.fromEntries(tables.map((table) => [table, old.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()])) as typeof before
    } finally { old.close() }
    const upgraded = openDatabase(path, resolve('src/main/database/migrations'))
    try {
      for (const table of tables) {
        const rows = upgraded.sqlite.prepare(`SELECT * FROM ${table} ORDER BY 1`).all() as Record<string, unknown>[]
        expect(rows).toHaveLength(before[table]!.length)
        for (const [index, row] of before[table]!.entries()) expect(rows[index]).toMatchObject(row)
      }
      expect(upgraded.sqlite.prepare('SELECT collection FROM papers').get()).toEqual({ collection: 'library' })
      expect(upgraded.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(upgraded.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(upgraded.sqlite.prepare('SELECT read_progress, metadata_status, honors FROM papers').get()).toEqual({ read_progress: 65, metadata_status: 'pending', honors: '[]' })
      expect(new LibraryRepository(upgraded.db).papers()[0]?.honors).toEqual([])
      expect(upgraded.sqlite.prepare('SELECT * FROM submissions').all()).toEqual([])
      expect(upgraded.sqlite.prepare('SELECT * FROM submission_stages').all()).toEqual([])
      expect(upgraded.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(6)
    } finally { upgraded.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('backfills legacy submission events into editable custom stages without changing old rows', () => {
    const directory = mkdtempSync(join(tmpdir(), 'submission-upgrade-'))
    const migrations = join(directory, 'old-migrations')
    mkdirSync(join(migrations, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(resolve('src/main/database/migrations/meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.slice(0, 5)
    writeFileSync(join(migrations, 'meta/_journal.json'), JSON.stringify(journal))
    for (const entry of journal.entries) copyFileSync(resolve('src/main/database/migrations', `${entry.tag}.sql`), join(migrations, `${entry.tag}.sql`))
    const path = join(directory, 'workbench.sqlite')
    const old = openDatabase(path, migrations)
    let submissionsBefore: unknown[], eventsBefore: unknown[]
    try {
      old.sqlite.prepare("INSERT INTO submissions(id,title,journal,manuscript_id,submitted_date,status,reminder_enabled,reminder_days,notes,created_at,updated_at) VALUES ('submission','Paper','Journal','','2026-08-28','under_review',1,3,'','2026-09-08T04:00:00.000Z','2026-09-10T04:00:00.000Z')").run()
      old.sqlite.prepare("INSERT INTO submission_events(id,submission_id,from_status,to_status,occurred_at,note) VALUES ('11111111-1111-4111-8111-111111111111','submission',NULL,'submitted','2026-09-08T04:00:00.000Z','建立投稿记录')").run()
      old.sqlite.prepare("INSERT INTO submission_events(id,submission_id,from_status,to_status,occurred_at,note) VALUES ('22222222-2222-4222-8222-222222222222','submission','submitted','under_review','2026-09-10T04:00:00.000Z','更新投稿阶段')").run()
      submissionsBefore = old.sqlite.prepare('SELECT * FROM submissions').all()
      eventsBefore = old.sqlite.prepare('SELECT * FROM submission_events ORDER BY occurred_at').all()
    } finally { old.close() }
    const upgraded = openDatabase(path, resolve('src/main/database/migrations'))
    try {
      expect(upgraded.sqlite.prepare('SELECT * FROM submissions').all()).toEqual(submissionsBefore)
      expect(upgraded.sqlite.prepare('SELECT * FROM submission_events ORDER BY occurred_at').all()).toEqual(eventsBefore)
      expect(upgraded.sqlite.prepare('SELECT name,occurred_on,position FROM submission_stages ORDER BY position').all()).toEqual([
        { name: '已投稿', occurred_on: '2026-08-28', position: 0 },
        { name: '审稿中', occurred_on: '2026-09-10', position: 1 }
      ])
      expect(upgraded.sqlite.pragma('foreign_key_check')).toEqual([])
      expect(upgraded.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    } finally { upgraded.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('validates publication metadata without inventing DOI or partition values', () => {
    const metadata = { title: 'Paper', authors: 'A', journal: 'Journal', publishedDate: '2026-09-08', doi: '', casPartition: '', jcrQuartile: '', honors: [], notes: '' }
    expect(publicationSchema.parse(metadata).doi).toBe('')
    expect(publicationSchema.parse({ ...metadata, doi: 'https://doi.org/10.1234/test' }).doi).toBe('10.1234/test')
    expect(publicationSchema.safeParse({ ...metadata, publishedDate: '2026-02-30' }).success).toBe(false)
    expect(publicationSchema.safeParse({ ...metadata, doi: 'not-a-doi' }).success).toBe(false)
    expect(publicationSchema.safeParse({ ...metadata, journal: '' }).success).toBe(false)
    expect(publicationSchema.safeParse({ ...metadata, casPartition: 'Q1' }).success).toBe(false)
    for (const casPartition of ['1区', '非SCI', 'EI', '中文核心', '大学学报']) {
      expect(publicationSchema.parse({ ...metadata, casPartition }).casPartition).toBe(casPartition)
    }
    expect(publicationSchema.parse({ ...metadata, honors: ['esi-highly-cited', 'esi-hot'] }).honors).toEqual(['esi-highly-cited', 'esi-hot'])
    expect(publicationSchema.safeParse({ ...metadata, honors: ['esi-hot', 'esi-hot'] }).success).toBe(false)
    expect(arxivSettingsSchema.safeParse({ enabled: true, daysBack: 14, maxPerDay: 5, directions: [] }).success).toBe(false)
  })
  it('supports exactly three folder levels and rejects deeper or subtree-breaking moves', () => {
    const connection = openDatabase(':memory:', resolve('src/main/database/migrations'))
    try {
      const repo = new LibraryRepository(connection.db)
      const root = repo.createFolder({ name: '遥感', parentId: null })
      const child = repo.createFolder({ name: '高光谱', parentId: root.id })
      const grandchild = repo.createFolder({ name: '融合', parentId: child.id })
      expect(repo.folders().map((folder) => folder.name)).toEqual(['遥感', '高光谱', '融合'])
      expect(() => repo.createFolder({ name: '第四级', parentId: grandchild.id })).toThrow('最多支持三级')
      const other = repo.createFolder({ name: '其他', parentId: null })
      expect(() => repo.updateFolder(root.id, { name: root.name, parentId: other.id })).toThrow('最多支持三级')
      expect(repo.folder(root.id).parentId).toBeNull()
    } finally { connection.close() }
  })
})
