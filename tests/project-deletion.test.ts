import { afterEach, describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { SubmissionRepository } from '../src/main/database/repositories/submissions'

const connections: DatabaseConnection[] = []
function setup() {
  const connection = openDatabase(':memory:', resolve('src/main/database/migrations'))
  connections.push(connection)
  const projects = new ProjectRepository(connection.db), tasks = new TaskRepository(connection.db)
  const source = projects.create({ name: '待删除项目', description: '', colorKey: 'sage' })
  const destination = projects.create({ name: '保留项目', description: '', colorKey: 'blue' })
  const first = tasks.create({ title: '未完成任务', projectId: source.id, scheduledDate: '2026-09-29', startTime: '09:00', endTime: '10:30', description: '任务内容' })
  const done = tasks.create({ title: '已完成任务', projectId: source.id }); tasks.complete(done.id, true)
  const other = tasks.create({ title: '其他项目任务', projectId: destination.id })
  return { connection, projects, tasks, source, destination, first, done, other }
}
afterEach(() => { for (const connection of connections.splice(0)) connection.close() })
describe('Explicit project deletion choices', () => {
  it('deletes only the selected project and its tasks while keeping linked submissions', () => {
    const { connection, projects, tasks, source, destination, other } = setup()
    const submissions = new SubmissionRepository(connection.db)
    const submission = submissions.create({ title: '保留稿件', journal: 'Test', manuscriptId: '', stages: [], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '', projectId: source.id })
    projects.delete(source.id, undefined, 'delete')
    expect(tasks.list()).toEqual([other]); expect(projects.list()).toEqual([destination])
    expect(submissions.list().find(item => item.id === submission.id)?.projectId).toBeNull()
    expect(connection.sqlite.pragma('foreign_key_check')).toEqual([])
  })
  it('retains tasks as unassigned with dates, completion and content intact', () => {
    const { projects, tasks, source, first, done, other } = setup()
    const completed = tasks.get(done.id)
    const before = tasks.get(first.id)
    projects.delete(source.id, undefined, 'retain')
    expect(tasks.list()).toHaveLength(3)
    expect(tasks.get(first.id)).toMatchObject({ ...before, projectId: null, updatedAt: expect.any(String) })
    expect(tasks.get(done.id)).toMatchObject({ ...completed, projectId: null, updatedAt: expect.any(String) })
    expect(tasks.get(other.id)).toEqual(other)
  })
  it('requires an explicit action, validates transfer destinations before writing, and transfers all tasks', () => {
    const { projects, tasks, source, destination, first, done } = setup()
    const before = tasks.list()
    expect(() => projects.delete(source.id)).toThrow('明确选择')
    expect(() => projects.delete(source.id, source.id, 'transfer')).toThrow('另一个')
    expect(() => projects.delete(source.id, undefined, 'transfer')).toThrow('接收')
    expect(tasks.list()).toEqual(before)
    projects.delete(source.id, destination.id, 'transfer')
    expect(tasks.get(first.id).projectId).toBe(destination.id)
    expect(tasks.get(done.id).status).toBe('completed')
    expect(projects.list()).toEqual([destination])
  })
})
