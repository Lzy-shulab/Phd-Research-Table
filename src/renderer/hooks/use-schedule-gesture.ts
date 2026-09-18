import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Task } from '../../shared/types'
import { clampMinute, minuteAtPosition, moveInterval, toMinutes, timeFromMinutes } from '../../domain/schedule'
import { useWorkbench } from '../stores/workbench'

export interface ScheduleSlot { date: string; start: number; end: number | null }
type Gesture = ScheduleSlot & {
  kind: 'create' | 'move' | 'start' | 'end'
  task?: Task
  origin: number
  originalStart: number
  originalEnd: number | null
  day: HTMLElement
  pointerId: number
  x: number
  y: number
  moved: boolean
}

// Visual hour lines do not participate in these calculations. All operations round to one minute.
export function useScheduleGesture(onCreate: (slot: ScheduleSlot) => void) {
  const active = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<Gesture | null>(null)
  const createRef = useRef(onCreate)
  createRef.current = onCreate
  const begin = (event: ReactPointerEvent<HTMLElement>, kind: Gesture['kind'], date: string, task?: Task) => {
    if (event.button !== 0 || active.current) return
    const day = event.currentTarget.closest<HTMLElement>('.schedule-day')!
    const origin = minuteAtPosition(event.clientY - day.getBoundingClientRect().top)
    const start = task?.startTime ? toMinutes(task.startTime) : origin
    const end = task ? (task.endTime ? toMinutes(task.endTime) : null) : start < 1439 ? Math.min(start + 60, 1439) : null
    event.preventDefault()
    event.stopPropagation()
    day.setPointerCapture(event.pointerId)
    const gesture = { kind, date, task, origin, originalStart: start, originalEnd: end, start, end, day,
      pointerId: event.pointerId, x: event.clientX, y: event.clientY, moved: false }
    active.current = gesture
    setPreview(gesture)
  }
  useEffect(() => {
    let frame = 0
    const update = (x: number, y: number) => {
      const g = active.current
      if (!g) return
      const minute = minuteAtPosition(y - g.day.getBoundingClientRect().top)
      const delta = minute - g.origin
      const next = { ...g }
      if (g.kind === 'create') {
        if (g.moved || Math.abs(delta) >= 1) {
          next.start = Math.min(g.origin, minute, 1438)
          next.end = Math.max(next.start + 1, g.origin, minute)
        }
      } else if (g.kind === 'move') {
        Object.assign(next, moveInterval(g.originalStart, g.originalEnd, delta))
        const days = g.day.parentElement!.querySelectorAll<HTMLElement>('.schedule-day')
        for (const day of days) {
          const bounds = day.getBoundingClientRect()
          if (x >= bounds.left && x < bounds.right) next.date = day.dataset.date!
        }
      } else if (g.kind === 'start') {
        next.start = clampMinute(g.originalStart + delta, 0, (g.originalEnd ?? 1440) - 1)
      } else {
        next.end = clampMinute((g.originalEnd ?? Math.min(g.originalStart + 30, 1439)) + delta, g.originalStart + 1)
      }
      next.moved = g.moved || delta !== 0 || next.date !== g.date
      active.current = next
      setPreview(next)
    }
    const scroll = () => {
      const g = active.current
      if (!g) return
      const viewport = g.day.closest<HTMLElement>('.schedule-viewport')!
      const bounds = viewport.getBoundingClientRect()
      const heading = viewport.classList.contains('compact') ? 0 : 110
      const dy = g.y < bounds.top + heading + 22 ? -8 : g.y > bounds.bottom - 22 ? 8 : 0
      const dx = g.x < bounds.left + 22 ? -8 : g.x > bounds.right - 22 ? 8 : 0
      if (dy || dx) {
        viewport.scrollBy(dx, dy)
        update(g.x, g.y)
      }
      frame = requestAnimationFrame(scroll)
    }
    const move = (event: PointerEvent) => {
      if (!active.current || event.pointerId !== active.current.pointerId) return
      active.current.x = event.clientX
      active.current.y = event.clientY
      update(event.clientX, event.clientY)
      if (!frame) frame = requestAnimationFrame(scroll)
    }
    const finish = (cancel = false) => {
      const g = active.current
      if (!g) return
      active.current = null
      cancelAnimationFrame(frame)
      frame = 0
      if (g.day.hasPointerCapture(g.pointerId)) g.day.releasePointerCapture(g.pointerId)
      setPreview(null)
      if (cancel) return
      if (g.kind === 'create') createRef.current({ date: g.date, start: g.start, end: g.end })
      else if (g.task) {
        if (!g.moved) useWorkbench.getState().selectTask(g.task.id)
        else useWorkbench.getState().editTask(g.task.id, {
          scheduledDate: g.date,
          startTime: timeFromMinutes(g.start),
          endTime: g.end === null ? null : timeFromMinutes(g.end)
        }, true)
      }
    }
    const up = (event: PointerEvent) => { if (event.pointerId === active.current?.pointerId) finish() }
    const cancel = () => finish(true)
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape' && active.current) { event.preventDefault(); cancel() } }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', cancel)
    return () => {
      cancelAnimationFrame(frame)
      active.current = null
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', cancel)
    }
  }, [])
  return { begin, preview }
}
