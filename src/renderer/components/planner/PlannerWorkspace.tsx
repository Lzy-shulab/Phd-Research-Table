import { useRef, useState } from 'react'
import {
  ArrowDownWideNarrow,
  CalendarDays,
  CircleCheck,
  Clock3,
  LayoutGrid,
  List,
  Plus,
  Search,
  Sun,
  CalendarClock,
  PauseCircle,
  Check
} from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { useTasks } from '../../hooks/use-tasks'
import { useClock } from '../../hooks/use-clock'
import { calendarLabel, dateKey, formatDate } from '../../lib/dates'
import { groupTasks, isOverdueTask, selectTasks, sortTasks, todayPlan, type TaskSort } from '../../../domain/planner'
import { plannerViews } from '../../app/modules'
import { Button } from '../ui/button'
import { QuickCapture, type QuickCaptureHandle } from './QuickCapture'
import { PlanNoteBoard } from './PlanNoteBoard'
import { TaskList } from './TaskList'
import { CalendarView } from './CalendarView'
import { ScheduleGrid } from './ScheduleGrid'
import { ProjectDialog } from '../projects/ProjectDialog'
import { useInterface } from '../../stores/interface'
import { ImportantCountdowns } from './ImportantCountdowns'
import { useReducedMotion } from 'motion/react'
import { gsap } from 'gsap'
import { useGSAP } from '@gsap/react'

gsap.registerPlugin(useGSAP)

