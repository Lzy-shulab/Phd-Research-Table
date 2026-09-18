import { z } from 'zod'
import { colorKeys, priorities } from '../shared/types'
import { DomainError } from './errors'
import type { Task } from '../shared/types'

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const [y = 0, m = 0, d = 0] = value.split('-').map(Number)
  const date = new Date(y, m - 1, d)
  return y >= 1000 && date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d
}
// Bibliographic sources may identify only a year or month; preserve that precision.
export function isPublicationDate(value: string): boolean {
  if (/^\d{4}$/.test(value)) return Number(value) >= 1000
  if (/^\d{4}-\d{2}$/.test(value)) return Number(value.slice(0, 4)) >= 1000 && Number(value.slice(5)) >= 1 && Number(value.slice(5)) <= 12
  return isCalendarDate(value)
}
z.config(z.locales.zhCN())

const calendarDate = z.string().refine(isCalendarDate, '请输入有效日期。').nullable()
const localTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, '请输入有效的24小时制时间（HH:mm）。')
  .nullable()
export const idSchema = z.string().uuid()
const title = z
  .string()
  .trim()
  .min(1, '请填写标题。')
  .max(500, '标题不能超过500个字符。')
const taskFields = {
  title,
  description: z.string().max(50000),
  projectId: idSchema.nullable(),
  priority: z.enum(priorities),
  dueDate: calendarDate,
  scheduledDate: calendarDate,
  startTime: localTime,
  endTime: localTime,
  estimatedMinutes: z.number().int().min(1).max(100000).nullable()
}
export const taskCreateSchema = z
  .object({
    title,
    projectId: taskFields.projectId.optional(),
    scheduledDate: calendarDate.optional(),
    startTime: localTime.optional(),
    endTime: localTime.optional()
  })
  .strict()
export const taskPatchSchema = z.object(taskFields).partial().strict()
export const projectCreateSchema = z
  .object({
    name: z.string().trim().min(1, '请填写项目名称。').max(100),
    description: z.string().max(10000),
    colorKey: z.enum(colorKeys)
  })
  .strict()
export const projectPatchSchema = projectCreateSchema
  .partial()
  .extend({ archived: z.boolean().optional() })
  .strict()
export const appearanceSchema = z.enum(['system', 'light', 'dark'])
export const reorderSchema = z
  .array(idSchema)
  .max(10000)
  .refine((ids) => new Set(ids).size === ids.length, '每个任务只能出现一次。')
export const windowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(1100),
  height: z.number().int().min(700),
  maximized: z.boolean()
})

export function validateSchedule(
  task: Pick<Task, 'scheduledDate' | 'startTime' | 'endTime'>
): void {
  if ((task.startTime || task.endTime) && !task.scheduledDate)
    throw new DomainError('VALIDATION', '请先选择计划日期，再设置时间。')
  if (task.endTime && !task.startTime)
    throw new DomainError('VALIDATION', '请先设置开始时间。')
  if (task.startTime && task.endTime && task.endTime <= task.startTime)
    throw new DomainError('VALIDATION', '结束时间需要晚于开始时间。')
}
