import { monthWeeks, type ReportSelection } from '../../../domain/reports'
import { isCalendarDate } from '../../../domain/validation'
import * as Select from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'

export function ReportPeriodPicker({ label, selection, onChange }: {
  label: string; selection: ReportSelection; onChange: (selection: ReportSelection) => void
}) {
  const weeks = monthWeeks(selection.month)
  return <div className="report-local-period">
    <div className="plan-layout-switch" role="group" aria-label={`${label}周期`}>
      {(['week', 'month'] as const).map(period => <button key={period} aria-pressed={selection.period === period}
        onClick={() => onChange({ ...selection, period })}>{period === 'week' ? '按周' : '按月'}</button>)}
    </div>
    <input type="month" aria-label={`${label}月份`} value={selection.month} onChange={event => {
      const month = event.target.value
      if (isCalendarDate(`${month}-01`)) onChange({ ...selection, month, week: Math.min(selection.week, monthWeeks(month).length - 1) })
    }} />
    {selection.period === 'week' && <Select.Root value={String(selection.week)} onValueChange={week => onChange({ ...selection, week: Number(week) })}>
      <Select.Trigger className="report-week-trigger" aria-label={`${label}周次`}><Select.Value>{weeks[selection.week]?.label.split('（')[0]}</Select.Value><Select.Icon><ChevronDown size={13} /></Select.Icon></Select.Trigger>
      <Select.Portal><Select.Content className="report-week-menu" position="popper" sideOffset={5} collisionPadding={12}><Select.Viewport>
        {weeks.map((week, index) => <Select.Item className="report-week-option" key={week.start} value={String(index)}><Select.ItemText>{week.label}</Select.ItemText><Select.ItemIndicator><Check size={14} /></Select.ItemIndicator></Select.Item>)}
      </Select.Viewport></Select.Content></Select.Portal>
    </Select.Root>}
  </div>
}
