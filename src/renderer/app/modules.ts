import { CalendarDays, BookOpenText, Award, Sun, CalendarCheck2, ListTodo, SlidersHorizontal, Send, ChartNoAxesCombined } from 'lucide-react'
import type { Section, PlannerView } from '../../shared/types'
export const modules = [
  { id: 'planner', label: '研究计划', icon: CalendarCheck2, description: '安排今天真正要推进的研究。' },
  { id: 'literature', label: '文献阅读', icon: BookOpenText, description: '按期刊整理文献，阅读原文与中英对照。' },
  { id: 'outputs', label: '科研成果', icon: Award, description: '记录已发表的论文与成果。' },
  { id: 'submissions', label: '论文投稿', icon: Send, description: '记录投稿进展与返修期限。' },
  { id: 'reports', label: '研究报表', icon: ChartNoAxesCombined, description: '回顾阅读、任务、成果与津贴。' },
  { id: 'settings', label: '设置', icon: SlidersHorizontal, description: '管理文件保存位置。' }
] satisfies { id: Section; label: string; icon: typeof CalendarDays; description: string }[]
export const plannerViews = [
  { id: 'today', label: '今日计划', icon: Sun },
  { id: 'calendar', label: '日历', icon: CalendarDays },
  { id: 'all', label: '全部任务', icon: ListTodo }
] satisfies { id: PlannerView; label: string; icon: typeof CalendarDays }[]
