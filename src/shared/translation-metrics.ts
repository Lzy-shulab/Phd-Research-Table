export interface TranslationRateWindow {
  startedAt: number
  completedAtStart: number
  unit: '段' | '项'
}

export function estimateTranslationMetrics(progress: {
  current: number | null
  total: number | null
  rateWindow?: TranslationRateWindow
}, now: number) {
  const window = progress.rateWindow
  if (!window || progress.current === null || !progress.total) return null
  const elapsed = (now - window.startedAt) / 1000
  const completed = progress.current - window.completedAtStart
  if (elapsed < 5 || completed <= 0) return null
  const perMinute = completed / elapsed * 60
  return { perMinute, remainingSeconds: Math.max(0, progress.total - progress.current) / (perMinute / 60), unit: window.unit }
}

export function formatTranslationRemaining(seconds: number) {
  const rounded = Math.max(0, Math.ceil(seconds / 10) * 10)
  if (rounded < 10) return '即将完成'
  if (rounded < 60) return `约 ${rounded} 秒`
  if (rounded >= 3600) {
    const minutes = Math.ceil(rounded / 60)
    return `约 ${Math.floor(minutes / 60)} 小时${minutes % 60 ? ` ${minutes % 60} 分` : ''}`
  }
  return `约 ${Math.floor(rounded / 60)} 分${rounded % 60 ? ` ${rounded % 60} 秒` : ''}`
}
