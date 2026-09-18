import { z } from 'zod'
import { isPublicationDate } from './validation'
import { journalPartitions, publicationHonors } from '../shared/types'

export const publicationFields = {
  title: z.string().trim().min(1, '请填写成果标题。').max(1000),
  authors: z.string().trim().min(1, '请填写作者。').max(2000),
  journal: z.string().trim().min(1, '请填写期刊或会议名称。').max(500),
  publishedDate: z.string().refine(isPublicationDate, '请填写有效的发表年份、月份或日期。'),
  doi: z.string().trim().max(500).transform((value) => value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi:\s*/i, ''))
    .refine((value) => !value || /^10\.\d{4,9}\/\S+$/i.test(value), 'DOI 格式应为 10.xxxx/…，也可留空。'),
  casPartition: z.enum(['', ...journalPartitions]),
  jcrQuartile: z.enum(['', 'Q1', 'Q2', 'Q3', 'Q4', '非SCI']),
  honors: z.array(z.enum(publicationHonors)).max(publicationHonors.length)
    .refine((values) => new Set(values).size === values.length, '同一论文荣誉不能重复。'),
  notes: z.string().max(50000)
}
export const publicationSchema = z.object({ ...publicationFields, honors: publicationFields.honors.default([]) }).strict()
export const arxivSettingsSchema = z.object({
  enabled: z.boolean(),
  daysBack: z.number().int().min(1).max(90),
  maxPerDay: z.number().int().min(1).max(50),
  directions: z.array(z.string().trim().min(2).max(180)
    .regex(/^[\p{L}\p{N}\s.,+\-/]+$/u, '研究关键词只需填写词组，多条件用 AND 连接。')
    .refine((value) => value.split(/\s+AND\s+/i).every((term) => term.trim().length >= 2), 'AND 两侧都需要填写关键词。'))
    .min(1, '请至少填写一个研究方向。').max(30)
}).strict()
