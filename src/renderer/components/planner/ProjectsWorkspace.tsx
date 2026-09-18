import { useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Archive, ChevronRight, ChevronsDownUp, ChevronsUpDown, FolderOpen, Layers3, Plus, Search } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { useTasks } from '../../hooks/use-tasks'
import { sortTasks } from '../../../domain/planner'
import { TaskList } from './TaskList'
import { ProjectDialog } from '../projects/ProjectDialog'
import { Button } from '../ui/button'

export function ProjectsWorkspace() {
  const projects = useWorkbench((s) => s.projects)
  const folds = useWorkbench((s) => s.projectFolds)
  const setFolds = useWorkbench((s) => s.setProjectFolds)
  const tasks = useTasks()
  const reduced = useReducedMotion()
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const search = query.trim().toLowerCase()
  const groups = [...projects.map((project) => ({ key: project.id, project, name: project.name, tasks: tasks.filter((task) => task.projectId === project.id) })),
    ...(tasks.some((task) => !task.projectId) ? [{ key: 'unassigned', project: null, name: '待归属项目', tasks: tasks.filter((task) => !task.projectId) }] : [])]
    .map((group) => ({ ...group, visibleTasks: group.name.toLowerCase().includes(search) ? group.tasks : group.tasks.filter((task) => `${task.title} ${task.description}`.toLowerCase().includes(search)) }))
    .filter((group) => !search || group.name.toLowerCase().includes(search) || group.visibleTasks.length)
  return <main className="planner-workspace projects-workspace">
    <header className="workspace-header"><div><div className="workspace-breadcrumb">研究计划<span>/</span>全部项目</div>
      <div className="heading-line"><h1>全部项目</h1><span className="library-count">{projects.length} 个</span></div>
      <p>展开一个项目，看到其中每一项研究任务。</p></div>
      <Button variant="primary" onClick={() => setCreating(true)}><Plus size={16} />新建项目</Button></header>
    <div className="workspace-body">
      <div className="projects-toolbar"><span>{tasks.length} 项任务<span className="text-divider">·</span>{tasks.filter((task) => task.status === 'completed').length} 项已完成</span>
        <label className="task-search"><Search size={14} /><input aria-label="搜索项目或任务" placeholder="搜索项目或任务" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <Button variant="ghost" onClick={() => setFolds({ ...folds, ...Object.fromEntries(groups.map((group) => [group.key, false])) })}><ChevronsUpDown size={15} />全部展开</Button>
        <Button variant="ghost" onClick={() => setFolds({ ...folds, ...Object.fromEntries(groups.map((group) => [group.key, true])) })}><ChevronsDownUp size={15} />全部收起</Button>
      </div>
      <div className="project-drawers">
        {groups.map((group) => {
          const completed = group.tasks.filter((task) => task.status === 'completed').length
          const open = search ? true : !folds[group.key]
          const sorted = sortTasks(group.visibleTasks, 'manual')
          const ordered = [...sorted.filter((task) => task.status !== 'completed'), ...sorted.filter((task) => task.status === 'completed')]
          return <motion.section layout="position" className="project-drawer" key={group.key} data-testid="project-drawer" transition={{ duration: reduced ? 0 : 0.26 }}>
            <button className="project-drawer-toggle" aria-expanded={open} aria-controls={`project-tasks-${group.key}`} onClick={() => setFolds({ ...folds, [group.key]: open })}>
              <motion.span className="project-chevron" animate={{ rotate: open ? 90 : 0 }} transition={{ duration: reduced ? 0 : 0.2 }}><ChevronRight size={17} /></motion.span>
              <span className={`drawer-folder project-${group.project?.colorKey ?? 'slate'}`}><FolderOpen size={21} strokeWidth={1.6} /></span>
              <span className="drawer-project-heading"><strong>{group.name}</strong><small>{group.project?.description || (group.project ? '项目中的全部任务' : '这些任务可以在详情中补充归属')}</small></span>
              {group.project?.archivedAt && <span className="quiet-badge"><Archive size={11} />已归档</span>}
              <span className="drawer-count">{group.tasks.length} 项任务</span><span className="drawer-completion">{completed} / {group.tasks.length} 已完成</span>
            </button>
            <AnimatePresence initial={false}>{open && <motion.div id={`project-tasks-${group.key}`} className="project-drawer-content" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ type: 'spring', bounce: 0, duration: reduced ? 0 : 0.32 }}>
              <div className="project-drawer-tasks">{ordered.length ? <TaskList tasks={ordered} showDate sortable={!search} /> : <p className="inline-empty">这个项目还没有任务。</p>}
                {group.project && !group.project.archivedAt && <Button className="drawer-add-task" variant="ghost" onClick={() => {
                  const state = useWorkbench.getState(); state.navigate('project', group.key); state.focusCapture()
                }}><Plus size={14} />添加项目任务</Button>}</div>
            </motion.div>}</AnimatePresence>
          </motion.section>
        })}
      </div>
      {!groups.length && <div className="empty-state"><div className="empty-icon"><Layers3 size={26} /></div><h2>{search ? '没有匹配的项目或任务。' : '从第一个研究项目开始。'}</h2><p>{search ? '换个关键词试试。' : '为课题建立项目，再逐步安排任务。'}</p>{!search && <Button onClick={() => setCreating(true)}><Plus size={15} />新建项目</Button>}</div>}
    </div>
    {creating && <ProjectDialog onClose={() => setCreating(false)} />}
  </main>
}
