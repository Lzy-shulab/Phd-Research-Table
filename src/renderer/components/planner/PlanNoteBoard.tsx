import { FolderPlus, MoreHorizontal, Plus } from 'lucide-react'
import type { Project, Task } from '../../../shared/types'
import { TaskList } from './TaskList'
import { Button } from '../ui/button'

export function PlanNoteBoard({
  tasks,
  projects,
  filtered,
  sortable,
  showDate,
  onAdd,
  onManage,
  onNewProject
}: {
  tasks: Task[]
  projects: Project[]
  filtered: boolean
  sortable: boolean
  showDate: boolean
  onAdd: (projectId: string | null) => void
  onManage: (projectId: string) => void
  onNewProject: () => void
}) {
  const notes = projects.flatMap((project, index) => {
    const items = tasks.filter((task) => task.projectId === project.id)
    if ((filtered || project.archivedAt) && !items.length) return []
    return [
      {
        id: project.id as string | null,
        title: project.name,
        archived: !!project.archivedAt,
        tone: index % 12,
        tasks: items
      }
    ]
  })
  const unassigned = tasks.filter(
    (task) => !projects.some((project) => project.id === task.projectId)
  )
  if (unassigned.length)
    notes.push({ id: null, title: '待归属项目', archived: false, tone: 3, tasks: unassigned })
  if (!notes.length)
    return (
      <div className="note-board-empty">
        <FolderPlus size={28} strokeWidth={1.3} />
        <h2>{filtered ? '没有匹配的任务' : '为研究留一张便签'}</h2>
        <p>
          {filtered ? '换一个关键词，或调整任务状态。' : '创建项目后，就可以在便签里安排任务。'}
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
    <div className="plan-note-board" aria-label="项目便签">
      {notes.map((note) => {
        const completed = note.tasks.filter((task) => task.status === 'completed').length
        return (
          <section
            key={note.id ?? 'unassigned'}
            className={`plan-note note-tone-${note.tone}`}
            aria-label={`${note.title}便签`}
          >
            <header className="plan-note-header">
              <h2 title={note.title}>{note.title}</h2>
              <span
                className="plan-note-count"
                aria-label={`已完成 ${completed}，共 ${note.tasks.length} 项`}
              >
                {completed}
                <span> / {note.tasks.length}</span>
              </span>
              {note.id && (
                <button
                  className="plan-note-manage"
                  aria-label={`管理项目 ${note.title}`}
                  title="项目设置"
                  onClick={() => onManage(note.id!)}
                >
                  <MoreHorizontal size={16} />
                </button>
              )}
            </header>
            {note.archived && <span className="plan-note-archived">已归档</span>}
            {note.tasks.length ? (
              <TaskList tasks={note.tasks} sortable={sortable} showDate={showDate} />
            ) : (
              <p className="plan-note-empty">
                暂时没有安排
                <br />
                <span>记下下一件想推进的事。</span>
              </p>
            )}
            <footer className="plan-note-footer">
              <span>
                {note.tasks.length
                  ? completed === note.tasks.length
                    ? '都完成了，留一点空白。'
                    : `${note.tasks.length - completed} 项待推进`
                  : '从一个小计划开始'}
              </span>
              {!note.archived && (
                <button
                  className="plan-note-add"
                  aria-label={`添加任务到 ${note.title}`}
                  onClick={() => onAdd(note.id)}
                >
                  <Plus size={17} />
                </button>
              )}
            </footer>
          </section>
        )
      })}
    </div>
  )
}
