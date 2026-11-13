import { describe, expect, it } from 'vitest'
import { TranslationRateTracker } from '../src/main/library/translation-rate'
import { estimateTranslationMetrics, formatTranslationRemaining } from '../src/shared/translation-metrics'

const progress = (current: number, stage = '正在翻译正文') => ({ stage, current, total: 100, percent: 50 })
describe('translation speed and remaining time', () => {
  it('uses observed paragraph progress and includes time spent awaiting the next batch', () => {
    const tracker = new TranslationRateTracker()
    tracker.observe('paper', progress(0), 0)
    const rateWindow = tracker.observe('paper', progress(15), 30000)
    expect(estimateTranslationMetrics({ ...progress(15), rateWindow }, 30000)).toMatchObject({ perMinute: 30, remainingSeconds: 170, unit: '段' })
    expect(estimateTranslationMetrics({ ...progress(15), rateWindow }, 60000)).toMatchObject({ perMinute: 15, remainingSeconds: 340 })
  })
  it('starts a fresh estimate for each phase and document', () => {
    const tracker = new TranslationRateTracker()
    tracker.observe('paper', progress(0), 0)
    tracker.observe('paper', progress(30), 30000)
    const phase = tracker.observe('paper', progress(1, '正在排版译文'), 31000)
    expect(estimateTranslationMetrics({ ...progress(1), rateWindow: phase }, 32000)).toBeNull()
    const other = tracker.observe('next', progress(0), 60000)
    expect(estimateTranslationMetrics({ ...progress(0), rateWindow: other }, 90000)).toBeNull()
  })
  it('does not invent a speed before enough progress is observed', () => {
    expect(estimateTranslationMetrics(progress(0), 10000)).toBeNull()
    expect(estimateTranslationMetrics({ ...progress(1), rateWindow: { startedAt: 0, completedAtStart: 0, unit: '段' } }, 2000)).toBeNull()
    expect(formatTranslationRemaining(170)).toBe('约 2 分 50 秒')
  })
})
