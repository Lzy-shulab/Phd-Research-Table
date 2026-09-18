import { describe, expect, it } from 'vitest'
import type { Submission } from '../src/shared/types'
import { submissionSchema } from '../src/domain/submissions'
import { daysUntil, revisionReminder } from '../src/shared/submissions'

const input = {
  title: 'Paper', journal: 'Journal', manuscriptId: '',
  stages: [{ name: 'Submitted to Journal', occurredOn: '2026-08-28' }, { name: 'With editor', occurredOn: '2026-09-10' }],
  revisionDueDate: null, reminderEnabled: true, reminderDays: 3, notes: ''
}
const submission: Submission = {
  ...input, id: 'submission', currentStage: 'With editor', submittedDate: '2026-08-28',
  stages: input.stages.map((stage, position) => ({ ...stage, id: `stage-${position}`, submissionId: 'submission', position, createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-09-10T10:00:00Z' })),
  createdAt: '2026-09-10T10:00:00Z', updatedAt: '2026-09-10T10:00:00Z'
}

describe('User-defined submission stages', () => {
  it('keeps journal-specific names and explicit dates in the entered order', () => {
    expect(submissionSchema.parse(input).stages).toEqual(input.stages)
    expect(submission.currentStage).toBe('With editor')
    expect(submission.submittedDate).toBe('2026-08-28')
  })
  it('allows a record with no status but rejects blank, invalid, or reverse-ordered stages', () => {
    expect(submissionSchema.safeParse({ ...input, stages: [] }).success).toBe(true)
    expect(submissionSchema.safeParse({ ...input, stages: [{ name: '', occurredOn: '2026-08-28' }] }).success).toBe(false)
    expect(submissionSchema.safeParse({ ...input, stages: [{ name: 'Submitted', occurredOn: '2026-02-30' }] }).success).toBe(false)
    expect(submissionSchema.safeParse({ ...input, stages: [...input.stages].reverse() }).success).toBe(false)
  })
  it('uses calendar dates for deadline reminders independently of a fixed status vocabulary', () => {
    const revision = { ...submission, revisionDueDate: '2027-01-02' }
    expect(daysUntil('2027-01-02', '2026-12-30')).toBe(3)
    expect(revisionReminder(revision, '2026-12-30')?.days).toBe(3)
    expect(revisionReminder(revision, '2027-01-03')?.label).toContain('逾期 1 天')
    expect(revisionReminder({ ...revision, currentStage: 'Accepted', reminderEnabled: false }, '2027-01-03')).toBeNull()
  })
})
