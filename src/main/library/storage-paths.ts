import { dirname, isAbsolute, join, resolve } from 'node:path'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import type { Paper, PaperCollection, PaperVariant, StorageSnapshot } from '../../shared/types'
import type { LibraryRepository } from '../database/repositories/library'

const pathSchema = z.string().min(1).refine(isAbsolute)
const locationSchema = z.object({ current: pathSchema, previous: z.array(pathSchema) })
export const samePath = (a: string, b: string) => process.platform === 'win32'
  ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b)
export class StoragePaths {
  protected readonly defaults: Record<PaperCollection, string>
  constructor(protected readonly repo: LibraryRepository, protected readonly databasePath: string) {
    const root = join(dirname(databasePath), 'library')
    this.defaults = { library: root, publication: join(root, 'Publications'), arxiv: join(root, 'Arxiv Daily') }
  }
  protected location(kind: PaperCollection) {
    const saved = this.repo.setting(`storage.${kind}`, '')
    if (!saved) return { current: this.defaults[kind], previous: [] }
    try { return locationSchema.parse(JSON.parse(saved)) }
    catch { throw new DomainError('UNAVAILABLE', '保存目录设置无法读取，请检查本地数据。') }
  }
  directory(kind: PaperCollection) { return this.location(kind).current }
  snapshot(): StorageSnapshot {
    return { directories: { library: this.directory('library'), publication: this.directory('publication'), arxiv: this.directory('arxiv') }, databasePath: this.databasePath }
  }
  exportSettings() {
    return Object.fromEntries((['library', 'publication', 'arxiv'] as const).map((kind) => {
      const location = this.location(kind)
      return [`storage.${kind}`, JSON.stringify({ current: location.current, previous: [...new Set([...location.previous, this.defaults[kind]])] })]
    }))
  }
  paperDirectory(paper: Pick<Paper, 'id' | 'collection' | 'collectedDate'>, root = this.directory(paper.collection)) {
    if (!z.uuid().safeParse(paper.id).success) throw new DomainError('FORBIDDEN', '文献标识无效。')
    if (paper.collection === 'arxiv') {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paper.collectedDate)) throw new DomainError('FORBIDDEN', '下载日期无效。')
      return join(root, paper.collectedDate, paper.id)
    }
    return join(root, paper.id)
  }
  file(paper: Paper, variant: PaperVariant) {
    const path = variant === 'translated' ? paper.translatedPath : paper.sourcePath
    if (!path) throw new DomainError('NOT_FOUND', '中英对照版尚未生成。')
    const location = this.location(paper.collection)
    const roots = [this.defaults[paper.collection], location.current, ...location.previous]
    if (!roots.some((root) => samePath(path, join(this.paperDirectory(paper, root), variant === 'translated' ? 'bilingual.pdf' : 'source.pdf'))))
      throw new DomainError('FORBIDDEN', '文献路径不在托管目录中。')
    return path
  }
}
