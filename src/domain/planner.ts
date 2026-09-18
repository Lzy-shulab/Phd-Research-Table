import { format, parseISO } from 'date-fns'
import type { PlannerView, Task } from '../shared/types'
export type TaskSort = 'manual' | 'scheduled' | 'priority' | 'title' | 'updated'
const priorityWeight = { high: 3, medium: 2, low: 1, none: 0 }
export function selectTasks(
  tasks: Task[],
  view: PlannerView,
  today: string,
  projectId: string | null
): Task[] {
  return tasks.filter((task) => {
    if (!['all', 'today', 'calendar'].includes(view) && projectId && task.projectId !== projectId) return false
    if (view === 'all') return true
    if (view === 'completed') return task.status === 'completed'
    if (task.status === 'completed') return false
    if (view === 'inbox') return !task.scheduledDate
    if (view === 'today') return task.scheduledDate === today || (!task.scheduledDate && task.dueDate === today)
    if (view === 'upcoming') return !!task.scheduledDate && task.scheduledDate > today
    if (view === 'project') return task.projectId === projectId
    return true
  })
}
export function sortTasks(tasks: Task[], sort: TaskSort): Task[] {
  return [...tasks].sort((a, b) => {
    if (sort === 'priority')
      return priorityWeight[b.priority] - priorityWeight[a.priority] || a.order - b.order
    if (sort === 'title') return a.title.localeCompare(b.title)
    if (sort === 'updated') return b.updatedAt.localeCompare(a.updatedAt)
    if (sort === 'scheduled')
      return (
        (a.scheduledDate ?? '9999').localeCompare(b.scheduledDate ?? '9999') ||
        (a.startTime ?? '99:99').localeCompare(b.startTime ?? '99:99') ||
        a.order - b.order
      )
    return a.order - b.order
  })
}
export function groupTasks(tasks: Task[], completed = false): [string, Task[]][] {
  const groups = new Map<string, Task[]>()
  for (const task of tasks) {
    const key =
      completed && task.completedAt
        ? format(parseISO(task.completedAt), 'yyyy-MM-dd')
        : (task.scheduledDate ?? 'Unscheduled')
    groups.set(key, [...(groups.get(key) ?? []), task])
  }
  return [...groups].sort(([a], [b]) => (completed ? b.localeCompare(a) : a.localeCompare(b)))
}
