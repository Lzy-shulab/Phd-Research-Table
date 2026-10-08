import { useEffect, useMemo, useRef, useState } from 'react'
import { BookOpen, CheckSquare, Search, Send, Trophy } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { useLibrary } from '../../stores/library'
import { useSubmissions } from '../../stores/submissions'
import { Dialog } from '../ui/dialog'

type SearchResult = {
  id: string
  type: 'task' | 'paper' | 'publication' | 'submission'
  title: string
  detail: string
}

const labels = { task: '任务', paper: '文献', publication: '成果', submission: '投稿' }
const icons = { task: CheckSquare, paper: BookOpen, publication: Trophy, submission: Send }

export function GlobalSearch() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const input = useRef<HTMLInputElement>(null)
  const tasks = useWorkbench((state) => state.tasks)
  const projects = useWorkbench((state) => state.projects)
  const papers = useLibrary((state) => state.papers)
  const submissions = useSubmissions((state) => state.submissions)
  useEffect(() => {
    const show = () => { setOpen(true); setQuery(''); requestAnimationFrame(() => input.current?.focus()) }
    window.addEventListener('workbench:command-palette-request', show)
    return () => window.removeEventListener('workbench:command-palette-request', show)
  }, [])
  const results = useMemo<SearchResult[]>(() => {
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return []
    const includes = (value: string) => value.toLocaleLowerCase().includes(needle)
    return [
      ...tasks.filter((task) => includes(`${task.title} ${task.description} ${task.milestone}`)).map((task) => ({
        id: task.id, type: 'task' as const, title: task.title,
        detail: projects.find((project) => project.id === task.projectId)?.name ?? '未归属项目'
      })),
      ...papers.filter((paper) => includes(`${paper.title} ${paper.authors} ${paper.journal} ${paper.doi} ${paper.notes}`)).map((paper) => ({
        id: paper.id, type: paper.collection === 'publication' ? 'publication' as const : 'paper' as const,
        title: paper.title, detail: [paper.authors, paper.year || paper.publishedDate, paper.journal].filter(Boolean).join(' · ')
      })),
      ...submissions.filter((submission) => includes(`${submission.title} ${submission.journal} ${submission.manuscriptId} ${submission.notes}`)).map((submission) => ({
        id: submission.id, type: 'submission' as const, title: submission.title,
        detail: [submission.journal, submission.currentStage || '暂无阶段'].filter(Boolean).join(' · ')
      }))
    ].slice(0, 40)
  }, [query, tasks, projects, papers, submissions])
  const go = (result: SearchResult) => {
    const workbench = useWorkbench.getState()
    if (result.type === 'task') {
      workbench.setSection('planner'); workbench.navigate('all'); workbench.selectTask(result.id)
    } else if (result.type === 'paper') {
      workbench.setSection('literature')
      const paper = useLibrary.getState().papers.find((item) => item.id === result.id)
      if (paper?.sourcePath) useLibrary.getState().openPaper(result.id)
      else requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('workbench:open-literature-record', { detail: result.id })))
    } else if (result.type === 'publication') {
      workbench.setSection('outputs')
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('workbench:open-publication-record', { detail: result.id })))
    } else {
      workbench.setSection('submissions')
      requestAnimationFrame(() => window.dispatchEvent(new CustomEvent('workbench:open-submission-record', { detail: result.id })))
    }
    setOpen(false)
  }
  return <Dialog open={open} onOpenChange={setOpen} title="全局搜索" description="搜索任务、文献、科研成果和投稿记录。">
    <div className="global-search-input"><Search size={18} /><input ref={input} aria-label="全局搜索" placeholder="输入标题、作者、期刊、稿号或任务内容" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
    <div className="global-search-results" role="listbox" aria-label="搜索结果">
      {!query.trim() ? <p className="global-search-empty">输入关键词开始搜索。可随时按 Ctrl+K 返回这里。</p>
        : results.length ? results.map((result) => { const Icon = icons[result.type]; return <button key={`${result.type}:${result.id}`} role="option" onClick={() => go(result)}><Icon size={17} /><span><strong>{result.title}</strong><small>{result.detail || '暂无补充信息'}</small></span><em>{labels[result.type]}</em></button> })
          : <p className="global-search-empty">没有匹配的记录。清除关键词可重新搜索。</p>}
    </div>
  </Dialog>
}
