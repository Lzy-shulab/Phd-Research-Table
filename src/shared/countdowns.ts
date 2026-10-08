export interface ImportantCountdown {
  id: string
  title: string
  deadline: string
  createdAt: string
}
export type CountdownInput = Pick<ImportantCountdown, 'title' | 'deadline'>
export function countdownTime(item: ImportantCountdown, now: Date) {
  const remaining = new Date(item.deadline).getTime() - now.getTime()
  const minutes = Math.max(0, Math.ceil(remaining / 60_000))
  const duration = new Date(item.deadline).getTime() - new Date(item.createdAt).getTime()
  return { days: Math.floor(minutes / 1440), hours: Math.floor(minutes % 1440 / 60), minutes: minutes % 60,
    expired: remaining <= 0, ratio: duration > 0 ? Math.max(0, Math.min(1, remaining / duration)) : 0 }
}
