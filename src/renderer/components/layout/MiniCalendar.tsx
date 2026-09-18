import { useState } from 'react'
import { addDays, addMonths, isSameMonth, parseISO, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { useTasks } from '../../hooks/use-tasks'
import { useClock } from '../../hooks/use-clock'
import { dateKey, formatDate } from '../../lib/dates'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'

export function MiniCalendar({ value, onSelect }: { value?: string; onSelect?: (date: string) => void } = {}) {
  const now = useClock()
  const [month, setMonth] = useState(() => startOfMonth(value ? parseISO(value) : now))
  const tasks = useTasks()
  const dates = new Set(tasks.filter((t) => t.status !== 'completed').map((t) => t.scheduledDate))
  const calendarSelected = useWorkbench((s) => (s.view === 'calendar' ? s.calendarDate : null))
  const selected = onSelect ? value : calendarSelected
  const setCalendar = useWorkbench((s) => s.setCalendar)
  const start = startOfWeek(month, { weekStartsOn: 1 })
  return (
    <section className="mini-calendar" aria-label="日期导航">
      <div className="mini-calendar-heading">
        <span>{formatDate(month, 'yyyy年M月')}</span>
        <div>
          <Button
            variant="ghost"
            className="icon-button small"
            aria-label="上个月"
            onClick={() => setMonth(addMonths(month, -1))}
          >
            <ChevronLeft size={14} />
          </Button>
          <Button
            variant="ghost"
            className="icon-button small"
            aria-label="下个月"
            onClick={() => setMonth(addMonths(month, 1))}
          >
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
      <div className="mini-calendar-grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((day, i) => (
          <span key={i} className="weekday">
            {day}
          </span>
        ))}
        {Array.from({ length: 42 }, (_, i) => {
          const date = addDays(start, i)
          const key = dateKey(date)
          return (
            <button
              key={key}
              title={formatDate(date)}
              aria-label={formatDate(date, 'yyyy年M月d日')}
              aria-current={key === dateKey(now) ? 'date' : undefined}
              onClick={() => onSelect ? onSelect(key) : setCalendar(key)}
              className={cn(
                'mini-day',
                !isSameMonth(date, month) && 'outside',
                key === dateKey(now) && 'is-today',
                selected === key && 'is-selected'
              )}
            >
              <span>{formatDate(date, 'd')}</span>
              {dates.has(key) && <i />}
            </button>
          )
        })}
      </div>
    </section>
  )
}
