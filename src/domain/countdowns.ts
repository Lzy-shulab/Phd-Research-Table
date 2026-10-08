import { z } from 'zod'
export const countdownInputSchema = z.object({
  title: z.string().trim().min(1, '请填写倒计时名称。').max(120, '名称最多 120 个字符。'),
  deadline: z.iso.datetime({ offset: true, message: '请填写有效的截止时间。' })
}).strict()
export const countdownSchema = countdownInputSchema.extend({ id: z.string().uuid(), createdAt: z.iso.datetime({ offset: true }) })
export const countdownListSchema = z.array(countdownSchema).max(12)
