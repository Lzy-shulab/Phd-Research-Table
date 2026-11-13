import type { InputHTMLAttributes } from 'react'
import { CalendarDots as CalendarDays, CaretDown as ChevronDown, Clock as Clock3 } from '@phosphor-icons/react'

export function WidgetDateField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <span className="widget-date-input"><input {...props} type="date" /><CalendarDays size={23} strokeWidth={1.6} aria-hidden="true" /></span>
}

export function WidgetTimeField(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <span className="widget-time-input"><Clock3 size={22} strokeWidth={1.6} aria-hidden="true" /><input {...props} type="time" /><ChevronDown size={17} strokeWidth={1.8} aria-hidden="true" /></span>
}
