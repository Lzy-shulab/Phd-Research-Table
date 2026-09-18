import { app, dialog, nativeImage, type BrowserWindow } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { DomainError } from '../../domain/errors'
import type { InterfacePatch, InterfaceSnapshot } from '../../shared/interface'
import type { SettingsRepository } from '../database/repositories/settings'

// Backgrounds are application-owned copies; document paths and original uploads stay untouched.
export class InterfaceService {
  private importing = false
  constructor(private readonly repo: () => SettingsRepository, private readonly window: () => BrowserWindow | null) {}
  private directory() { return join(app.getPath('userData'), 'interface-backgrounds') }
  async snapshot(): Promise<InterfaceSnapshot> {
    const preferences = this.repo().getInterface()
    let backgroundDataUrl: string | null = null
    if (preferences.backgroundFile) {
      try {
        const path = join(this.directory(), preferences.backgroundFile)
        if ((await stat(path)).size <= 8 * 1024 * 1024) backgroundDataUrl = `data:image/jpeg;base64,${(await readFile(path)).toString('base64')}`
      } catch { /* Missing optional wallpaper falls back to the built-in background. */ }
    }
    return { preferences, backgroundDataUrl }
  }
  async update(patch: InterfacePatch) {
    const preferences = { ...this.repo().getInterface(), ...patch }
    if (preferences.background === 'custom' && !(await this.snapshot()).backgroundDataUrl)
      throw new DomainError('VALIDATION', '请先上传一张背景图片。')
    this.repo().setInterface(preferences)
    return preferences
  }
  async upload(): Promise<InterfaceSnapshot | null> {
    const window = this.window()
    if (!window) throw new DomainError('UNAVAILABLE', '工作区窗口不可用。')
    if (this.importing) throw new DomainError('VALIDATION', '正在保存背景，请稍候。')
    this.importing = true
    try {
      const selected = await dialog.showOpenDialog(window, {
        title: '选择软件背景图片', properties: ['openFile'],
        filters: [{ name: '背景图片', extensions: ['jpg', 'jpeg', 'png'] }]
      })
      const source = selected.filePaths[0]
      if (selected.canceled || !source) return null
      const info = await stat(source)
      if (!info.isFile() || !['.jpg', '.jpeg', '.png'].includes(extname(source).toLowerCase()))
        throw new DomainError('VALIDATION', '请选择 JPG 或 PNG 图片。')
      if (info.size > 20 * 1024 * 1024) throw new DomainError('VALIDATION', '背景图片最大支持 20 MB，请选择较小的图片。')
      const image = nativeImage.createFromBuffer(await readFile(source))
      const size = image.getSize()
      if (image.isEmpty() || size.width < 1 || size.height < 1)
        throw new DomainError('VALIDATION', '这张图片无法读取，请换一张图片。')
      const ratio = Math.min(1, 2560 / size.width, 2560 / size.height)
      const fitted = ratio < 1 ? image.resize({ width: Math.round(size.width * ratio), height: Math.round(size.height * ratio), quality: 'best' }) : image
      const bytes = fitted.toJPEG(88)
      if (bytes.length > 8 * 1024 * 1024) throw new DomainError('VALIDATION', '图片处理后仍过大，请选择另一张背景。')
      const backgroundFile = `${createHash('sha256').update(bytes).digest('hex')}.jpg`
      await mkdir(this.directory(), { recursive: true })
      await writeFile(join(this.directory(), backgroundFile), bytes)
      this.repo().setInterface({ ...this.repo().getInterface(), background: 'custom', backgroundFile, backgroundName: basename(source).slice(0, 255) })
      return this.snapshot()
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', '背景图片未能保存，原有外观已保留。请检查文件与磁盘空间。')
    } finally { this.importing = false }
  }
}
