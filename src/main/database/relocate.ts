import { constants, createReadStream, existsSync } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, rm, unlink } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { DomainError } from '../../domain/errors'
import type { PaperCollection } from '../../shared/types'
import { openDatabase, type DatabaseConnection } from './db'
import { LibraryRepository } from './repositories/library'
import { samePath, StoragePaths } from '../library/storage-paths'

export interface RelocationReport {
  sourceDatabase: string
  databasePath: string
  directories: Record<PaperCollection, string>
  papers: number
  copiedFiles: number
  records: Record<string, number>
  retainedSources: string[]
}
const inside = (root: string, path: string) => {
  const rel = relative(resolve(root), resolve(path))
  return !!rel && !isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
}
async function hash(path: string) {
  const digest = createHash('sha256')
  for await (const bytes of createReadStream(path)) digest.update(bytes)
  return digest.digest('hex')
}
async function manifest(directory: string, prefix = ''): Promise<{ name: string; digest: string }[]> {
  const entries = await readdir(join(directory, prefix), { withFileTypes: true })
  const result: { name: string; digest: string }[] = []
  for (const entry of entries) {
    const name = join(prefix, entry.name)
    if (entry.isSymbolicLink()) throw new DomainError('VALIDATION', '文献目录包含符号链接，需先整理为普通文件后再迁移。')
    if (entry.isDirectory()) result.push(...await manifest(directory, name))
    else if (entry.isFile()) result.push({ name, digest: await hash(join(directory, name)) })
    else throw new DomainError('VALIDATION', '文献目录包含不支持自动迁移的文件类型。')
  }
  return result.sort((a, b) => a.name.localeCompare(b.name))
}
const stable = (rows: unknown[]) => JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())
const tableNames = (connection: DatabaseConnection) => (connection.sqlite.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((row) => row.name)
const rows = (connection: DatabaseConnection, table: string) => connection.sqlite.prepare(`SELECT * FROM "${table.replaceAll('"', '""')}"`).all()
async function removeDatabase(path: string) {
  // Exact database-owned files only; never delete the enclosing user-selected directory.
  for (const suffix of ['', '-wal', '-shm']) await unlink(`${path}${suffix}`).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
}

export async function relocateDatabase(source: DatabaseConnection, options: {
  directory: string
  migrationsFolder: string
  dataRoot?: string
  activate: (connection: DatabaseConnection) => void
}): Promise<RelocationReport> {
  if (!isAbsolute(options.directory) || (options.dataRoot && !isAbsolute(options.dataRoot))) throw new DomainError('VALIDATION', '请选择完整的保存文件夹地址。')
  const destinationDirectory = resolve(options.directory)
  const destination = join(destinationDirectory, 'workbench.sqlite')
  const sourcePath = resolve(source.path)
  const repo = new LibraryRepository(source.db)
  const paths = new StoragePaths(repo, source.path)
  const papers = repo.papers()
  const directories = options.dataRoot ? {
    library: join(options.dataRoot, '文献'), publication: join(options.dataRoot, '科研成果'), arxiv: join(options.dataRoot, 'Arxiv Daily')
  } : paths.snapshot().directories
  const records = Object.fromEntries(tableNames(source).filter((name) => !name.startsWith('__')).map((name) => [name, rows(source, name).length]))
  const report: RelocationReport = { sourceDatabase: sourcePath, databasePath: destination, directories, papers: papers.length, copiedFiles: 0, records, retainedSources: [] }
  if (samePath(sourcePath, destination)) {
    if (options.dataRoot) throw new DomainError('VALIDATION', '工作台数据库已在此位置，请分别调整 PDF 目录。')
    return report
  }
  if (existsSync(destination)) throw new DomainError('VALIDATION', '该文件夹已有 workbench.sqlite，请选择空文件夹，已有数据库不会被覆盖。')
  if (source.sqlite.pragma('integrity_check', { simple: true }) !== 'ok' || (source.sqlite.pragma('foreign_key_check') as unknown[]).length)
    throw new DomainError('DATABASE', '原数据库未通过完整性检查，迁移未开始。')
  const copied: { source: string; sourceParent: string; paperId: string; target: string; ownerRoot: string; files: { name: string; digest: string }[] }[] = []
  const temporary = join(destinationDirectory, `.workbench-transfer-${randomUUID()}.sqlite`)
  let next: DatabaseConnection | undefined
  let ownedDatabase = false
  let activated = false
  try {
    await mkdir(destinationDirectory, { recursive: true })
    if (!(await lstat(destinationDirectory)).isDirectory()) throw new Error('目标不是普通文件夹。')
    if (options.dataRoot) {
      for (const directory of Object.values(directories)) await mkdir(directory, { recursive: true })
      for (const paper of papers) {
        const original = dirname(paths.file(paper, 'source'))
        if (paper.translatedPath) paths.file(paper, 'translated')
        const target = paths.paperDirectory(paper, directories[paper.collection])
        if (samePath(original, target)) continue
        if (inside(original, target) || inside(target, original)) throw new DomainError('VALIDATION', '原目录与目标目录不能相互包含。')
        if (existsSync(target)) throw new DomainError('VALIDATION', '目标文献文件夹已存在，迁移不会覆盖其中内容。')
        if ((await lstat(original)).isSymbolicLink()) throw new DomainError('VALIDATION', '暂不自动迁移链接形式的文献文件夹。')
        const files = await manifest(original)
        if (!files.some((file) => file.name === 'source.pdf') || (paper.translatedPath && !files.some((file) => file.name === 'bilingual.pdf')))
          throw new DomainError('NOT_FOUND', '有文献原文或译文缺失，请先恢复文件后再迁移。')
        await mkdir(dirname(target), { recursive: true })
        await mkdir(target)
        const item = { source: original, sourceParent: dirname(original), paperId: paper.id, target, ownerRoot: directories[paper.collection], files }
        copied.push(item)
        for (const file of files) {
          const to = join(target, file.name)
          if (!inside(target, to)) throw new DomainError('FORBIDDEN', '文件路径超出文献目录。')
          await mkdir(dirname(to), { recursive: true })
          await copyFile(join(original, file.name), to, constants.COPYFILE_EXCL)
          if (await hash(to) !== file.digest) throw new Error('复制后的文件校验不一致。')
          report.copiedFiles++
        }
      }
    }
    await source.sqlite.backup(temporary)
    const staged = openDatabase(temporary, options.migrationsFolder)
    try {
      const stagedRepo = new LibraryRepository(staged.db)
      const settings = options.dataRoot ? Object.fromEntries((['library', 'publication', 'arxiv'] as const).map((kind) => [`storage.${kind}`, JSON.stringify({ current: directories[kind], previous: [] })])) : paths.exportSettings()
      staged.db.transaction(() => {
        for (const [key, value] of Object.entries(settings)) stagedRepo.setSetting(key, value)
        if (options.dataRoot) for (const paper of papers) {
          const directory = paths.paperDirectory(paper, directories[paper.collection])
          staged.sqlite.prepare('UPDATE papers SET source_path = ?, translated_path = ? WHERE id = ?').run(join(directory, 'source.pdf'), paper.translatedPath ? join(directory, 'bilingual.pdf') : null, paper.id)
        }
      })
      for (const table of tableNames(source).filter((name) => !['papers', 'app_settings'].includes(name))) {
        if (stable(rows(source, table)) !== stable(rows(staged, table))) throw new Error(`迁移校验失败：${table}`)
      }
      const expectedPapers = papers.map((paper) => options.dataRoot ? { ...paper,
        sourcePath: join(paths.paperDirectory(paper, directories[paper.collection]), 'source.pdf'),
        translatedPath: paper.translatedPath ? join(paths.paperDirectory(paper, directories[paper.collection]), 'bilingual.pdf') : null
      } : paper)
      if (stable(expectedPapers) !== stable(stagedRepo.papers())) throw new Error('文献记录迁移校验失败。')
      const expectedSettings = new Map((rows(source, 'app_settings') as { key: string; value: string }[]).map((row) => [row.key, row.value]))
      for (const [key, value] of Object.entries(settings)) expectedSettings.set(key, value)
      if (stable([...expectedSettings].map(([key, value]) => ({ key, value }))) !== stable(rows(staged, 'app_settings'))) throw new Error('工作台设置迁移校验失败。')
      if (staged.sqlite.pragma('integrity_check', { simple: true }) !== 'ok' || (staged.sqlite.pragma('foreign_key_check') as unknown[]).length) throw new Error('新数据库完整性检查未通过。')
      staged.sqlite.pragma('wal_checkpoint(TRUNCATE)')
    } finally { staged.close() }
    await copyFile(temporary, destination, constants.COPYFILE_EXCL)
    ownedDatabase = true
    next = openDatabase(destination, options.migrationsFolder)
    options.activate(next)
    activated = true
  } catch (error) {
    if (!activated) {
      next?.close()
      if (ownedDatabase) await removeDatabase(destination).catch(() => undefined)
      for (const item of copied) if (inside(item.ownerRoot, item.target)) await rm(item.target, { recursive: true, force: true }).catch(() => undefined)
    }
    if (error instanceof DomainError) throw error
    throw new DomainError('UNAVAILABLE', `迁移未完成，原数据保留：${error instanceof Error ? error.message : '请检查磁盘连接和文件夹权限。'}`)
  } finally { await removeDatabase(temporary).catch(() => undefined) }
  // The caller has switched the locator and closed the source connection before any cleanup.
  for (const item of copied) {
    try {
      if (stable(await manifest(item.source)) !== stable(item.files)) throw new Error('Source changed')
      // Re-check the exact recorded UUID directory immediately before recursive removal.
      if (basename(item.source) !== item.paperId || !samePath(join(item.sourceParent, item.paperId), item.source) || (await lstat(item.source)).isSymbolicLink()) throw new Error('Unexpected source directory')
      await rm(resolve(item.source), { recursive: true })
    } catch { report.retainedSources.push(item.source) }
  }
  try { await removeDatabase(sourcePath) } catch { report.retainedSources.push(sourcePath) }
  return report
}
