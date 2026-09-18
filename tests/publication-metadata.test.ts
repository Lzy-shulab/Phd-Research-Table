import { describe, expect, it, vi } from 'vitest'
import type { LocalPaperMetadata, PublicationInput } from '../src/shared/types'
import { publicationSchema } from '../src/domain/research'
import { mergePublicationMetadata } from '../src/domain/publication-metadata'
vi.mock('electron', () => ({ session: {} }))
import { crossrefBibliography, previewPublicationMetadata } from '../src/main/library/metadata'

const local: LocalPaperMetadata = { title: 'Learning Hyperspectral Image Reconstruction with Spatial Priors', authors: 'PDF Author', year: '2024', journal: 'PDF Journal', doi: '', pageCount: 12, titleReliable: true }
const bibliography = { title: [local.title], DOI: '10.1234/spatial', author: [{ given: 'Alice', family: 'Smith' }], 'container-title': ['Journal of Imaging'], published: { 'date-parts': [[2024]] } }
const noOverrides = { title: '', doi: '' }
describe('Publication metadata preview', () => {
  it('fills article fields while retaining year-only and month-only publication precision', async () => {
    const preview = await previewPublicationMetadata(local, true, noOverrides, async () => ({ message: { items: [bibliography] } }))
    expect(preview).toMatchObject({ status: 'ready', source: 'Crossref · 标题匹配', fields: { title: local.title, authors: 'Alice Smith', journal: 'Journal of Imaging', doi: '10.1234/spatial', publishedDate: '2024' } })
    expect(crossrefBibliography({ ...bibliography, published: { 'date-parts': [[2024, 9]] } })?.publishedDate).toBe('2024-09')
    expect(crossrefBibliography({ ...bibliography, published: { 'date-parts': [[2024, 9, 7]] } })?.publishedDate).toBe('2024-09-07')
    expect(crossrefBibliography({ ...bibliography, published: { 'date-parts': [[2024, 13]] } })?.publishedDate).toBe('')
  })
  it('keeps PDF evidence offline and when the network fails or omits an author', async () => {
    const fetcher = vi.fn()
    const offline = await previewPublicationMetadata({ ...local, publishedDate: '2024-07' }, false, noOverrides, fetcher)
    expect(fetcher).not.toHaveBeenCalled()
    expect(offline).toMatchObject({ source: 'PDF', fields: { authors: 'PDF Author', publishedDate: '2024-07' } })
    const failed = await previewPublicationMetadata(local, true, noOverrides, async () => { throw new Error('HTTP 429') })
    expect(failed.fields).toMatchObject({ authors: local.authors, journal: local.journal, publishedDate: '2024', doi: '' })
    expect(failed.message).toContain('HTTP 429')
    const missing = await previewPublicationMetadata(local, true, noOverrides, async () => ({ message: { items: [{ ...bibliography, author: [] }] } }))
    expect(missing.fields.authors).toBe('PDF Author')
  })
  it('protects edits made while a lookup is running, including intentionally empty DOI fields and notes', () => {
    const current: PublicationInput = { title: local.title, authors: 'My author correction', journal: 'My journal', publishedDate: '2024', doi: '', casPartition: '1区', jcrQuartile: 'Q1', honors: ['esi-hot'], notes: 'Private contribution notes' }
    const fields = { title: 'Retrieved title', authors: 'Network author', journal: 'Network journal', publishedDate: '2024-02-01', doi: '10.1234/spatial' }
    expect(mergePublicationMetadata(current, fields, new Set(['authors', 'doi', 'publishedDate']))).toEqual({ ...current, title: fields.title, journal: fields.journal })
  })
  it('accepts known precision and still rejects invalid publication dates without affecting task dates', () => {
    const fields = { title: local.title, authors: local.authors, journal: local.journal, doi: '', casPartition: '', jcrQuartile: '', notes: '' }
    for (const publishedDate of ['2024', '2024-02', '2024-02-29']) expect(publicationSchema.safeParse({ ...fields, publishedDate }).success).toBe(true)
    for (const publishedDate of ['', '24', '2024-13', '2023-02-29', '2024-02-30']) expect(publicationSchema.safeParse({ ...fields, publishedDate }).success).toBe(false)
  })
})
