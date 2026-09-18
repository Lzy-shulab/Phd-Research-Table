import { priorityLabels } from '../../../shared/labels'
import type { CSSProperties } from 'react'
import { Check, Clock3, GripVertical, MoreHorizontal, CalendarDays, Flag } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Task } from '../../../shared/types'
import { useWorkbench } from '../../stores/workbench'
import { cn } from '../../lib/utils'
import { calendarLabel } from '../../lib/dates'

export function TaskRow({
  task,
  sortable = false,
  showDate = false
}: {
  task: Task
  sortable?: boolean
  showDate?: boolean
}) {
  const projects = useWorkbench((s) => s.projects)
  const select = useWorkbench((s) => s.selectTask)
  const selected = useWorkbench((s) => s.selectedTaskId === task.id)
  const complete = useWorkbench((s) => s.completeTask)
  const project = projects.find((p) => p.id === task.projectId)
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !sortable
  })
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 2 : undefined
  }
  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid="task-row"
      className={cn(
        'task-row',
        selected && 'selected',
        task.status === 'completed' && 'completed',
        isDragging && 'dragging'
      )}
    >
      {sortable && (
        <button
          className="drag-handle"
          aria-label={`调整顺序 ${task.title}`}
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
      )}
      <button
        className="task-checkbox"
        role="checkbox"
        aria-checked={task.status === 'completed'}
        aria-label={`${task.status === 'completed' ? '恢复' : '完成'} ${task.title}`}
        onClick={() => void complete(task.id)}
      >
        {task.status === 'completed' && <Check size={12} strokeWidth={2.5} />}
      </button>
      <button className="task-content" onClick={() => select(task.id)}>
        <span className="task-title">{task.title}</span>
        <span className="task-meta">
          {!project && <span className="danger-text">待归属项目</span>}
          {project && (
            <span>
              <i className={`project-dot project-${project.colorKey}`} />
              {project.name}
            </span>
          )}
          {task.startTime && (
            <span className="time-meta">
              <Clock3 size={12} />
              {task.startTime}
              {task.endTime ? `–${task.endTime}` : ''}
            </span>
          )}
          {showDate && task.scheduledDate && (
            <span>
              <CalendarDays size={12} />
              {calendarLabel(task.scheduledDate)}
            </span>
          )}
          {task.dueDate && <span>截止 {calendarLabel(task.dueDate)}</span>}
          {!project && !task.startTime && !task.scheduledDate && !task.dueDate && (
            <span>未安排日期</span>
          )}
        </span>
      </button>
      {task.priority !== 'none' && (
        <Flag
          size={13}
          className={`priority-${task.priority}`}
          aria-label={`${priorityLabels[task.priority]}优先级`}
        />
      )}
      <button
        className="row-more"
        aria-label={`编辑 ${task.title}`}
        onClick={() => select(task.id)}
      >
        <MoreHorizontal size={17} />
      </button>
    </div>
  )
}
