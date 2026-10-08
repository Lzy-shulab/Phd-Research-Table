import { useState } from 'react'
import { localDay } from '../../shared/arxiv'
import { selectionRange, type ReportSelection } from '../../domain/reports'

export function useReportPeriod() {
  const [selection, setSelection] = useState<ReportSelection>(() => {
    const now = new Date()
    return { period: 'month', month: localDay(now).slice(0, 7), week: Math.floor((now.getDate() - 1) / 7) }
  })
  return { selection, setSelection, range: selectionRange(selection) }
}
