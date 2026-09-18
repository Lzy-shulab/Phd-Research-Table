import { randomUUID } from 'node:crypto'
import { asc, desc, eq, sql } from 'drizzle-orm'
import { submissions, submissionStages } from '../schema'
import type { WorkbenchDatabase } from '../db'
import type { Submission, SubmissionInput, SubmissionStage } from '../../../shared/types'
import { DomainError } from '../../../domain/errors'
import { submissionSchema } from '../../../domain/submissions'

export class SubmissionRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  private stages(id?: string): SubmissionStage[] {
    const query = this.db.select().from(submissionStages)
    return (id ? query.where(eq(submissionStages.submissionId, id)) : query)
      .orderBy(asc(submissionStages.position), asc(submissionStages.occurredOn)).all()
  }
  private hydrate(row: typeof submissions.$inferSelect, stages: SubmissionStage[]): Submission {
    const own = stages.filter((stage) => stage.submissionId === row.id)
    return {
      id: row.id, title: row.title, journal: row.journal, manuscriptId: row.manuscriptId,
      stages: own, submittedDate: own[0]?.occurredOn ?? null, currentStage: own.at(-1)?.name ?? '',
      revisionDueDate: row.revisionDueDate, reminderEnabled: row.reminderEnabled,
      reminderDays: row.reminderDays, notes: row.notes, createdAt: row.createdAt, updatedAt: row.updatedAt
    }
  }
  list() {
    const stages = this.stages()
    return this.db.select().from(submissions).orderBy(desc(submissions.updatedAt)).all()
      .map((row) => this.hydrate(row, stages))
  }
  get(id: string) {
    const row = this.db.select().from(submissions).where(eq(submissions.id, id)).get()
    if (!row) throw new DomainError('NOT_FOUND', '此投稿记录已不存在。')
    return this.hydrate(row, this.stages(id))
  }
  create(input: SubmissionInput): Submission {
    const parsed = submissionSchema.parse(input)
    const now = new Date().toISOString()
    const id = randomUUID()
    const { stages, ...details } = parsed
    const submission = {
      ...details, id, submittedDate: stages[0]?.occurredOn ?? null,
      status: stages.length ? 'submitted' as const : 'draft' as const, createdAt: now, updatedAt: now
    }
    this.db.transaction((tx) => {
      tx.insert(submissions).values(submission).run()
      if (stages.length) tx.insert(submissionStages).values(stages.map((stage, position) => ({
        ...stage, id: stage.id ?? randomUUID(), submissionId: id, position, createdAt: now, updatedAt: now
      }))).run()
    })
    return this.get(id)
  }
  update(id: string, input: SubmissionInput) {
    const row = this.db.select().from(submissions).where(eq(submissions.id, id)).get()
    if (!row) throw new DomainError('NOT_FOUND', '此投稿记录已不存在。')
    const currentStages = this.stages(id), parsed = submissionSchema.parse(input)
    const foreignId = parsed.stages.find((stage) => stage.id && !currentStages.some((current) => current.id === stage.id))?.id
    if (foreignId) throw new DomainError('VALIDATION', '投稿状态记录不属于当前投稿。')
    const now = new Date(Math.max(Date.now(), Date.parse(row.updatedAt) + 1)).toISOString()
    const { stages, ...details } = parsed
    const retained = new Set(stages.flatMap((stage) => stage.id ? [stage.id] : []))
    this.db.transaction((tx) => {
      tx.update(submissions).set({ ...details, submittedDate: stages[0]?.occurredOn ?? null, updatedAt: now }).where(eq(submissions.id, id)).run()
      // Move existing positions out of the target range before applying a reorder.
      tx.update(submissionStages).set({ position: sql`${submissionStages.position} + 1000` })
        .where(eq(submissionStages.submissionId, id)).run()
      for (const stage of currentStages) if (!retained.has(stage.id))
        tx.delete(submissionStages).where(eq(submissionStages.id, stage.id)).run()
      for (const [position, stage] of stages.entries()) {
        if (stage.id) tx.update(submissionStages).set({ name: stage.name, occurredOn: stage.occurredOn, position, updatedAt: now })
          .where(eq(submissionStages.id, stage.id)).run()
        else tx.insert(submissionStages).values({ id: randomUUID(), submissionId: id, name: stage.name,
          occurredOn: stage.occurredOn, position, createdAt: now, updatedAt: now }).run()
      }
    })
    return this.get(id)
  }
  delete(id: string) { this.get(id); this.db.delete(submissions).where(eq(submissions.id, id)).run() }
}
