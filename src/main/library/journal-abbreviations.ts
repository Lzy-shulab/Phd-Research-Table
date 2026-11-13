import { app } from 'electron'
import type { LibraryFolder, Paper } from '../../shared/types'
import { requestJournalAbbreviations } from '../assistant/workbench-codex'
import type { LibraryRepository } from '../database/repositories/library'

const settingsKey = 'library.journal-abbreviations.v1'
const normalize = (value: string) => value.trim().toLowerCase().replace(/^the\s+/, '').replace(/\s+/g, ' ')
const journalLike = /\b(?:journal of|transactions on|letters on|reviews in|proceedings of)\b/i
const conventional: Record<string, string> = {
  'ieee transactions on geoscience and remote sensing': 'TGRS',
  'ieee transactions on image processing': 'TIP',
  'ieee transactions on pattern analysis and machine intelligence': 'TPAMI',
  'ieee journal of selected topics in applied earth observations and remote sensing': 'JSTARS',
  'ieee geoscience and remote sensing letters': 'GRSL',
  'isprs journal of photogrammetry and remote sensing': 'ISPRS JPRS',
  'international journal of applied earth observation and geoinformation': 'JAG',
  'remote sensing of environment': 'RSE',
  'information fusion': 'Inf. Fusion'
}
const shortLabel = (name: string) => name.replace(/^(?:The |IEEE )/i, '').match(/[a-z][a-z0-9]*/gi)
  ?.filter(word => !/^(?:of|on|and|in|for|the|to)$/i.test(word)).map(word => word[0]!.toUpperCase()).join('') ?? name

export class JournalAbbreviations {
  private readonly attempted = new Set<string>()
  private pending = false
  private stopped = false
  private cached: Record<string, string> = {}
  constructor(private readonly repo: LibraryRepository, private readonly changed: () => void) {
    try { this.cached = JSON.parse(repo.setting(settingsKey, '{}')) as Record<string, string> }
    catch { /* Use existing labels if the cache is unavailable. */ }
  }
  private candidates(folders: LibraryFolder[], papers: Paper[]) {
    const journals = new Set(papers.map(paper => normalize(paper.journal)).filter(Boolean))
    return folders.filter(folder => folder.name.length > 14 && (journals.has(normalize(folder.name)) ||
      !!conventional[normalize(folder.name)] || journalLike.test(folder.name)))
  }
  labels(folders: LibraryFolder[], papers: Paper[]) {
    return Object.fromEntries(this.candidates(folders, papers).map(folder => {
      const key = normalize(folder.name)
      return [folder.id, conventional[key] ?? this.cached[key] ?? shortLabel(folder.name)]
    }))
  }
  async refresh() {
    if (this.pending || this.stopped || process.env.WORKBENCH_DISABLE_JOURNAL_CODEX === '1') return
    const names = [...new Set(this.candidates(this.repo.folders(), this.repo.papers()).map(folder => folder.name))]
      .filter(name => { const key = normalize(name); return !conventional[key] && !this.cached[key] && !this.attempted.has(key) })
    if (!names.length) return
    this.pending = true
    try {
      for (let index = 0; index < names.length && !this.stopped; index += 30) {
        const batch = names.slice(index, index + 30)
        for (const name of batch) this.attempted.add(normalize(name))
        const labels = await requestJournalAbbreviations(app.getPath('temp'), batch)
        if (this.stopped) return
        for (const { name, abbreviation } of labels) {
          const label = abbreviation.trim()
          if (batch.includes(name) && /^[\p{L}\p{N}][\p{L}\p{N}.& -]{1,23}$/u.test(label))
            this.cached[normalize(name)] = label
        }
        this.repo.setSetting(settingsKey, JSON.stringify(this.cached))
        this.changed()
      }
    } catch { /* A local short label is available while Codex is offline. */ }
    finally { this.pending = false }
  }
  stop() { this.stopped = true }
}
