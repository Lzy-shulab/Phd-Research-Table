import { z } from 'zod'
import type { LocalPaperMetadata } from '../shared/types'
import { isPublicationDate } from './validation'

export const localMetadataSchema = z.object({
  title: z.string().max(1000), authors: z.string().max(2000), journal: z.string().max(500), year: z.string().max(10),
  doi: z.string().max(500), pageCount: z.number().int().min(1).max(100000), titleReliable: z.boolean(),
  publishedDate: z.string().max(10).refine((value) => !value || isPublicationDate(value)).optional()
}).strict()
export interface PdfTextSpan { text: string; x: number; y: number; height: number }
export interface PdfMetadataEvidence {
  title: string; authors: string; journal: string; publishedDate: string; doi: string
  pageHeight: number; spans: PdfTextSpan[]; pageCount: number; originalName: string
}
// eslint-disable-next-line no-control-regex -- PDF metadata may contain NUL and control separators.
const clean = (text: string) => text.replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
export const validPaperTitle = (title: string) => title.length >= 12 && title.length <= 1000 && /\p{L}/u.test(title)
  && !/^(untitled|microsoft|word\b|latex\b|adobe\b|full\s*text|document\b|template\b|article in press|accepted manuscript|manuscript\b|science ?direct|contents lists|available online)/i.test(title)
  && !/^[A-Z]:[\\/]|\.pdf$/i.test(title)
