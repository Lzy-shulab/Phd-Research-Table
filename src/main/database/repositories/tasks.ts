import { randomUUID } from 'node:crypto'
import { eq, asc, sql } from 'drizzle-orm'
import { projects, tasks } from '../schema'
import type { WorkbenchDatabase } from '../db'
import type { Task, TaskCreate, TaskPatch, TaskSeriesInput } from '../../../shared/types'
import { DomainError } from '../../../domain/errors'
import { validateSchedule } from '../../../domain/validation'

export class TaskRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  list(): Task[] {
    return this.db.select().from(tasks).orderBy(asc(tasks.order), asc(tasks.createdAt)).all()
  }
  get(id: string): Task {
    const task = this.db.select().from(tasks).where(eq(tasks.id, id)).get()
    if (!task) throw new DomainError('NOT_FOUND', '此任务已不存在。')
    return task
  }
  private checkProject(id: string | null): void {
    if (!id) throw new DomainError('VALIDATION', '请为研究计划选择所属项目。')
    const project = this.db.select().from(projects).where(eq(projects.id, id)).get()
    if (!project) throw new DomainError('NOT_FOUND', '此项目已不存在。')
    if (project.archivedAt)
      throw new DomainError('VALIDATION', '请先恢复此项目，再添加任务。')
  }
  create(input: TaskCreate): Task {
    const now = new Date().toISOString()
    this.checkProject(input.projectId ?? null)
    const task: Task = {
      id: randomUUID(),
      title: input.title,
      description: '',
      status: input.scheduledDate ? 'planned' : 'inbox',
      projectId: input.projectId ?? null,
      priority: 'none',
      dueDate: null,
      scheduledDate: input.scheduledDate ?? null,
      startTime: input.startTime ?? null,
      endTime: input.endTime ?? null,
      estimatedMinutes: null,
      deferredUntil: null,
      seriesId: null,
      recurrence: null,
      occurrenceDate: null,
      checklist: input.checklist ?? [],
      milestone: input.milestone ?? '',
      linkedPaperId: input.linkedPaperId ?? null,
      linkedSubmissionId: input.linkedSubmissionId ?? null,
      sourceType: input.sourceType ?? 'manual',
      sourceId: input.sourceId ?? null,
      order: 0,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    }
    task.description = input.description ?? ''
    task.priority = input.priority ?? 'none'
    task.dueDate = input.dueDate ?? null
    task.estimatedMinutes = input.estimatedMinutes ?? null
    validateSchedule(task)
    this.db.transaction((tx) => {
      tx.update(tasks).set({ order: sql<number>`${tasks.order} + 1` }).run()
      tx.insert(tasks).values(task).run()
    })
    return task
  }
  createSeries(input: TaskSeriesInput): Task[] {
    if (!input.scheduledDate) throw new DomainError('VALIDATION', '重复任务需要先选择首次计划日期。')
    const seriesId = randomUUID()
    const base = new Date(`${input.scheduledDate}T12:00:00`)
    return this.db.transaction(() => Array.from({ length: input.occurrences }, (_, index) => {
      const date = new Date(base)
      date.setDate(base.getDate() + index * 7)
      const scheduledDate = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
      const task = this.create({ ...input, scheduledDate })
      const next = { ...task, seriesId, recurrence: input.recurrence, occurrenceDate: scheduledDate }
      this.db.update(tasks).set(next).where(eq(tasks.id, task.id)).run()
      return next
    }))
  }
  updateSeries(seriesId: string, fromDate: string, patch: TaskPatch): Task[] {
    const targets = this.list().filter((task) => task.seriesId === seriesId && (task.occurrenceDate ?? '') >= fromDate)
    if (!targets.length) throw new DomainError('NOT_FOUND', '没有可更新的后续重复安排。')
    return targets.map((task) => this.update(task.id, patch))
  }
  update(id: string, patch: TaskPatch): Task {
    const current = this.get(id)
    if (patch.projectId !== undefined && patch.projectId !== current.projectId)
      this.checkProject(patch.projectId)
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() }
    if (patch.scheduledDate === null) {
      next.startTime = null
      next.endTime = null
    }
    if (patch.startTime === null) next.endTime = null
    if (next.status !== 'completed') next.status = next.scheduledDate ? 'planned' : 'inbox'
    validateSchedule(next)
    this.db.update(tasks).set(next).where(eq(tasks.id, id)).run()
    return next
  }
  complete(id: string, completed: boolean): Task {
    const task = this.get(id)
    const now = new Date().toISOString()
    const next: Task = {
      ...task,
      status: completed ? 'completed' : task.scheduledDate ? 'planned' : 'inbox',
      completedAt: completed ? (task.completedAt ?? now) : null,
      updatedAt: now
    }
    this.db.update(tasks).set(next).where(eq(tasks.id, id)).run()
    return next
  }
  delete(id: string): void {
    this.get(id)
    this.db.delete(tasks).where(eq(tasks.id, id)).run()
  }
  reorder(ids: string[]): Task[] {
    // Reuse the visible subset's existing slots so other views keep their relative order.
    this.db.transaction((tx) => {
      const slots = ids.map((id) => this.get(id).order).sort((a, b) => a - b)
      const now = new Date().toISOString()
      ids.forEach((id, i) =>
        tx.update(tasks).set({ order: slots[i]!, updatedAt: now }).where(eq(tasks.id, id)).run()
      )
    })
    return this.list()
  }
}
