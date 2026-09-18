import { motion } from 'motion/react'
import { Circle, Layers3 } from 'lucide-react'
import { useSubmissions } from '../../stores/submissions'
import { cn } from '../../lib/utils'

export function SubmissionsSidebar() {
  const { scope, setScope, submissions } = useSubmissions()
  const stages = [...new Set(submissions.map((submission) => submission.currentStage || '暂无状态'))]
  const items = [
    { id: null, label: '全部投稿记录', count: submissions.length, icon: Layers3 },
    ...stages.map((stage) => ({ id: stage, label: stage, count: submissions.filter((item) => (item.currentStage || '暂无状态') === stage).length, icon: Circle }))
  ]
  return <><nav className="planner-nav" aria-label="当前投稿状态筛选">{items.map((item) => <button key={item.id ?? 'all'} className={cn('sidebar-link', scope === item.id && 'selected')} aria-current={scope === item.id ? 'page' : undefined} onClick={() => setScope(item.id)}>
    {scope === item.id && <motion.span className="nav-selection" layoutId="submission-scope" />}<item.icon size={16} strokeWidth={1.6} /><span>{item.label}</span><small className="nav-count">{item.count}</small>
  </button>)}</nav><p className="sidebar-note">状态名称由你按期刊系统填写；转投其他期刊时新建一条记录，保留上一轮经历。</p></>
}
