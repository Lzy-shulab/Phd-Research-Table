import { describe, expect, it } from 'vitest'
import { desktopPaperMatches, desktopReadingResume } from '../src/domain/desktop-reading'
import type { Paper } from '../src/shared/types'

const paper = (values: Partial<Paper> = {}) => ({ id: 'one', title: 'Hyperspectral Image Fusion', authors: 'Lin Yu', originalName: 'fusion.pdf', doi: '10.1/fusion', tags: ['遥感'], collection: 'library', readPage: 3, translatedReadPage: 7, translationStatus: 'ready', translatedPath: 'translated.pdf', lastReadAt: '2026-11-03T14:00:00Z', ...values }) as Paper

describe('desktop reading shortcuts', () => {
  it('searches case-insensitive titles, authors and tags with all query words', () => {
    expect(desktopPaperMatches(paper(), 'FUSION lin')).toBe(true)
    expect(desktopPaperMatches(paper(), '遥感')).toBe(true)
    expect(desktopPaperMatches(paper(), 'fusion transformer')).toBe(false)
    expect(desktopPaperMatches(paper(), ' ')).toBe(true)
  })
  it('resumes the latest paper at the saved version-specific position', () => {
    const papers = [paper(), paper({ id: 'older', lastReadAt: '2026-11-02T14:00:00Z' })]
    expect(desktopReadingResume(papers, JSON.stringify({ paperId: 'one', variant: 'translated' }))).toEqual({ paperId: 'one', variant: 'translated', page: 7 })
    expect(desktopReadingResume(papers, JSON.stringify({ paperId: 'one', variant: 'source' }))).toEqual({ paperId: 'one', variant: 'source', page: 3 })
  })
  it('uses existing page records before a saved session exists and ignores publications and unopened papers', () => {
    expect(desktopReadingResume([paper()], '')).toEqual({ paperId: 'one', variant: 'source', page: 3 })
    expect(desktopReadingResume([paper({ readPage: 0 })], '')).toEqual({ paperId: 'one', variant: 'translated', page: 7 })
    expect(desktopReadingResume([paper({ collection: 'publication' }), paper({ id: 'unread', lastReadAt: null })], '')).toBeNull()
  })
  it('continues the source if a previously read translation is no longer ready', () => {
    expect(desktopReadingResume([paper({ translationStatus: 'failed', translatedPath: null })], JSON.stringify({ paperId: 'one', variant: 'translated' }))).toEqual({ paperId: 'one', variant: 'source', page: 3 })
  })
})
