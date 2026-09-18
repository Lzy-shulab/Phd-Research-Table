import { addDays, parseISO, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Task } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'
import { dateKey, formatDate } from '../../lib/dates'
import { Button } from '../ui/button'
import { ScheduleGrid } from './ScheduleGrid'

export function CalendarView({ tasks }: { tasks: Task[] }) {
  const selectedDate = useWorkbench((s) => s.calendarDate)
  const mode = useWorkbench((s) => s.calendarMode)
  const setCalendar = useWorkbench((s) => s.setCalendar)
  const date = parseISO(selectedDate)
  const start = mode === 'week' ? startOfWeek(date, { weekStartsOn: 1 }) : date
  const dates = Array.from({ length: mode === 'week' ? 7 : 1 }, (_, i) => addDays(start, i))
  const last = dates[dates.length - 1]!
  return (
    <section className="calendar-view">
      <div className="calendar-toolbar">
        <div className="calendar-period">
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="上一时段"
            onClick={() => setCalendar(dateKey(addDays(date, mode === 'week' ? -7 : -1)))}
          >
            <ChevronLeft size={17} />
          </Button>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="下一时段"
            onClick={() => setCalendar(dateKey(addDays(date, mode === 'week' ? 7 : 1)))}
          >
            <ChevronRight size={17} />
          </Button>
          <h2>
            {mode === 'week'
              ? `${formatDate(start, 'yyyy年M月d日')} – ${formatDate(last, start.getFullYear() === last.getFullYear() ? 'M月d日' : 'yyyy年M月d日')}`
              : formatDate(date)}
          </h2>
        </div>
        <div className="calendar-view-controls">
          <Button onClick={() => setCalendar(dateKey())}>今天</Button>
          <div className="segmented-control">
            {(['day', 'week'] as const).map((value) => (
              <button
                key={value}
                aria-pressed={mode === value}
                onClick={() => setCalendar(selectedDate, value)}
              >
                {value === 'day' ? '日视图' : '周视图'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <ScheduleGrid dates={dates} tasks={tasks.filter((t) => t.status !== 'completed')} />
      <p className="calendar-hint">
        点击或拖选空白区域创建任务；拖动任务或上下边缘可按分钟调整。
      </p>
    </section>
  )
}
