import { Award, CalendarDays, Library } from 'lucide-react'
import { useLibrary } from '../../stores/library'
import { cn } from '../../lib/utils'

export function OutputsSidebar() {
  const { papers, outputYear, outputJournal, filterOutputs } = useLibrary()
  const publications = papers.filter((p) => p.collection === 'publication')
  const years = [...new Set(publications.map((p) => p.publishedDate.slice(0, 4)))].filter(Boolean).sort().reverse()
  const journals = [...new Set(publications.map((p) => p.journal))].filter(Boolean).sort((a, b) => a.localeCompare(b))
  return <>
    <nav aria-label="成果范围"><button className={cn('sidebar-link', outputYear === 'all' && outputJournal === 'all' && 'output-selected')} onClick={() => filterOutputs('all', 'all')}>
      <Award size={17} /><span>全部成果</span><small className="nav-count">{publications.length}</small>
    </button></nav>
    <div className="sidebar-section-label"><span>发表年份</span><CalendarDays size={13} /></div>
    <nav className="output-filters" aria-label="按发表年份筛选">
      {years.map((year) => <button key={year} className={cn('sidebar-link', outputYear === year && 'output-selected')} aria-pressed={outputYear === year}
        onClick={() => filterOutputs(outputYear === year ? 'all' : year, outputJournal)}><span>{year}</span><small className="nav-count">{publications.filter((p) => p.publishedDate.startsWith(year)).length}</small></button>)}
    </nav>
    <div className="sidebar-section-label"><span>发表期刊 / 会议</span><Library size={13} /></div>
    <nav className="output-filters" aria-label="按期刊筛选">
      {journals.map((journal) => <button key={journal} className={cn('sidebar-link', outputJournal === journal && 'output-selected')} aria-pressed={outputJournal === journal}
        onClick={() => filterOutputs(outputYear, outputJournal === journal ? 'all' : journal)} title={journal}><span className="truncate">{journal}</span><small className="nav-count">{publications.filter((p) => p.journal === journal).length}</small></button>)}
    </nav>
    <p className="sidebar-note">记录已经发表的研究。添加成果后，年份和期刊会自动出现在这里。</p>
  </>
}
