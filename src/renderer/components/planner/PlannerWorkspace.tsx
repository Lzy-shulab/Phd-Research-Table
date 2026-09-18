import { useRef, useState } from 'react'
import {
  ArrowDownWideNarrow,
  CalendarDays,
  CircleCheck,
  Clock3,
  LayoutGrid,
  Plus,
  Search,
  Sun
} from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { useTasks } from '../../hooks/use-tasks'
import { useClock } from '../../hooks/use-clock'
import { calendarLabel, dateKey, durationLabel, minutes, formatDate } from '../../lib/dates'
import { groupTasks, selectTasks, sortTasks, type TaskSort } from '../../../domain/planner'
import { isLocalTime } from '../../../domain/schedule'
import { plannerViews } from '../../app/modules'
import { Button } from '../ui/button'
import { QuickCapture, type QuickCaptureHandle } from './QuickCapture'
import { PlanNoteBoard } from './PlanNoteBoard'
import { TaskList } from './TaskList'
import { CalendarView } from './CalendarView'
import { ScheduleGrid } from './ScheduleGrid'
import { ProjectDialog } from '../projects/ProjectDialog'

export function PlannerWorkspace() {
  const view = useWorkbench((s) => s.view)
  const projects = useWorkbench((s) => s.projects)
  const calendarDate = useWorkbench((s) => s.calendarDate)
  const focusCapture = useWorkbench((s) => s.focusCapture)
  const [sort, setSort] = useState<TaskSort>('manual')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [newProject, setNewProject] = useState(false)
  const [managedProjectId, setManagedProjectId] = useState<string | null>(null)
  const [todayLayout, setTodayLayout] = useState<'notes' | 'schedule'>('notes')
  const capture = useRef<QuickCaptureHandle>(null)
  const tasks = useTasks(),
    now = useClock(),
    today = dateKey(now)
  const title = plannerViews.find((v) => v.id === view)?.label ?? '全部任务'
  const noteView = view === 'all' || (view === 'today' && todayLayout === 'notes')
  // A checked item stays on its note so it can be reviewed or restored in place.
  const selectedTasks =
    noteView && view === 'today'
      ? tasks.filter((t) => t.scheduledDate === today || (!t.scheduledDate && t.dueDate === today))
      : selectTasks(tasks, view, today, null)
  const filtered = selectedTasks.filter(
    (t) =>
      `${t.title} ${t.description}`.toLowerCase().includes(query.toLowerCase()) &&
      (view !== 'all' ||
        statusFilter === 'all' ||
        (statusFilter === 'completed' ? t.status === 'completed' : t.status !== 'completed'))
  )
  const sorted = sortTasks(filtered, sort)
  const anytime = sortTasks(
    filtered.filter(
      (t) =>
        !t.startTime && (t.scheduledDate === today || (!t.scheduledDate && t.dueDate === today))
    ),
    'manual'
  )
  const scheduled = sortTasks(
    filtered.filter((t) => t.startTime && t.scheduledDate === today),
    'scheduled'
  )
  const plannedMinutes = scheduled.reduce(
    (total, t) =>
      total +
      (isLocalTime(t.startTime) && isLocalTime(t.endTime)
        ? Math.max(0, minutes(t.endTime) - minutes(t.startTime))
        : 0),
    0
  )
  const subtitle =
    view === 'today'
      ? formatDate(now)
      : view === 'upcoming'
        ? '安排接下来要推进的研究。'
        : view === 'calendar'
          ? '在同一日历中查看和安排所有项目的研究任务。'
          : view === 'completed'
            ? '回顾已经完成的研究工作。'
            : '待推进与已完成，都留在这里。'
  const defaults = {
    scheduledDate: view === 'today' ? today : view === 'calendar' ? calendarDate : null,
    projectId: null
  }
  const sortable =
    (view === 'all' || noteView) && sort === 'manual' && !query && statusFilter === 'all'
  const EmptyIcon = view === 'completed' ? CircleCheck : view === 'today' ? Sun : CalendarDays
  const emptyTitle = query
    ? '没有匹配的任务。'
    : view === 'today'
      ? '今天还没有安排研究任务。'
      : view === 'completed'
        ? '完成的研究工作会出现在这里。'
        : view === 'upcoming'
          ? '暂时没有未来任务。'
          : '这里还没有任务。'
  return (
    <main className="planner-workspace">
      <header className="workspace-header">
        <div>
          <div className="workspace-breadcrumb">
            研究计划<span>/</span>
            {title}
          </div>
          <div className="heading-line">
            <h1>{title}</h1>
          </div>
          <p>{subtitle}</p>
        </div>
        <div className="workspace-actions">
          <Button variant="primary" onClick={focusCapture}>
            <Plus size={16} />
            新建任务<kbd>Ctrl N</kbd>
          </Button>
        </div>
      </header>
      <div className="workspace-body">
        <QuickCapture
          ref={capture}
          defaults={defaults}
          context={
            view === 'today'
              ? 'Today Plan'
              : view === 'calendar'
                ? calendarLabel(calendarDate)
                : view === 'upcoming'
                  ? '创建后安排日期'
                  : '未安排日期'
          }
        />
        {view === 'calendar' ? (
          <CalendarView tasks={tasks} />
        ) : (
          <>
            <div className="list-toolbar">
              <span className="task-summary">
                {noteView
                  ? filtered.filter((t) => t.status !== 'completed').length
                  : filtered.length}{' '}
                项{view === 'completed' ? '已完成任务' : '待完成任务'}
                {view === 'all' && (
                  <>
                    <span className="text-divider">·</span>
                    {filtered.filter((t) => t.status === 'completed').length} 项已完成
                  </>
                )}
                {view === 'today' && plannedMinutes > 0 && (
                  <>
                    <span className="text-divider">·</span>
                    <Clock3 size={13} />
                    已安排 {durationLabel(plannedMinutes)}
                  </>
                )}
              </span>
              <div className="list-controls">
                {view === 'today' && (
                  <div className="plan-layout-switch" role="group" aria-label="今日计划布局">
                    <button
                      aria-pressed={todayLayout === 'notes'}
                      onClick={() => setTodayLayout('notes')}
                    >
                      <LayoutGrid size={14} />
                      便签
                    </button>
                    <button
                      aria-pressed={todayLayout === 'schedule'}
                      onClick={() => setTodayLayout('schedule')}
                    >
                      <Clock3 size={14} />
                      时间安排
                    </button>
                  </div>
                )}
                {view === 'all' && (
                  <select
                    className="task-status-filter"
                    aria-label="任务完成状态"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                  >
                    <option value="all">全部状态</option>
                    <option value="active">未完成</option>
                    <option value="completed">已完成</option>
                  </select>
                )}
                <label className="task-search">
                  <Search size={14} />
                  <input
                    aria-label="筛选任务"
                    placeholder="筛选任务"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </label>
                {view === 'all' && (
                  <label className="sort-select" title="任务排序">
                    <ArrowDownWideNarrow size={14} />
                    <select
                      aria-label="任务排序"
                      value={sort}
                      onChange={(e) => setSort(e.target.value as TaskSort)}
                    >
                      <option value="manual">手动排序</option>
                      <option value="scheduled">计划日期</option>
                      <option value="priority">优先级</option>
                      <option value="title">标题</option>
                      <option value="updated">最近修改</option>
                    </select>
                  </label>
                )}
              </div>
            </div>
            {noteView ? (
              <PlanNoteBoard
                tasks={sorted}
                projects={projects}
                filtered={!!query.trim() || statusFilter !== 'all'}
                sortable={sortable}
                showDate={view !== 'today'}
                onAdd={(id) => {
                  focusCapture()
                  capture.current?.focusProject(id)
                }}
                onManage={setManagedProjectId}
                onNewProject={() => setNewProject(true)}
              />
            ) : filtered.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">
                  <EmptyIcon size={25} strokeWidth={1.3} />
                </div>
                <h2>{emptyTitle}</h2>
                <p>
                  {query
                    ? '换一个关键词，或清空筛选。'
                    : view === 'completed'
                      ? '已完成的任务仍可查看或恢复。'
                      : view === 'upcoming'
                        ? '为接下来的研究安排一个时间。'
                        : view === 'today'
                          ? '给今天留一点空间，或者添加下一件想推进的事。'
                          : '记录一个研究想法、任务或待办事项。'}
                </p>
                {view !== 'completed' && !query && (
                  <Button onClick={focusCapture}>
                    <Plus size={15} />
                    新建任务
                  </Button>
                )}
              </div>
            ) : view === 'today' ? (
              <>
                <section className="task-section">
                  <div className="section-heading">
                    <h2>
                      未指定时间 <span>{anytime.length}</span>
                    </h2>
                    <span>今天需要推进的事</span>
                  </div>
                  {anytime.length ? (
                    <TaskList tasks={anytime} sortable />
                  ) : (
                    <p className="inline-empty">还没有未指定时间的任务。</p>
                  )}
                </section>
                <section className="task-section">
                  <div className="section-heading">
                    <h2>
                      时间安排 <span>{scheduled.length}</span>
                    </h2>
                    <span className="mono">本地时间 · 24小时制</span>
                  </div>
                  <ScheduleGrid dates={[now]} tasks={scheduled} compact />
                </section>
              </>
            ) : view === 'upcoming' || view === 'completed' ? (
              groupTasks(sorted, view === 'completed').map(([date, group]) => (
                <section className="task-section" key={date}>
                  <div className="section-heading">
                    <h2>
                      {calendarLabel(date, 'M月d日 EEEE')} <span>{group.length}</span>
                    </h2>
                  </div>
                  <TaskList
                    tasks={
                      view === 'upcoming'
                        ? sortTasks(group, 'scheduled')
                        : [...group].sort((a, b) =>
                            (b.completedAt ?? '').localeCompare(a.completedAt ?? '')
                          )
                    }
                    showDate={view === 'completed'}
                  />
                </section>
              ))
            ) : (
              <TaskList tasks={sorted} sortable={sortable} showDate />
            )}
            {sortable && sorted.length > 1 && (
              <p className="list-footnote">拖动手柄可调整顺序；也可按空格选中，再用方向键移动。</p>
            )}
          </>
        )}
      </div>
      {newProject && <ProjectDialog onClose={() => setNewProject(false)} />}
      {managedProjectId && (
        <ProjectDialog
          project={projects.find((project) => project.id === managedProjectId)}
          onClose={() => setManagedProjectId(null)}
        />
      )}
    </main>
  )
}
