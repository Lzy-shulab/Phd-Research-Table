import { useState } from 'react'
import { Clock3 } from 'lucide-react'
import { Button } from './button'
import { Dialog } from './dialog'

const hours = Array.from({ length: 24 }, (_, value) => value.toString().padStart(2, '0'))
const minuteValues = Array.from({ length: 60 }, (_, value) => value.toString().padStart(2, '0'))
const validTime = /^([01]\d|2[0-3]):[0-5]\d$/

export function TimeInput({
  label,
  value,
  placeholder,
  disabled = false,
  fallback = '09:00',
  onChange
}: {
  label: string
  value: string
  placeholder: string
  disabled?: boolean
  fallback?: string
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const initial = validTime.test(value) ? value : fallback
  const [hour, setHour] = useState(initial.slice(0, 2))
  const [minute, setMinute] = useState(initial.slice(3, 5))
  const showPicker = () => {
    const next = validTime.test(value) ? value : fallback
    setHour(next.slice(0, 2))
    setMinute(next.slice(3, 5))
    setOpen(true)
  }
  const choose = () => {
    onChange(`${hour}:${minute}`)
    setOpen(false)
  }
  return <div className="time-input">
    <input
      type="text"
      inputMode="numeric"
      maxLength={5}
      placeholder={placeholder}
      aria-label={label}
      disabled={disabled}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={(event) => {
        if (event.altKey && event.key === 'ArrowDown' && !disabled) {
          event.preventDefault()
          showPicker()
        }
      }}
    />
    <button type="button" className="time-input-trigger" aria-label={`选择${label}`} disabled={disabled} onClick={showPicker}>
      <Clock3 size={14} />
    </button>
    <Dialog open={open} onOpenChange={setOpen} title={`选择${label}`} description="上下滑动小时和分钟，也可返回输入框直接填写任意分钟。" className="time-picker-dialog">
      <div className="time-wheel" role="group" aria-label={`${label}滑动选择器`}>
        <label><span>小时</span><select size={7} aria-label={`${label}小时`} value={hour} onChange={(event) => setHour(event.target.value)}>
          {hours.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
        <strong aria-hidden="true">:</strong>
        <label><span>分钟</span><select size={7} aria-label={`${label}分钟`} value={minute} onChange={(event) => setMinute(event.target.value)}>
          {minuteValues.map((item) => <option key={item} value={item}>{item}</option>)}
        </select></label>
      </div>
      <div className="dialog-actions">
        <Button onClick={() => { onChange(''); setOpen(false) }}>清除时间</Button>
        <Button variant="primary" onClick={choose}>确定</Button>
      </div>
    </Dialog>
  </div>
}
