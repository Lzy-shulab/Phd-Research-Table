import { z } from 'zod'
import { isCalendarDate } from './validation'

const date = z.string().refine(isCalendarDate, '请填写有效日期。').nullable()
const stage = z.object({
  id: z.uuid().optional(),
  name: z.string().trim().min(1, '请填写状态名称。').max(160, '状态名称不能超过 160 个字符。'),
  occurredOn: z.string().refine(isCalendarDate, '请填写有效的状态日期。')
}).strict()
export const submissionSchema = z.object({
  title: z.string().trim().min(1, '请填写论文标题。').max(1000),
  journal: z.string().trim().min(1, '请填写投稿期刊或会议。').max(500),
  manuscriptId: z.string().trim().max(200),
  stages: z.array(stage).max(30, '每条投稿记录最多保存 30 个状态。'),
  revisionDueDate: date,
  reminderEnabled: z.boolean(),
  reminderDays: z.number().int().min(0).max(30),
  notes: z.string().max(50000)
}).strict().superRefine((input, context) => {
  const ids = input.stages.flatMap((item) => item.id ? [item.id] : [])
  if (new Set(ids).size !== ids.length)
    context.addIssue({ code: 'custom', path: ['stages'], message: '投稿状态记录不能重复。' })
  for (let index = 1; index < input.stages.length; index += 1) {
    if (input.stages[index]!.occurredOn < input.stages[index - 1]!.occurredOn)
      context.addIssue({ code: 'custom', path: ['stages', index, 'occurredOn'], message: '状态日期需按先后顺序填写。' })
  }
  const submittedDate = input.stages[0]?.occurredOn
  if (submittedDate && input.revisionDueDate && input.revisionDueDate < submittedDate)
    context.addIssue({ code: 'custom', path: ['revisionDueDate'], message: '返修截止日期不能早于投稿日期。' })
})
