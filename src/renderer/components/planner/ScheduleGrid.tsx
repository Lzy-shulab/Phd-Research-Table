import { useEffect, useRef, useState } from 'react'
import { formatDate, calendarLabel } from '../../lib/dates'
import { useScheduleGesture, type ScheduleSlot } from '../../hooks/use-schedule-gesture'
import { Plus } from 'lucide-react'
import type { Task } from '../../../shared/types'
import { HOUR_HEIGHT, MINUTE_HEIGHT, clampMinute, layoutSchedule } from '../../../domain/schedule'
import { useWorkbench } from '../../stores/workbench'
import { useClock } from '../../hooks/use-clock'
import { dateKey, timeFromMinutes } from '../../lib/dates'
import { cn } from '../../lib/utils'
import { Button } from '../ui/button'
import { Dialog } from '../ui/dialog'
import { ProjectSelect } from '../projects/ProjectSelect'

const hourHeight = HOUR_HEIGHT
export function ScheduleGrid({
  dates,
  tasks,
  compact = false
}: {
  dates: Date[]
  tasks: Task[]
  compact?: boolean
}) {
  const projects = useWorkbench((s) => s.projects)
  const scopeId = useWorkbench((s) => s.projectId)
  const canCreate = !projects.find((p) => p.id === scopeId)?.archivedAt
  const [chosenProject, setChosenProject] = useState('')
  const activeProjects = projects.filter((p) => !p.archivedAt)
  const projectId = activeProjects.some((p) => p.id === chosenProject) ? chosenProject
    : activeProjects.some((p) => p.id === scopeId) ? scopeId!
    : activeProjects.length === 1 ? activeProjects[0]!.id : ''
  const select = useWorkbench((s) => s.selectTask)
  const selectedId = useWorkbench((s) => s.selectedTaskId)
  const create = useWorkbench((s) => s.createTask)
  const edit = useWorkbench((s) => s.editTask)
  const now = useClock()
  const viewport = useRef<HTMLDivElement>(null)
  const [slot, setSlot] = useState<{ date: string; start: number | null; end: number | null } | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const openSlot = (value: ScheduleSlot) => { if (canCreate) { setTitle(''); setChosenProject(''); setSlot(value) } }
  const { begin, preview } = useScheduleGesture(openSlot)
  const previewTask = preview?.task ? {
    ...preview.task, scheduledDate: preview.date, startTime: timeFromMinutes(preview.start),
    endTime: preview.end === null ? null : timeFromMinutes(preview.end)
  } : null
  const displayTasks = previewTask ? tasks.map((t) => t.id === previewTask.id ? previewTask : t) : tasks
  const rangeKey = dates.map(dateKey).join(',')
  useEffect(() => {
    if (viewport.current) viewport.current.scrollTop = 8 * hourHeight
  }, [rangeKey])
  const scheduleSlot = (date: string, hour: number) => {
    if (!canCreate) return
    setTitle('')
    setChosenProject('')
    setSlot({ date, start: hour * 60, end: Math.min(hour * 60 + 60, 1439) })
  }
  return (
    <>
      <div className={cn('schedule-viewport', compact && 'compact')} ref={viewport}>
        <div
          className={cn('schedule-board', dates.length > 1 && 'week-board')}
          style={{ gridTemplateColumns: `${compact ? 56 : 76}px repeat(${dates.length}, minmax(0, 1fr))` }}
        >
          {!compact && (
            <>
              <div className="calendar-corner">
                <span>本地时间</span>
              </div>
              {dates.map((date) => (
                <div
                  key={dateKey(date)}
                  className={cn(
                    'calendar-day-heading',
                    dateKey(date) === dateKey(now) && 'is-today'
                  )}
                >
                  <span>{formatDate(date, 'EEE')}</span>
                  <strong>{formatDate(date, 'd')}</strong>
                </div>
              ))}
              <div className="anytime-axis">未指定时间</div>
              {dates.map((date) => (
                <div key={dateKey(date)} className="calendar-anytime">
                  {tasks
                    .filter((t) => t.scheduledDate === dateKey(date) && !t.startTime)
                    .map((t) => {
                      const p = projects.find((p) => p.id === t.projectId)
                      return (
                        <button
                          key={t.id}
                          className={`anytime-chip project-${p?.colorKey ?? 'slate'}`}
                          title={t.title}
                          onClick={() => select(t.id)}
                        >
                          {t.title}
                        </button>
                      )
                    })}
                  <button
                    className="anytime-add"
                    aria-label={`为 ${calendarLabel(dateKey(date))} 添加未指定时间的任务`}
                    onClick={() => {
                      setTitle('')
                      setSlot({ date: dateKey(date), start: null, end: null })
                    }}
                  >
                    <Plus size={12} />
                  </button>
                </div>
              ))}
            </>
          )}
          <div className="time-axis" style={{ height: 24 * hourHeight }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                style={{ top: hour * hourHeight }}
              >{`${hour.toString().padStart(2, '0')}:00`}</span>
            ))}
          </div>
          {dates.map((date) => {
            const key = dateKey(date),
              dayTasks = displayTasks.filter((t) => t.scheduledDate === key)
            const blocks = layoutSchedule(dayTasks)
            return (
              <div
                key={key}
                data-date={key}
                className={cn('schedule-day', key === dateKey(now) && 'current-day')}
                style={{ height: 24 * hourHeight }}
              >
                {Array.from({ length: 24 }, (_, hour) => (
                  <button
                    key={hour}
                    className="hour-slot"
                    style={{ top: hour * hourHeight, height: hourHeight }}
                    aria-label={`安排任务 ${key} ${hour.toString().padStart(2, '0')}:00`}
                    onPointerDown={(event) => begin(event, 'create', key)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        scheduleSlot(key, hour)
                      }
                    }}
                    onClick={(event) => { if (event.detail === 0) scheduleSlot(key, hour) }}
                  >
                    <span>
                      <Plus size={12} />
                      {`${hour.toString().padStart(2, '0')}:00`}
                    </span>
                  </button>
                ))}
                {blocks.map((block) => {
                  const { task } = block
                  const project = projects.find((p) => p.id === task.projectId)
                  return (
                    <div
                      key={task.id}
                      role="button"
                      tabIndex={0}
                      aria-label={`${task.title} ${task.startTime}${task.endTime ? `–${task.endTime}` : ''}`}
                      data-testid="schedule-block"
                      className={cn(
                        'schedule-block',
                        `project-${project?.colorKey ?? 'slate'}`,
                        !task.endTime && 'start-only',
                        selectedId === task.id && 'selected',
                        preview?.task?.id === task.id && preview.moved && 'is-dragging',
                        block.end - block.start < 38 && 'short-block',
                        block.end - block.start < 15 && 'tiny-block'
                      )}
                      style={{
                        top: block.start * MINUTE_HEIGHT,
                        height: Math.max((block.end - block.start) * MINUTE_HEIGHT, 1),
                        left: `calc(${(block.column / block.columns) * 100}% + 5px)`,
                        width: `calc(${100 / block.columns}% - 10px)`
                      }}
                      onPointerDown={(event) => begin(event, 'move', key, task)}
                      onClick={(event) => { if (event.detail === 0) select(task.id) }}
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) return
                        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(task.id) }
                      }}
                      title={`${task.startTime}${task.endTime ? `–${task.endTime}` : ' · 未设置结束时间'} ${task.title}`}
                    >
                      <button className="resize-handle resize-start" aria-label={`调整开始时间 ${task.title}`}
                        onPointerDown={(event) => begin(event, 'start', key, task)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                            event.preventDefault()
                            edit(task.id, { startTime: timeFromMinutes(clampMinute(block.start + (event.key === 'ArrowUp' ? -1 : 1), 0, (task.endTime ? block.end : 1440) - 1)) }, true)
                          }
                        }} />
                      <span className="block-title">{task.title}</span>
                      <span className="block-time">
                        {task.startTime}
                        {task.endTime ? `–${task.endTime}` : ' · 仅开始时间'}
                      </span>
                      {project && block.end - block.start >= 60 && (
                        <span className="block-project">{project.name}</span>
                      )}
                      <button className="resize-handle resize-end" aria-label={`调整结束时间 ${task.title}`}
                        disabled={block.start >= 1439}
                        onPointerDown={(event) => begin(event, 'end', key, task)}
                        onClick={(event) => event.stopPropagation()}
                        onKeyDown={(event) => {
                          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                            event.preventDefault()
                            edit(task.id, { endTime: timeFromMinutes(clampMinute(block.end + (event.key === 'ArrowUp' ? -1 : 1), block.start + 1)) }, true)
                          }
                        }} />
                    </div>
                  )
                })}
                {preview?.kind === 'create' && preview.date === key && (
                  <div className="schedule-selection" style={{ top: preview.start * MINUTE_HEIGHT, height: Math.max(((preview.end ?? preview.start + 1) - preview.start) * MINUTE_HEIGHT, 1) }}>
                    <span>{timeFromMinutes(preview.start)}{preview.end !== null ? `–${timeFromMinutes(preview.end)}` : ''}</span>
                  </div>
                )}
                {key === dateKey(now) && (
                  <div
                    className="now-line"
                    style={{ top: (now.getHours() + now.getMinutes() / 60) * hourHeight }}
                  >
                    <i />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <Dialog
        open={!!slot}
        onOpenChange={(value) => {
          if (!value && !busy) setSlot(null)
        }}
        title="安排研究时间"
        description={slot ? `${calendarLabel(slot.date, 'yyyy年M月d日 EEEE')}${slot.start !== null ? ` · ${timeFromMinutes(slot.start)}${slot.end !== null ? `–${timeFromMinutes(slot.end)}` : ''}` : ' · 未指定时间'}` : ''}
      >
        <form
          onSubmit={async (e) => {
            e.preventDefault()
            if (!slot || !title.trim() || !projectId || busy) return
            setBusy(true)
            const task = await create({
              title,
              projectId,
              scheduledDate: slot.date,
              startTime: slot.start === null ? null : timeFromMinutes(slot.start),
              endTime: slot.end === null ? null : timeFromMinutes(slot.end)
            })
            setBusy(false)
            if (task) {
              setSlot(null)
              select(task.id)
            }
          }}
        >
          <label className="field">
            任务标题
            <input
              autoFocus
              aria-label="新建计划任务标题"
              placeholder="这段时间准备推进什么？"
              value={title}
              maxLength={500}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>
          <div className="dialog-actions">
            <ProjectSelect value={projectId} onChange={setChosenProject} label="日历计划所属项目" />
            <Button onClick={() => setSlot(null)} disabled={busy}>
              取消
            </Button>
            <Button type="submit" variant="primary" disabled={!title.trim() || busy || !projectId}>
              {busy ? '正在创建…' : '创建任务'}
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  )
}
