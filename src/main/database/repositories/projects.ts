import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { projects, tasks, submissions } from '../schema'
import type { WorkbenchDatabase } from '../db'
import type { Project, ProjectInput, ProjectPatch, ProjectTaskAction } from '../../../shared/types'
import { DomainError } from '../../../domain/errors'

export class ProjectRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  list(): Project[] {
    return this.db.select().from(projects).orderBy(asc(projects.createdAt)).all()
  }
  get(id: string): Project {
    const project = this.db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) throw new DomainError('NOT_FOUND', '此项目已不存在。')
    return project
  }
  create(input: ProjectInput): Project {
    const now = new Date().toISOString()
    const project = { ...input, id: randomUUID(), createdAt: now, updatedAt: now, archivedAt: null }
    this.db.insert(projects).values(project).run()
    return project
  }
  update(id: string, patch: ProjectPatch): Project {
    const { archived, ...fields } = patch
    const current = this.get(id)
    const now = new Date().toISOString()
    const next = {
      ...current,
      ...fields,
      updatedAt: now,
      archivedAt: archived === undefined ? current.archivedAt : archived ? now : null
    }
    this.db.update(projects).set(next).where(eq(projects.id, id)).run()
    return next
  }
  delete(id: string, moveToId?: string, taskAction?: ProjectTaskAction): void {
    this.get(id)
    const action = taskAction ?? (moveToId ? 'transfer' : undefined)
    if (action === 'transfer') {
      if (!moveToId) throw new DomainError('VALIDATION', '请选择接收任务的项目。')
      const destination = this.get(moveToId)
      if (destination.id === id || destination.archivedAt)
        throw new DomainError('VALIDATION', '请选择另一个未归档项目接收计划。')
    }
    if (!action && this.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id)).get())
      throw new DomainError('VALIDATION', '项目中还有任务，请明确选择删除、保留或转移任务。')
    this.db.transaction((tx) => {
      if (action === 'delete') tx.delete(tasks).where(eq(tasks.projectId, id)).run()
      else tx.update(tasks)
          .set({ projectId: action === 'transfer' ? moveToId : null, updatedAt: new Date().toISOString() })
          .where(eq(tasks.projectId, id)).run()
      // Older databases use a restrictive foreign key here. Keep manuscript history intact.
      tx.update(submissions).set({ projectId: null }).where(eq(submissions.projectId, id)).run()
      tx.delete(projects).where(eq(projects.id, id)).run()
    })
  }
}
