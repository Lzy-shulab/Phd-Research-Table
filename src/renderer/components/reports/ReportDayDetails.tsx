import { motion, useReducedMotion } from 'motion/react'
import { ArrowUpRight, BookOpen, CheckCheck, Clock3, Pencil, Trash2 } from 'lucide-react'
import type { Paper, Task } from '../../../shared/types'
import type { CheckinEntry } from '../../../shared/reports'
import { checkinDayParts, formatDuration } from '../../../domain/reports'
import { calendarDayMark } from '../../../domain/work-calendar'
import { useWorkbench } from '../../stores/workbench'
import { useLibrary } from '../../stores/library'
import { Button } from '../ui/button'

export function ReportDayDetails({ date, papers = [], tasks = [], checkins, edit, remove }: {
  date: string; papers?: Paper[]; tasks?: Task[]; checkins?: CheckinEntry[]
  edit?: (entry: CheckinEntry) => void; remove?: (id: string) => void
}) {
  const reduced = useReducedMotion(), mark = calendarDayMark(date)
  const minutes = checkins?.flatMap(checkinDayParts).filter(part => part.date === date).reduce((sum, part) => sum + part.minutes, 0) ?? 0
  const openPaper = (paper: Paper) => {
    useWorkbench.getState().setSection('literature')
    if (paper.sourcePath) useLibrary.getState().openPaper(paper.id)
    else requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('workbench:open-literature-record', { detail: paper.id })))
  }
  return <motion.div key={date} className="report-day-detail" initial={reduced ? false : { opacity: 0.6, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
    <header><h3><time dateTime={date}>{Number(date.slice(5, 7))}月{Number(date.slice(8))}日</time><span>{new Date(`${date}T12:00:00`).toLocaleDateString('zh-CN', { weekday: 'long' })}</span></h3><span className={`report-day-kind is-${mark.kind}`}>{mark.label}</span></header>
    <p className="report-day-summary" aria-live="polite">{checkins ? `当天投入 ${formatDuration(minutes)}` : `读完 ${papers.length} 篇 · 完成 ${tasks.length} 项`}</p>
    <div className="report-day-items">
      {papers.map(paper => <button className="report-source-row" key={paper.id} onClick={() => openPaper(paper)}><BookOpen size={16} /><span><strong>{paper.title}</strong><small>文献阅读{paper.authors ? ` · ${paper.authors}` : ''}</small></span><ArrowUpRight size={14} /></button>)}
      {tasks.map(task => <button className="report-source-row" key={task.id} onClick={() => { const store = useWorkbench.getState(); store.setSection('planner'); store.navigate('all'); store.selectTask(task.id) }}><CheckCheck size={16} /><span><strong>{task.title}</strong><small>研究计划 · 已完成</small></span><ArrowUpRight size={14} /></button>)}
      {checkins?.map(entry => {
        const part = checkinDayParts(entry).find(item => item.date === date)
        return <div className="report-checkin-row" key={entry.id}><Clock3 size={16} /><div><strong>{entry.startTime && entry.endTime ? `${entry.date !== date ? '前日 ' : ''}${entry.startTime} — ${entry.endsNextDay && entry.date === date ? '次日 ' : ''}${entry.endTime}` : '原有时长记录'}</strong><span>{formatDuration(part?.minutes ?? 0)}{entry.endsNextDay ? ' · 当天计入' : ''}</span>{entry.notes && <p>{entry.notes}</p>}</div><div className="report-row-actions"><Button variant="ghost" aria-label={`编辑打卡 ${entry.date}`} onClick={() => edit?.(entry)}><Pencil size={14} /></Button><Button variant="ghost" aria-label={`移除打卡 ${entry.date}`} onClick={() => remove?.(entry.id)}><Trash2 size={14} /></Button></div></div>
      })}
      {!(checkins ? checkins.length : papers.length + tasks.length) && <p className="report-day-empty">{checkins ? '这一天还没有打卡。' : '这一天还没有阅读或任务完成记录。'}</p>}
    </div>
  </motion.div>
}
