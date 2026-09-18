import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { useWorkbench } from '../../stores/workbench'
import type { Task } from '../../../shared/types'
import { TaskRow } from './TaskRow'

export function TaskList({
  tasks,
  sortable = false,
  showDate = false
}: {
  tasks: Task[]
  sortable?: boolean
  showDate?: boolean
}) {
  const reorder = useWorkbench((s) => s.reorderTasks)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )
  return (
    <DndContext
      accessibility={{
        screenReaderInstructions: { draggable: '按空格选中任务，用方向键调整顺序，再按空格放下；按 Escape 取消。' },
        announcements: {
          onDragStart: () => '已选中任务。',
          onDragOver: ({ over }) => over ? `移动到第${tasks.findIndex((t) => t.id === over.id) + 1}项。` : '已移出任务列表。',
          onDragEnd: () => '任务排序已更新。',
          onDragCancel: () => '已取消排序。'
        }
      }}
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={({ active, over }) => {
        if (!sortable || !over || active.id === over.id) return
        const oldIndex = tasks.findIndex((t) => t.id === active.id),
          newIndex = tasks.findIndex((t) => t.id === over.id)
        if (oldIndex >= 0 && newIndex >= 0)
          void reorder(arrayMove(tasks, oldIndex, newIndex).map((t) => t.id))
      }}
    >
      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="task-list">
          {tasks.map((task) => (
            <TaskRow key={task.id} task={task} sortable={sortable} showDate={showDate} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  )
}
