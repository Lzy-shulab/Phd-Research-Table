import { dialog, shell, type BrowserWindow } from 'electron'
import { randomUUID } from 'node:crypto'
import { mkdir, stat, unlink, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { DomainError } from '../../domain/errors'
import type { PaperCollection } from '../../shared/types'
import type { LibraryRepository } from '../database/repositories/library'
import { samePath, StoragePaths } from './storage-paths'

const labels = { library: '文献 PDF', publication: '科研成果 PDF', arxiv: 'Arxiv Daily' }

export class StorageService extends StoragePaths {
  constructor(repo: LibraryRepository, databasePath: string,
    private readonly window: () => BrowserWindow | null) {
    super(repo, databasePath)
  }
  async choose(kind: PaperCollection, canChange: () => void) {
    const window = this.window()
    if (!window) throw new DomainError('UNAVAILABLE', '工作区窗口不可用。')
    canChange()
    const result = await dialog.showOpenDialog(window, { title: `选择${labels[kind]}保存文件夹`,
      defaultPath: this.directory(kind), properties: ['openDirectory', 'createDirectory'] })
    if (result.canceled || !result.filePaths[0]) return null
    const selected = result.filePaths[0]
    if (!isAbsolute(selected)) throw new DomainError('VALIDATION', '请选择完整的文件夹地址。')
    const directory = resolve(selected)
    // A unique, exclusively-created probe checks actual writes, including network drives.
    const probe = join(directory, `.workbench-write-${randomUUID()}`)
    let created = false
    try {
      if (!(await stat(directory)).isDirectory()) throw new Error('请选择文件夹。')
      await writeFile(probe, '', { flag: 'wx' }); created = true
      await unlink(probe); created = false
    } catch {
      throw new DomainError('UNAVAILABLE', '该文件夹无法写入，请检查磁盘连接、剩余空间和文件夹权限。原设置已保留。')
    } finally { if (created) await unlink(probe).catch(() => undefined) }
    canChange()
    const location = this.location(kind)
    if (!samePath(location.current, directory)) {
      const previous = [...new Set([...location.previous, location.current])]
      // Store the current path and history together so old PDFs remain authorized after restart.
      this.repo.setSetting(`storage.${kind}`, JSON.stringify({ current: directory, previous }))
    }
    return this.snapshot()
  }
  async reveal(kind: PaperCollection | 'database') {
    const directory = kind === 'database' ? dirname(this.databasePath) : this.directory(kind)
    try {
      await mkdir(directory, { recursive: true })
      const error = await shell.openPath(directory)
      if (error) throw new Error(error)
    } catch { throw new DomainError('UNAVAILABLE', '无法打开保存文件夹，请检查磁盘连接和文件夹权限。') }
  }
}
