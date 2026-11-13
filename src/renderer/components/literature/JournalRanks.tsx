import { journalKey, isRankedJournal } from '../../../shared/journal-ranks'
import { useLibrary } from '../../stores/library'

export function JournalRanks({ journal }: { journal: string }) {
  const ranks = useLibrary(state => state.journalRanks)
  const entry = ranks?.entries[journalKey(journal)]
  if (!ranks?.enabled || !entry || !isRankedJournal(journal)) return null
  const title = `easyScholar · 查询于 ${new Date(entry.checkedAt).toLocaleDateString()}\n${entry.labels.map(label => `${label.name} ${label.value}`).join(' · ')}`
  return entry.labels.length ? <span className="journal-ranks" aria-label={`${journal} 期刊分区`} title={title}>
    {entry.labels.map(label => <span key={label.name}>{label.name} {label.value}</span>)}
  </span> : <span className="journal-rank-empty" title={title}>未查到分区</span>
}
