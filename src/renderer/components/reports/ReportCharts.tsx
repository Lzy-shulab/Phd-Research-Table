import { useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { motion, useReducedMotion } from 'motion/react'
import { localDay } from '../../../shared/arxiv'
import { formatDuration } from '../../../domain/reports'
import { calendarDayMark } from '../../../domain/work-calendar'

export function ReportRing({ value, goal, label, unknown = false }: { value: number; goal: number; label: string; unknown?: boolean }) {
  const reduced = useReducedMotion()
  const percent = goal > 0 ? Math.round(value / goal * 1000) / 10 : 0
  return <div className="report-ring" role="img" aria-label={goal ? `${label}，${value} / ${goal}，${percent}%` : `${label}，${unknown ? '节假日资料未收录' : '未设置目标'}`}>
    <svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" /><motion.circle initial={false} animate={{ strokeDasharray: `${Math.min(percent, 100)} 100` }} transition={{ duration: reduced ? 0.08 : 0.3 }} className="ring-value" cx="32" cy="32" r="27" pathLength="100" /></svg>
    <span>{goal ? `${percent}%` : '—'}</span>
  </div>
}
function ChartHover({ label, lines, children, onSelect, selected }: { label: string; lines: string[]; children: ReactNode; onSelect?: () => void; selected?: boolean }) {
  const id = useId(), tooltip = useRef<HTMLDivElement>(null)
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  useLayoutEffect(() => {
    const element = tooltip.current
    if (!element || !anchor) return
    const width = element.offsetWidth, height = element.offsetHeight
    element.style.left = `${Math.max(12, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 12))}px`
    const top = anchor.top - height - 8 >= 12 ? anchor.top - height - 8 : anchor.bottom + 8
    element.style.top = `${Math.max(12, Math.min(top, window.innerHeight - height - 12))}px`
  }, [anchor])
  return <div className="report-hover-anchor" tabIndex={0} role={onSelect ? 'button' : undefined} aria-pressed={onSelect ? selected : undefined} aria-label={`${label}，${lines.join('，')}`} aria-describedby={anchor ? id : undefined}
    onClick={onSelect}
    onPointerEnter={event => setAnchor(event.currentTarget.getBoundingClientRect())} onPointerLeave={() => setAnchor(null)}
    onFocus={event => setAnchor(event.currentTarget.getBoundingClientRect())} onBlur={() => setAnchor(null)}
    onKeyDown={event => { if (event.key === 'Escape') setAnchor(null); if (onSelect && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); onSelect() } }}>
    {children}
    {anchor && createPortal(<div ref={tooltip} id={id} role="tooltip" className="report-tooltip"><strong>{label}</strong>{lines.map((line, i) => <span key={i}>{line}</span>)}</div>, document.body)}
  </div>
}
export function ReportHeatmap({ days, metric, label, today = localDay(), selectedDate, onSelectDate, details, dayMark }: {
  days: { date: string; papers: number; tasks: number; checkinMinutes: number }[]
  metric: 'papers' | 'tasks' | 'checkinMinutes'; label: string; today?: string
  selectedDate?: string; onSelectDate?: (date: string) => void; details?: (date: string) => string[]
  dayMark?: (date: string) => { kind: string; label: string; badge: string } | undefined
}) {
  const max = metric === 'checkinMinutes' ? 720 : Math.max(4, ...days.map(day => day[metric]))
  const offset = days.length > 7 ? (new Date(`${days[0]!.date}T12:00:00`).getDay() + 6) % 7 : 0
  const weekdays = ['一', '二', '三', '四', '五', '六', '日']
  const headers = days.length <= 7 ? days.map(day => weekdays[(new Date(`${day.date}T12:00:00`).getDay() + 6) % 7]) : weekdays
  return <div className="report-heatmap" aria-label={label}>
    <div className="report-heatmap-grid report-heatmap-weekdays" aria-hidden="true">{headers.map((day, i) => <span key={i}>周{day}</span>)}</div>
    <div className="report-heatmap-grid">
      {Array.from({ length: offset }, (_, i) => <span key={`blank-${i}`} />)}
      {days.map(day => {
        const value = day[metric], level = value ? Math.min(4, Math.max(1, Math.ceil(value / max * 4))) : 0
        const future = day.date > today, mark = dayMark?.(day.date) ?? calendarDayMark(day.date)
        const amount = metric === 'checkinMinutes' ? formatDuration(value) : `${value} ${metric === 'papers' ? '篇' : '项'}`
        const lines = metric === 'checkinMinutes' ? [`打卡：${amount}`]
          : [`读完论文：${day.papers} 篇`, `完成任务：${day.tasks} 项`]
        return <ChartHover key={day.date} label={day.date} selected={selectedDate === day.date} onSelect={onSelectDate ? () => onSelectDate(day.date) : undefined} lines={[mark.label, ...(future && !value ? ['尚未到达的日期'] : lines), ...(details?.(day.date) ?? [])]}>
          <div className={`report-heat-cell heat-level-${level}${future && !value ? ' is-future' : ''}${day.date === today ? ' is-today' : ''}${selectedDate === day.date ? ' is-selected' : ''}`} data-date={day.date} data-value={value}>
            <span>{Number(day.date.slice(-2))}</span>
            {mark.badge && <span className={`report-day-badge is-${mark.kind}`} aria-hidden="true">{mark.badge}</span>}
            {value > 0 && <small>{metric === 'checkinMinutes' ? `${(value / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 })}h` : value}</small>}
          </div>
        </ChartHover>
      })}
    </div>
    <div className="report-heatmap-legend"><span>{metric === 'checkinMinutes' ? '每日研究时长' : label}</span><span>少</span>{[0, 1, 2, 3, 4].map(level => <i key={level} className={`heat-level-${level}`} />)}<span>多</span></div>
  </div>
}
export function ReportBars({ buckets, series, format = String }: {
  buckets: { label: string; title: string; values: number[]; details?: string[] }[]
  series: string[]; format?: (value: number) => string
}) {
  const reduced = useReducedMotion()
  const max = Math.max(1, ...buckets.flatMap(bucket => bucket.values))
  const scale = max > 10 ? Math.ceil(max / 5) * 5 : Math.ceil(max)
  return <div className="report-chart">
    <div className="report-chart-legend">{series.map((name, index) => <span key={name}><i className={`series-${index}`} />{name}</span>)}</div>
    <div className="report-chart-bars" aria-label="每月津贴到账金额">
      {buckets.map(bucket => <div className="report-chart-column" key={bucket.title}>
        <ChartHover label={bucket.title} lines={[...bucket.values.map((value, i) => `${series[i]}：${format(value)}`), ...(bucket.details ?? [])]}>
          <div className="report-chart-group">{bucket.values.map((value, index) => <div className="report-bar-slot" key={index}>
            <small style={{ bottom: `calc(${value / scale * 100}% + 4px)` }}>{value ? format(value) : ''}</small>
            <motion.span initial={{ scaleY: reduced ? 1 : 0 }} animate={{ scaleY: 1 }} transition={{ duration: reduced ? 0.08 : 0.3 }} className={`report-bar series-${index}`} style={{ height: `${value / scale * 100}%`, transformOrigin: 'bottom' }} />
          </div>)}</div><span className="report-chart-label">{bucket.label}</span>
        </ChartHover>
      </div>)}
    </div>
  </div>
}
