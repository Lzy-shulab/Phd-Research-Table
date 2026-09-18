import { useMemo } from 'react'
import { useWorkbench } from '../stores/workbench'

export function useTasks() {
  const tasks = useWorkbench((s) => s.tasks)
  const drafts = useWorkbench((s) => s.drafts)
  return useMemo(
    () =>
      tasks.map((task) => {
        const merged = { ...task, ...drafts[task.id] }
        if (!merged.scheduledDate) {
          merged.startTime = null
          merged.endTime = null
        }
        if (merged.status !== 'completed')
          merged.status = merged.scheduledDate ? 'planned' : 'inbox'
        return merged
      }),
    [tasks, drafts]
  )
}
