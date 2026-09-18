import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, rmdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { SettingsRepository } from '../src/main/database/repositories/settings'
import { taskCreateSchema, taskPatchSchema, isCalendarDate } from '../src/domain/validation'

const connections: DatabaseConnection[] = []
const database = (path = ':memory:') => {
  const connection = openDatabase(path, resolve('src/main/database/migrations'))
  connections.push(connection)
  return {
    ...connection,
    tasks: new TaskRepository(connection.db),
    projects: new ProjectRepository(connection.db),
    settings: new SettingsRepository(connection.db)
  }
}
const projectTaskDatabase = () => {
  const db = database()
  const project = db.projects.create({ name: 'Test project', description: '', colorKey: 'blue' })
  return { ...db, projectId: project.id }
}
afterEach(() => {
  for (const c of connections.splice(0)) if (c.sqlite.open) c.close()
})
describe('SQLite persistence and domain invariants', () => {
  it('upgrades a nonempty v0.2 database without changing plans, legacy unassigned records or settings', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-upgrade-'))
    const oldMigrations = join(dir, 'migrations')
    mkdirSync(join(oldMigrations, 'meta'), { recursive: true })
    const journal = JSON.parse(readFileSync(resolve('src/main/database/migrations/meta/_journal.json'), 'utf8'))
    journal.entries = journal.entries.slice(0, 1)
    writeFileSync(join(oldMigrations, 'meta/_journal.json'), JSON.stringify(journal))
    const migrationFile = `${journal.entries[0].tag}.sql`
    copyFileSync(resolve('src/main/database/migrations', migrationFile), join(oldMigrations, migrationFile))
    const path = join(dir, 'workbench.sqlite')
    const old = openDatabase(path, oldMigrations)
    connections.push(old)
    old.sqlite.prepare("INSERT INTO projects(id,name,created_at,updated_at) VALUES ('project','原有研究','then','then')").run()
    old.sqlite.prepare("INSERT INTO tasks(id,title,project_id,status,scheduled_date,start_time,end_time,created_at,updated_at) VALUES ('plan','原有计划','project','planned','2026-09-12','09:17','10:43','then','then')").run()
    old.sqlite.prepare("INSERT INTO tasks(id,title,created_at,updated_at) VALUES ('unassigned','旧的待归属计划','then','then')").run()
    old.sqlite.prepare("INSERT INTO app_settings(key,value) VALUES ('appearance','dark')").run()
    const before = {
      tasks: old.sqlite.prepare('SELECT * FROM tasks ORDER BY id').all(),
      projects: old.sqlite.prepare('SELECT * FROM projects').all(),
      settings: old.sqlite.prepare('SELECT * FROM app_settings').all()
    }
    old.close()
    const upgraded = database(path)
    expect(upgraded.sqlite.prepare('SELECT * FROM tasks ORDER BY id').all()).toEqual(before.tasks)
    expect(upgraded.sqlite.prepare('SELECT * FROM projects').all()).toEqual(before.projects)
    expect(upgraded.sqlite.prepare('SELECT * FROM app_settings').all()).toEqual(before.settings)
    expect(upgraded.sqlite.prepare('SELECT * FROM library_folders').all()).toEqual([])
    expect(upgraded.sqlite.prepare('SELECT * FROM papers').all()).toEqual([])
    expect(upgraded.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(6)
    expect(upgraded.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(upgraded.sqlite.pragma('foreign_key_check')).toEqual([])
    upgraded.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
    rmSync(join(oldMigrations, migrationFile)); rmSync(join(oldMigrations, 'meta/_journal.json'))
    rmdirSync(join(oldMigrations, 'meta')); rmdirSync(oldMigrations); rmdirSync(dir)
  })
  it('migrates, enforces foreign keys, and indexes planner filters', () => {
    const db = database()
    expect(db.sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    expect(db.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
    const indexes = db.sqlite.pragma('index_list(tasks)') as { name: string }[]
    expect(indexes.map((i) => i.name)).toEqual(
      expect.arrayContaining([
        'tasks_scheduled_date_idx',
        'tasks_status_idx',
        'tasks_project_id_idx'
      ])
    )
    expect(() =>
      db.sqlite
        .prepare(
          "INSERT INTO tasks(id,title,status,created_at,updated_at) VALUES ('bad','x','planned','now','now')"
        )
        .run()
    ).toThrow()
  })
  it('persists every task field and appearance across connection restarts and repeated migrations', () => {
    const dir = mkdtempSync(join(tmpdir(), 'workbench-test-'))
    const path = join(dir, 'workbench.sqlite')
    const first = database(path)
    const project = first.projects.create({
      name: 'Thesis',
      description: 'Research',
      colorKey: 'sage'
    })
    const task = first.tasks.create({ title: 'Read HSI papers', projectId: project.id })
    const updated = first.tasks.update(task.id, {
      description: '研究笔记\nReview assumptions.',
      scheduledDate: '2026-09-12',
      startTime: '09:17',
      endTime: '10:43',
      dueDate: '2026-09-15',
      estimatedMinutes: 90,
      priority: 'high'
    })
    first.settings.setAppearance('dark')
    first.close()
    const second = database(path)
    expect(second.tasks.get(task.id)).toEqual(updated)
    expect(second.tasks.get(task.id).scheduledDate).toBe('2026-09-12')
    expect(second.tasks.get(task.id).startTime).toBe('09:17')
    expect(second.settings.getAppearance()).toBe('dark')
    expect(second.projects.list()).toHaveLength(1)
    second.close()
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true })
    rmdirSync(dir)
  })
  it('derives status from scheduling, clears times on unschedule, and restores completion correctly', () => {
    const { tasks, projectId } = projectTaskDatabase()
    const task = tasks.create({ title: 'Experiment', projectId })
    expect(task.status).toBe('inbox')
    expect(
      tasks.update(task.id, { scheduledDate: '2026-09-05', startTime: '23:00', endTime: '23:59' })
        .status
    ).toBe('planned')
    const done = tasks.complete(task.id, true)
    expect(done.completedAt).toBeTruthy()
    expect(tasks.complete(task.id, true).completedAt).toBe(done.completedAt)
    expect(tasks.complete(task.id, false).status).toBe('planned')
    tasks.complete(task.id, true)
    expect(tasks.update(task.id, { scheduledDate: null }).status).toBe('completed')
    const restored = tasks.complete(task.id, false)
    expect(restored).toMatchObject({
      status: 'inbox',
      scheduledDate: null,
      startTime: null,
      endTime: null,
      completedAt: null
    })
  })
  it('rejects invalid scheduling without changing the stored record', () => {
    const { tasks, projectId } = projectTaskDatabase()
    const task = tasks.create({ title: 'Read', projectId })
    expect(() => tasks.update(task.id, { startTime: '10:00' })).toThrow('请先选择计划日期')
    tasks.update(task.id, { scheduledDate: '2026-09-05', startTime: '10:00', endTime: '11:00' })
    expect(() => tasks.update(task.id, { endTime: '09:00' })).toThrow('结束时间')
    expect(tasks.get(task.id).endTime).toBe('11:00')
    expect(() => tasks.get('missing')).toThrow('已不存在')
    expect(() => tasks.delete('missing')).toThrow('已不存在')
  })
  it('keeps tasks on project archive/deletion and rejects new assignment to an archive', () => {
    const { tasks, projects, sqlite } = database()
    const project = projects.create({ name: 'CFSSR-Net', description: '', colorKey: 'blue' })
    const task = tasks.create({ title: 'Ablation', projectId: project.id })
    projects.update(project.id, { archived: true, name: 'CFSSR-Net revised' })
    expect(tasks.get(task.id).projectId).toBe(project.id)
    expect(() => tasks.create({ title: 'New work', projectId: project.id })).toThrow(
      '请先恢复此项目'
    )
    tasks.update(task.id, { description: 'Still editable' })
    projects.update(project.id, { archived: false })
    expect(projects.get(project.id).archivedAt).toBeNull()
    expect(() => projects.delete(project.id)).toThrow('项目中还有计划')
    const destination = projects.create({ name: 'Research', description: '', colorKey: 'sage' })
    projects.delete(project.id, destination.id)
    expect(tasks.get(task.id).projectId).toBe(destination.id)
    expect(tasks.get(task.id).description).toBe('Still editable')
    expect(sqlite.pragma('foreign_key_check')).toEqual([])
  })
  it('reorders only the requested subset and rolls back a missing task', () => {
    const { tasks, projectId } = projectTaskDatabase()
    const a = tasks.create({ title: 'A', projectId }),
      b = tasks.create({ title: 'B', projectId }),
      c = tasks.create({ title: 'C', projectId })
    expect(tasks.reorder([c.id, a.id]).map((t) => t.title)).toEqual(['C', 'B', 'A'])
    expect(tasks.get(b.id).order).toBe(1)
    expect(() => tasks.reorder([a.id, 'missing'])).toThrow()
    expect(tasks.list().map((t) => t.title)).toEqual(['C', 'B', 'A'])
  })
  it('validates real calendar dates, strict IPC fields, and nonempty capture', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-04-31')).toBe(false)
    expect(taskCreateSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(taskCreateSchema.parse({ title: '  Test  ' }).title).toBe('Test')
    expect(taskPatchSchema.safeParse({ status: 'completed' }).success).toBe(false)
    expect(taskPatchSchema.safeParse({ startTime: '24:00' }).success).toBe(false)
    expect(taskPatchSchema.safeParse({ estimatedMinutes: -1 }).success).toBe(false)
  })
  it('requires a project for every new plan and refuses orphaning or transfer to an archive', () => {
    const { tasks, projects, projectId } = projectTaskDatabase()
    expect(() => tasks.create({ title: 'No project' })).toThrow('所属项目')
    const task = tasks.create({ title: 'Plan', projectId })
    expect(() => tasks.update(task.id, { projectId: null })).toThrow('所属项目')
    expect(() => projects.delete(projectId, projectId)).toThrow('另一个未归档项目')
    const archive = projects.create({ name: 'Archive', description: '', colorKey: 'sage' })
    projects.update(archive.id, { archived: true })
    expect(() => projects.delete(projectId, archive.id)).toThrow('另一个未归档项目')
    expect(tasks.get(task.id).projectId).toBe(projectId)
    expect(projects.get(projectId)).toBeTruthy()
  })
})