export function PlannerWorkspace() {
  const view = useWorkbench((s) => s.view)
  const projects = useWorkbench((s) => s.projects)
  const calendarDate = useWorkbench((s) => s.calendarDate)
  const focusCapture = useWorkbench((s) => s.focusCapture)
  const [sort, setSort] = useState<TaskSort>('focus')
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [focusScope, setFocusScope] = useState<'today' | 'tomorrow' | 'due' | 'overdue' | null>(null)
  const [newProject, setNewProject] = useState(false)
  const [managedProjectId, setManagedProjectId] = useState<string | null>(null)
  const [todayLayout, setTodayLayout] = useState<'list' | 'schedule'>('list')
  const plannerDisplay = useInterface((state) => state.preferences.plannerDisplay)
  const setPlannerDisplay = useInterface((state) => state.update)
  const capture = useRef<QuickCaptureHandle>(null)
  const workspace = useRef<HTMLElement>(null)
  const reducedMotion = useReducedMotion()
  useGSAP(() => {
    if (reducedMotion) return
    gsap.timeline({ defaults: { duration: 0.26, ease: 'power2.out' } })
      .from('.workspace-header > div', { y: 6, opacity: 0 })
      .from('.quick-capture', { y: 5, opacity: 0 }, '-=0.18')
      .from('.overdue-panel, .all-task-overview, .today-scope-summary', { y: 4, opacity: 0, stagger: 0.035 }, '-=0.16')
  }, { scope: workspace, dependencies: [view, reducedMotion], revertOnUpdate: true })
  const tasks = useTasks(),
    now = useClock(),
    today = dateKey(now)
  const tomorrowDate = new Date(now)
  tomorrowDate.setDate(tomorrowDate.getDate() + 1)
  const tomorrow = dateKey(tomorrowDate)
  const weekDate = new Date(now)
  weekDate.setDate(weekDate.getDate() + 7)
  const nextWeek = dateKey(weekDate)
  const plan = todayPlan(tasks, today)
  const matchesQuery = (task: (typeof tasks)[number]) =>
    `${task.title} ${task.description}`.toLowerCase().includes(query.toLowerCase())
  const overdue = sortTasks(plan.overdue.filter(matchesQuery), 'scheduled')
  const todayScheduled = sortTasks(plan.scheduled.filter(matchesQuery), 'scheduled')
  const todayDueOnly = sortTasks(plan.dueOnly.filter(matchesQuery), 'manual')
  const todayCompleted = sortTasks(plan.completed.filter(matchesQuery), 'manual')
  const todayHasWork = plan.scheduled.length + plan.dueOnly.length + plan.completed.length + plan.overdue.length > 0
  const title = plannerViews.find((v) => v.id === view)?.label ?? '全部任务'
  const noteView = view === 'all' && plannerDisplay === 'notes'
  const selectedTasks = view === 'today'
    ? [...plan.scheduled, ...plan.dueOnly, ...plan.completed]
    : selectTasks(tasks, view, today, null)
  const filtered = selectedTasks.filter(
    (t) =>
      matchesQuery(t) &&
      (view !== 'all' || !focusScope || (t.status !== 'completed' && (focusScope === 'today' ? (!t.deferredUntil || t.deferredUntil <= today) && (t.scheduledDate === today || t.dueDate === today) : focusScope === 'tomorrow' ? (!t.deferredUntil || t.deferredUntil <= tomorrow) && (t.scheduledDate === tomorrow || t.dueDate === tomorrow) : focusScope === 'overdue' ? isOverdueTask(t, today) : !!t.dueDate && t.dueDate >= today && t.dueDate <= nextWeek))) &&
      (view !== 'all' ||
        statusFilter === 'all' ||
        (statusFilter === 'completed' ? t.status === 'completed' : t.status !== 'completed'))
  )
  const sorted = sortTasks(filtered, sort)
  const activeCount = tasks.filter((task) => task.status !== 'completed').length
  const completedCount = tasks.length - activeCount
  const overdueCount = tasks.filter((task) => isOverdueTask(task, today)).length
  const todayCount = tasks.filter((task) => task.status !== 'completed' && (!task.deferredUntil || task.deferredUntil <= today) && (task.scheduledDate === today || task.dueDate === today)).length
  const tomorrowCount = tasks.filter((task) => task.status !== 'completed' && (!task.deferredUntil || task.deferredUntil <= tomorrow) && (task.scheduledDate === tomorrow || task.dueDate === tomorrow)).length
  const dueSoonCount = tasks.filter((task) => task.status !== 'completed' && !!task.dueDate && task.dueDate >= today && task.dueDate <= nextWeek).length
  const anytime = todayScheduled.filter((task) => !task.startTime)
  const scheduled = todayScheduled.filter((task) => !!task.startTime)
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
  const sortable = view === 'all' && sort === 'manual' && !query && statusFilter === 'all'
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
    <main className="planner-workspace" ref={workspace}>
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
      </header>
      <div className="workspace-body">
        {view === 'all' && <ImportantCountdowns />}
        {view === 'all' && <section className="all-task-overview" aria-label="任务概览">
          <div className="all-task-counts"><span><strong>{activeCount}</strong> 待推进</span><span><strong>{completedCount}</strong> 已完成</span></div>
          <div className="all-task-focus"><strong>接下来关注</strong><div>
            {overdueCount > 0 && <button className="focus-overdue" aria-pressed={focusScope === 'overdue'} onClick={() => setFocusScope(focusScope === 'overdue' ? null : 'overdue')}><span>逾期</span><small>{overdueCount} 项</small></button>}
            <button className="focus-today" aria-pressed={focusScope === 'today'} onClick={() => setFocusScope(focusScope === 'today' ? null : 'today')}><span>今天</span><small>{todayCount} 项</small></button>
            <button className="focus-tomorrow" aria-pressed={focusScope === 'tomorrow'} onClick={() => setFocusScope(focusScope === 'tomorrow' ? null : 'tomorrow')}><span>明天</span><small>{tomorrowCount} 项</small></button>
            <button className="focus-due" aria-pressed={focusScope === 'due'} onClick={() => setFocusScope(focusScope === 'due' ? null : 'due')}><span>七日内截止</span><small>{dueSoonCount} 项</small></button>
          </div>{focusScope && <button className="focus-clear" onClick={() => setFocusScope(null)}>清除聚焦</button>}</div>
        </section>}
        <QuickCapture
          ref={capture}
          defaults={defaults}
          context={
            view === 'today'
              ? '今日计划'
              : view === 'calendar'
                ? calendarLabel(calendarDate)
                : view === 'upcoming'
                  ? '创建后安排日期'
                  : '未安排日期'
          }
        />
        {view === 'today' && overdue.length > 0 && (
          <section className="overdue-panel" aria-labelledby="overdue-heading">
            <div className="overdue-heading"><div><CalendarClock size={17} /><h2 id="overdue-heading">逾期待处理</h2><span>{overdue.length}</span></div><p>完成、重新安排，或暂缓到明天。</p></div>
            <div className="overdue-list">
              {overdue.map((task) => <article key={task.id} className="overdue-row">
                <button className="overdue-title" onClick={() => useWorkbench.getState().selectTask(task.id)}><strong>{task.title}</strong><span>{task.scheduledDate && `原计划 ${calendarLabel(task.scheduledDate)}`}{task.scheduledDate && task.dueDate ? ' · ' : ''}{task.dueDate && `截止 ${calendarLabel(task.dueDate)}`}</span></button>
                <div className="overdue-actions">
                  <Button variant="ghost" className="action-positive" onClick={() => void useWorkbench.getState().completeTask(task.id)}><Check size={14} />完成</Button>
                  <Button variant="ghost" className="action-companion" onClick={() => useWorkbench.getState().editTask(task.id, { scheduledDate: task.scheduledDate && task.scheduledDate < today ? today : task.scheduledDate, dueDate: task.dueDate && task.dueDate < today ? today : task.dueDate, deferredUntil: null }, true)}><CalendarDays size={14} />日期改到今天</Button>
                  <Button variant="ghost" className="action-warm" onClick={() => useWorkbench.getState().editTask(task.id, { deferredUntil: tomorrow }, true)}><PauseCircle size={14} />暂缓到明天</Button>
                </div>
              </article>)}
            </div>
          </section>
        )}
        {view === 'today' && todayHasWork && <div className="today-scope-summary" aria-label="今日计划概览"><span><strong>{plan.scheduled.length + plan.dueOnly.length + plan.completed.length}</strong> 今日任务</span>{plan.completed.length > 0 && <span><strong>{plan.completed.length}</strong> 已完成</span>}{plan.dueOnly.length > 0 && <span><strong>{plan.dueOnly.length}</strong> 仅今天截止</span>}{plan.overdue.length > 0 && <span><strong>{plan.overdue.length}</strong> 另有逾期</span>}</div>}
        {view === 'calendar' ? (
          <CalendarView tasks={tasks} />
        ) : (
          <>
            {(view !== 'today' || todayHasWork || query) && <div className="list-toolbar">
              {view !== 'today' && <span className="task-summary">
                {view === 'all' ? `当前显示 ${filtered.length} 项任务` : `${filtered.length} 项${view === 'completed' ? '已完成任务' : '任务'}`}
              </span>}
              <div className="list-controls">
                {view === 'today' && (
                  <div className="plan-layout-switch" role="group" aria-label="今日计划布局">
                    <button
                      aria-pressed={todayLayout === 'list'}
                      onClick={() => setTodayLayout('list')}
                    >
                      <LayoutGrid size={14} />
                      任务列表
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
                {view === 'all' && <div className="plan-layout-switch" role="group" aria-label="任务显示方式"><button aria-pressed={plannerDisplay === 'list'} onClick={() => void setPlannerDisplay({ plannerDisplay: 'list' })}><List size={14} />任务列表</button><button aria-pressed={plannerDisplay === 'notes'} onClick={() => void setPlannerDisplay({ plannerDisplay: 'notes' })}><LayoutGrid size={14} />项目卡片</button></div>}
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
                  <label className="sort-select" title={noteView ? '项目卡片内的任务排序' : '任务排序'}>
                    <ArrowDownWideNarrow size={14} />
                    <select
                      aria-label={noteView ? '项目卡片内的任务排序' : '任务排序'}
                      value={sort}
                      onChange={(e) => setSort(e.target.value as TaskSort)}
                    >
                      <option value="focus">近期优先</option>
                      <option value="manual">{noteView ? '项目内手动排序' : '手动排序'}</option>
                      <option value="scheduled">计划日期</option>
                      <option value="priority">优先级</option>
                      <option value="title">标题</option>
                      <option value="updated">最近修改</option>
                    </select>
                  </label>
                )}
              </div>
            </div>}
            {view === 'today' ? (
              <>
                {filtered.length === 0 && overdue.length === 0 && (
                  <div className="empty-state today-empty">
                    <div className="empty-icon"><Sun size={25} strokeWidth={1.3} /></div>
                    <h2>{query ? '没有匹配的今日任务。' : '今天还没有安排研究任务。'}</h2>
                    <p>{query ? '换一个关键词，或清空筛选。' : '先记下一件要做的事，或从全部任务中安排到今天。'}</p>
                    <div className="today-empty-actions">
                      {query ? <Button onClick={() => setQuery('')}>清除搜索</Button> : <>
                        <Button variant="primary" onClick={focusCapture}><Plus size={15} />添加今日任务</Button>
                        <Button onClick={() => useWorkbench.getState().navigate('all', null)}>查看全部任务</Button>
                      </>}
                    </div>
                  </div>
                )}
                {todayLayout === 'list' && todayScheduled.length > 0 && (
                  <section className="task-section today-task-section">
                    <div className="section-heading"><h2>今天要做 <span>{todayScheduled.length}</span></h2><span>按时间查看具体行动</span></div>
                    <TaskList tasks={todayScheduled} />
                  </section>
                )}
                {todayLayout === 'schedule' && todayScheduled.length > 0 && <>
                  {anytime.length > 0 && <section className="task-section today-task-section"><div className="section-heading"><h2>未指定时间 <span>{anytime.length}</span></h2></div><TaskList tasks={anytime} /></section>}
                  {scheduled.length > 0 && <section className="task-section today-task-section"><div className="section-heading"><h2>时间安排 <span>{scheduled.length}</span></h2><span className="mono">本地时间 · 24小时制</span></div><ScheduleGrid dates={[now]} tasks={scheduled} compact /></section>}
                </>}
                {todayDueOnly.length > 0 && <section className="task-section today-task-section"><div className="section-heading"><h2>今天截止，尚未安排到今天 <span>{todayDueOnly.length}</span></h2></div><TaskList tasks={todayDueOnly} showDate /></section>}
                {todayCompleted.length > 0 && <details className="today-collapsible"><summary>已完成 <strong>{todayCompleted.length}</strong></summary><TaskList tasks={todayCompleted} showDate /></details>}
              </>
            ) : noteView ? (
              <PlanNoteBoard
                tasks={sorted}
                allTasks={selectedTasks}
                projects={projects}
                filtered={!!query.trim() || statusFilter !== 'all'}
                sortable={sortable}
                showDate
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
                        : '记录一个研究想法、任务或待办事项。'}
                </p>
                {query && <Button onClick={() => setQuery('')}>清除搜索</Button>}
                {view !== 'completed' && !query && (
                  <Button onClick={focusCapture}>
                    <Plus size={15} />
                    新建任务
                  </Button>
                )}
              </div>
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
