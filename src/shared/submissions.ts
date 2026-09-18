import type { Submission } from './types'

export function daysUntil(date: string, today: string) {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000)
}
export function revisionReminder(submission: Submission, today: string) {
  if (!submission.revisionDueDate || !submission.reminderEnabled) return null
  const days = daysUntil(submission.revisionDueDate, today)
  if (days > submission.reminderDays) return null
  return { days, label: days < 0 ? `返修已逾期 ${-days} 天` : days === 0 ? '返修今天截止' : `返修还有 ${days} 天截止` }
}
