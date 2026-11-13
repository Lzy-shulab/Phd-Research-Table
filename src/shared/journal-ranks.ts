export interface JournalRank {
  journal: string
  checkedAt: string
  labels: { name: string; value: string }[]
}
export interface JournalRanksSnapshot {
  enabled: boolean
  configured: boolean
  refreshing: boolean
  error: string
  entries: Record<string, JournalRank>
}
export const journalKey = (journal: string) => journal.trim().replace(/\s+/g, ' ').toLowerCase()
export const isRankedJournal = (journal: string) => !!journal.trim() && !/^(?:arxiv(?:\b|:)|未分类|未知期刊)/i.test(journal.trim())
