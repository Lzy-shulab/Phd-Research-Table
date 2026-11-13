import type { Paper } from '../shared/types'
import type { DesktopReadingResume } from '../shared/widget'

export function desktopReadingResume(papers: Paper[], saved: string): DesktopReadingResume | null {
  const paper = papers.filter(item => item.collection !== 'publication' && item.lastReadAt && (item.readPage > 0 || item.translatedReadPage > 0))
    .sort((a, b) => b.lastReadAt!.localeCompare(a.lastReadAt!))[0]
  if (!paper) return null
  let session: { paperId?: string; variant?: string } = {}
  try { session = JSON.parse(saved) ?? {} } catch { /* Earlier versions do not store a session. */ }
  const translated = paper.translationStatus === 'ready' && Boolean(paper.translatedPath) && paper.translatedReadPage > 0
    && (session.paperId === paper.id ? session.variant === 'translated' : paper.readPage === 0)
  return { paperId: paper.id, variant: translated ? 'translated' : 'source', page: Math.max(1, translated ? paper.translatedReadPage : paper.readPage) }
}

export function desktopPaperMatches(paper: Paper, query: string) {
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  const text = [paper.title, paper.authors, paper.originalName, paper.doi, ...paper.tags].join(' ').toLocaleLowerCase()
  return words.every(word => text.includes(word))
}
