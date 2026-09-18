import { useState } from 'react'
import { CalendarDays } from 'lucide-react'
import { MiniCalendar } from '../layout/MiniCalendar'
import { Dialog } from './dialog'
import { Button } from './button'
import { dateKey } from '../../lib/dates'

// Reuse the sidebar month navigator inside the existing elevated Radix surface.
export function DateInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const choose = (date: string) => { onChange(date); setOpen(false) }
  return (
    <div className="date-input">
      <input type="date" aria-label={label} value={value} min="1000-01-01" max="9999-12-31"
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.altKey && event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) }
        }} />
      <button type="button" className="date-input-trigger" aria-label={`选择${label}`} onClick={() => setOpen(true)}>
        <CalendarDays size={14} />
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={`选择${label}`} description="选择一个日期，也可直接在日期栏中输入。">
        <div className="date-picker"><MiniCalendar key={open ? value : 'closed'} value={value} onSelect={choose} /></div>
        <div className="dialog-actions">
          <Button onClick={() => choose('')}>清除日期</Button>
          <Button onClick={() => choose(dateKey())}>今天</Button>
        </div>
      </Dialog>
    </div>
  )
}
