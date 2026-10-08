import { motion } from 'motion/react'
import { FolderPlus, MoreHorizontal, Plus } from 'lucide-react'
import type { Project, Task } from '../../../shared/types'
import { TaskList } from './TaskList'
import { Button } from '../ui/button'

export function PlanNoteBoard({
  tasks,
  allTasks,
  projects,
  filtered,
  sortable,
  showDate,
  onAdd,
  onManage,
  onNewProject
}: {
  tasks: Task[]
  allTasks: Task[]
  projects: Project[]
  filtered: boolean
  sortable: boolean
  showDate: boolean
  onAdd: (projectId: string | null) => void
  onManage: (projectId: string) => void
  onNewProject: () => void
}) {
  const notes = projects.flatMap((project) => {
    const items = tasks.filter((task) => task.projectId === project.id)
    if (!items.length) return []
    return [
      {
        id: project.id as string | null,
        title: project.name,
        archived: !!project.archivedAt,
        colorKey: project.colorKey,
        tasks: items
      }
    ]
  })
  const unassigned = tasks.filter(
    (task) => !projects.some((project) => project.id === task.projectId)
  )
  if (unassigned.length)
    notes.push({ id: null, title: '待归属项目', archived: false, colorKey: 'slate' as const, tasks: unassigned })
  if (!notes.length)
    return (
      <div className="note-board-empty">
        <FolderPlus size={28} strokeWidth={1.3} />
        <h2>{filtered ? '没有匹配的任务' : '这里还没有任务'}</h2>
        <p>
          {filtered ? '换一个关键词，或调整任务状态。' : '创建项目后，就可以安排任务。'}
        </p>
        {!filtered && (
          <Button onClick={onNewProject}>
            <Plus size={15} />
            新建项目
          </Button>
        )}
      </div>
    )
  return (
    <div className="plan-note-board" aria-label="项目卡片">
      {notes.map((note) => {
        const projectTasks = allTasks.filter((task) => note.id ? task.projectId === note.id : !projects.some((project) => project.id === task.projectId))
        const completed = projectTasks.filter((task) => task.status === 'completed').length
        const noteKey = note.id ?? 'unassigned'
        return (
          <motion.section layout="position"
            key={noteKey}
            className={`plan-note project-${note.colorKey}`}
            aria-label={`${note.title}项目卡片`}
          >
            <header className="plan-note-header">
              <h2 title={note.title}><span className="plan-note-avatar" aria-hidden="true">{note.title.slice(0, 2)}</span>{note.title}</h2>
              <span
                className="plan-note-count"
                aria-label={`已完成 ${completed}，共 ${projectTasks.length} 项`}
              >
                已完成 {completed} / {projectTasks.length}
              </span>
              {!note.archived && <button className="plan-note-add" aria-label={`添加任务到 ${note.title}`} title="添加任务" onClick={() => onAdd(note.id)}><Plus size={16} /></button>}
              {note.id && (
                <button
                  className="plan-note-manage"
                  aria-label={`管理项目 ${note.title}`}
                  title="项目设置"
                  onClick={() => onManage(note.id!)}
                >
                  <MoreHorizontal size={16} />
                  <span>项目设置</span>
                </button>
              )}
            </header>
            <div className="plan-note-task-scroll" role="region" aria-label={`${note.title}任务列表`} tabIndex={note.tasks.length > 3 ? 0 : undefined}>
              <TaskList tasks={note.tasks} sortable={sortable} showDate={showDate} />
            </div>
            <footer className="plan-note-footer">
              <span>
                {note.archived && '已归档 · '}
                {completed === projectTasks.length ? '全部完成' : `${projectTasks.length - completed} 项待推进`}
              </span>
              {note.tasks.length > 3 && <small>向下滚动 · 共 {note.tasks.length} 项</small>}
            </footer>
          </motion.section>
        )
      })}
    </div>
  )
}
