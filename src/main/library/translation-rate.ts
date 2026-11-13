import type { EngineProgress } from './translation-progress'
import type { TranslationRateWindow } from '../../shared/translation-metrics'

export class TranslationRateTracker {
  private key = ''
  private samples: { at: number; current: number }[] = []
  observe(paperId: string, progress: EngineProgress, now: number): TranslationRateWindow | undefined {
    if (progress.current === null || !progress.total) return undefined
    const key = `${paperId}:${progress.stage}:${progress.total}`
    const previous = this.samples.at(-1)
    if (key !== this.key || previous && progress.current < previous.current) { this.key = key; this.samples = [] }
    if (!this.samples.length || this.samples.at(-1)!.current !== progress.current)
      this.samples.push({ at: now, current: progress.current })
    while (this.samples.length > 1 && this.samples[1]!.at <= now - 60000) this.samples.shift()
    const first = this.samples[0]!
    return { startedAt: first.at, completedAtStart: first.current, unit: progress.stage === '正在翻译正文' ? '段' : '项' }
  }
}
