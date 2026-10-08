import type { Paper, Project, Task } from '../../../shared/types'
import type { ReportSnapshot } from '../../../shared/reports'
import { reportData, formatDuration } from '../../../domain/reports'
import { workdayTarget } from '../../../domain/work-calendar'
import { ReportRing } from './ReportCharts'
import { ReportPeriodPicker } from './ReportPeriodPicker'
import { useReportPeriod } from '../../hooks/use-report-period'

export function ReportGoalCard({ metric, snapshot, tasks, papers, projects }: {
  metric: 'papers' | 'tasks' | 'checkinMinutes'; snapshot: ReportSnapshot; tasks: Task[]; papers: Paper[]; projects: Project[]
}) {
  const { selection, setSelection, range } = useReportPeriod()
  const data = reportData(snapshot, tasks, papers, [], projects, range)
  const label = metric === 'papers' ? '读完论文' : metric === 'tasks' ? '完成任务' : '打卡时长'
  const value = metric === 'papers' ? data.read.length : metric === 'tasks' ? data.completed.length : data.checkinMinutes
  const target = workdayTarget(range)
  const goal = metric === 'checkinMinutes' ? target.minutes : snapshot.settings.goals[selection.period][metric]
  const goalText = metric === 'checkinMinutes'
    ? target.known ? `目标 ${formatDuration(goal)} · ${target.days} 个工作日 × 12 小时` : '该年份节假日资料未收录，目标待计算'
    : goal ? `目标 ${goal} ${metric === 'papers' ? '篇' : '项'}` : '未设置目标'
  return <article className="report-goal" aria-label={label}>
    <h2>{label}</h2>
    <ReportPeriodPicker label={label} selection={selection} onChange={setSelection} />
    <div className="report-goal-value">
      <ReportRing label={label} value={value} goal={goal} unknown={metric === 'checkinMinutes' && !target.known} />
      <div><strong>{metric === 'checkinMinutes' ? formatDuration(value) : <>{value} <small>{metric === 'papers' ? '篇' : '项'}</small></>}</strong><span>{goalText}</span></div>
    </div>
  </article>
}