function textLines(spans: PdfTextSpan[]) {
  const rows: { y: number; height: number; spans: PdfTextSpan[]; text: string }[] = []
  for (const span of [...spans].filter((item) => item.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((item) => Math.abs(item.y - span.y) <= Math.max(2.2, span.height * 0.18))
    if (!row) { row = { y: span.y, height: span.height, spans: [], text: '' }; rows.push(row) }
    row.height = Math.max(row.height, span.height); row.spans.push(span)
  }
  for (const row of rows) row.text = clean(row.spans.sort((a, b) => a.x - b.x).map((span) => span.text).join(' '))
  return rows.sort((a, b) => b.y - a.y)
}
export function cleanDoi(input: string) {
  const doi = input.trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '').replace(/^doi\s*:\s*/i, '').replace(/[.,;]+$/, '')
  return /^10\.\d{4,9}\/[^\s"<>]+$/i.test(doi) ? doi.slice(0, 500) : ''
}
function authorLine(text: string) {
  const normalized = clean(text.replace(/[\d*†‡⁎✉]/g, '').replace(/\b(?:and|&|orcid)\b/gi, ','))
  if (!normalized || normalized.length > 500 || /university|department|laborator|institute|academy|school|college|@|http|received|accepted|abstract|keywords|member|fellow|©|copyright|journal|volume|editor|corresponding|author manuscript/i.test(normalized)) return ''
  const names = normalized.split(/[,;，、]/).map((name) => name.trim()).filter(Boolean)
  const looksLikeName = (name: string) => /^[\p{Script=Han}]{2,5}$/u.test(name) || /^[\p{Lu}][\p{L}.'’-]*(?:\s+[\p{Lu}][\p{L}.'’-]*){1,5}$/u.test(name)
  return names.length > 0 && names.every(looksLikeName) ? names.join(', ') : ''
}
export function inferLocalMetadata(evidence: PdfMetadataEvidence): LocalPaperMetadata {
  const lines = textLines(evidence.spans)
  const top = lines.filter((line) => line.y > evidence.pageHeight * 0.42)
  let title = clean(evidence.title), titleReliable = validPaperTitle(title)
  let titleLastY = Number.POSITIVE_INFINITY
  if (!titleReliable) {
    const candidates = top.filter((line) => validPaperTitle(line.text) && !/^(IEEE TRANSACTIONS|JOURNAL OF|REMOTE SENSING OF ENVIRONMENT|INFORMATION FUSION|PROCEEDINGS OF|NATURE COMMUNICATIONS|RESEARCH ARTICLE|REVIEW ARTICLE|ARTICLE INFO|https?:|doi\b|arxiv:)/i.test(line.text))
    const heading = [...candidates].sort((a, b) => b.height - a.height || b.text.length - a.text.length)[0]
    if (heading && heading.height >= 11 && heading.text.length >= 15) {
      const index = lines.indexOf(heading)
      const joined = [heading]
      for (let previous = index - 1; previous >= 0 && joined.length < 5; previous--) {
        const row = lines[previous]!, next = joined[0]!
        if (Math.abs(row.height - heading.height) > heading.height * 0.12 || row.y - next.y > heading.height * 2.2 || !validPaperTitle(row.text)) break
        joined.unshift(row)
      }
      for (let following = index + 1; following < lines.length && joined.length < 5; following++) {
        const row = lines[following]!, previous = joined[joined.length - 1]!
        if (Math.abs(row.height - heading.height) > heading.height * 0.12 || previous.y - row.y > heading.height * 2.2 || !validPaperTitle(row.text)) break
        joined.push(row)
      }
      title = joined.map((row) => row.text).join(' ').replace(/-\s+(?=[a-z])/g, '')
      titleLastY = joined[joined.length - 1]!.y
      titleReliable = validPaperTitle(title)
    }
  } else {
    const first = top.find((line) => title.toLowerCase().includes(line.text.toLowerCase()) && line.text.length > 15)
    if (first) titleLastY = first.y
  }
  if (!titleReliable) title = clean(evidence.originalName.replace(/\.pdf$/i, '').replaceAll('_', ' ')).slice(0, 1000)
  const infoAuthors = clean(evidence.authors)
  let authors = infoAuthors && !/^(unknown|user|admin|author|authors|adobe|microsoft|latex|elsevier|springer)$/i.test(infoAuthors) ? infoAuthors.slice(0, 2000) : ''
  if (!authors && Number.isFinite(titleLastY)) {
    const following = lines.filter((line) => line.y < titleLastY && line.y > titleLastY - 95).slice(0, 4)
    authors = following.map((line) => authorLine(line.text)).filter(Boolean).slice(0, 2).join(', ').slice(0, 2000)
  }
  const full = lines.map((line) => line.text).join('\n')
  const labelled = /(?:doi\s*:\s*|https?:\/\/(?:dx\.)?doi\.org\/)(10\.\d{4,9}\/[^\s"<>]+)/i.exec(full)?.[1]
  const doi = cleanDoi(evidence.doi) || cleanDoi(labelled ?? '') || cleanDoi(/\b10\.\d{4,9}\/[^\s"<>]+/i.exec(full)?.[0] ?? '')
  // PDF creation/modification timestamps are intentionally not used as publication dates.
  let year = /^(19\d{2}|20\d{2})/.exec(evidence.publishedDate)?.[1] ?? ''
  if (!year) year = lines.filter((line) => /©|copyright|published|available online|journal|\bvol(?:ume)?\b/i.test(line.text)).map((line) => /\b(19\d{2}|20\d{2})\b/.exec(line.text)?.[1]).find(Boolean) ?? ''
  let journal = clean(evidence.journal).slice(0, 500)
  if (!journal) {
    const explicit = lines.find((line) => /^(?:IEEE TRANSACTIONS ON|IEEE JOURNAL OF|JOURNAL OF|INTERNATIONAL JOURNAL OF)/i.test(line.text))?.text
    if (explicit) journal = explicit.replace(/,?\s*(?:VOL(?:UME)?\.?|\d+\s*\().*$/i, '').trim().slice(0, 500)
    else {
      const printed = lines.map((line) => /^([\p{L}][\p{L}\s&:—-]{8,120}?)\s+\d+\s*\((19\d{2}|20\d{2})\)/u.exec(line.text)).find(Boolean)
      if (printed) { journal = printed[1]!.trim(); year ||= printed[2]! }
    }
  }
  const dateText = /^\d{4}(?:-\d{2}(?:-\d{2})?)?/.exec(evidence.publishedDate)?.[0] ?? ''
  return { title: title.slice(0, 1000), authors, journal, year, doi, pageCount: evidence.pageCount, titleReliable,
    publishedDate: isPublicationDate(dateText) ? dateText : '' }
}
export function plainMetadataText(value: unknown) {
  if (typeof value !== 'string') return ''
  return clean(value.replace(/<[^>]*>/g, '').replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, (entity) => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ' })[entity] ?? entity))
}
export function normalizedTitle(value: string) { return value.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim() }
export function titleSimilarity(first: string, second: string) {
  const a = normalizedTitle(first), b = normalizedTitle(second)
  if (!a || !b) return 0
  if (a === b) return 1
  const aa = new Set(a.split(' ')), bb = new Set(b.split(' '))
  const tokens = 2 * [...aa].filter((token) => bb.has(token)).length / (aa.size + bb.size)
  const bigrams = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, index) => text.slice(index, index + 2)))
  const ab = bigrams(a), ba = bigrams(b)
  return 0.6 * tokens + 0.4 * (2 * [...ab].filter((token) => ba.has(token)).length / Math.max(1, ab.size + ba.size))
}
