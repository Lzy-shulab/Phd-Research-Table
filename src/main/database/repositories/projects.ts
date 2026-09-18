import { randomUUID } from 'node:crypto'
import { asc, eq } from 'drizzle-orm'
import { projects, tasks } from '../schema'
import type { WorkbenchDatabase } from '../db'
import type { Project, ProjectInput, ProjectPatch } from '../../../shared/types'
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
  delete(id: string, moveToId?: string): void {
    this.get(id)
    if (moveToId) {
      const destination = this.get(moveToId)
      if (destination.id === id || destination.archivedAt)
        throw new DomainError('VALIDATION', '请选择另一个未归档项目接收计划。')
    }
    if (!moveToId && this.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.projectId, id)).get())
      throw new DomainError('VALIDATION', '项目中还有计划，请先将计划转移到其他项目，或使用归档保留它们。')
    this.db.transaction((tx) => {
      tx.update(tasks)
        .set({ projectId: moveToId ?? null, updatedAt: new Date().toISOString() })
        .where(eq(tasks.projectId, id))
        .run()
      tx.delete(projects).where(eq(projects.id, id)).run()
    })
  }
}
