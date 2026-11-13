export interface CodexQuotaWindow {
  label: string
  durationMinutes: number | null
  remainingPercent: number | null
  resetsAt: number | null
}

export interface CodexUsageSnapshot {
  windows: CodexQuotaWindow[]
  availableResetCredits: number | null
  resetExpirations: (number | null)[] | null
  updatedAt: number | null
  error: string | null
}

export const emptyCodexUsage: CodexUsageSnapshot = {
  windows: [], availableResetCredits: null, resetExpirations: null, updatedAt: null, error: null
}

type JsonObject = Record<string, unknown>
const object = (value: unknown): JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {}
const number = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null
const timestamp = (value: unknown) => { const seconds = number(value); return seconds !== null && seconds > 0 ? seconds * 1000 : null }

export function quotaWindowLabel(minutes: number | null) {
  if (minutes === 10080) return '本周'
  if (minutes && minutes % 1440 === 0) return `${minutes / 1440} 天`
  if (minutes && minutes % 60 === 0) return `${minutes / 60} 小时`
  return minutes ? `${minutes} 分钟` : '额度'
}

export function parseCodexUsage(payload: unknown, now = Date.now()): CodexUsageSnapshot {
  const root = object(payload)
  const buckets = object(root.rateLimitsByLimitId)
  const limits = object(buckets.codex ?? Object.entries(buckets).find(([key]) => key.startsWith('codex'))?.[1] ?? root.rateLimits)
  const windows = ['primary', 'secondary'].flatMap(key => {
    if (!limits[key] || typeof limits[key] !== 'object') return []
    const item = object(limits[key]), used = number(item.usedPercent), duration = number(item.windowDurationMins)
    return [{ label: quotaWindowLabel(duration), durationMinutes: duration,
      remainingPercent: used === null ? null : Math.round(Math.max(0, Math.min(100, 100 - used))), resetsAt: timestamp(item.resetsAt) }]
  }).sort((a, b) => (a.durationMinutes ?? Infinity) - (b.durationMinutes ?? Infinity))
  const summary = object(root.rateLimitResetCredits)
  const count = number(summary.availableCount)
  const resetExpirations = Array.isArray(summary.credits) ? summary.credits
    .map(object).filter(credit => credit.status === 'available')
    .map(credit => timestamp(credit.expiresAt)).sort((a, b) => (a ?? Infinity) - (b ?? Infinity)) : null
  if (!windows.length && count === null) throw new Error('暂无 ChatGPT 额度信息，请确认 Codex 已使用 ChatGPT 账号登录。')
  return { windows, availableResetCredits: count === null ? null : Math.max(0, Math.floor(count)), resetExpirations, updatedAt: now, error: null }
}

export function codexRailSummary(snapshot: CodexUsageSnapshot) {
  if (snapshot.error) return snapshot.updatedAt ? '待更新' : '未连接'
  if (!snapshot.updatedAt) return '读取中'
  return snapshot.windows.map(window => `${window.durationMinutes === 10080 ? '周' : window.durationMinutes === 300 ? '5h' : window.label} ${window.remainingPercent === null ? '—' : window.remainingPercent + '%'}`).join(' / ') || '查看额度'
}
