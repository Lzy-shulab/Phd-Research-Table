import { app, BrowserWindow, ipcMain, Menu, nativeImage, screen, Tray, session, clipboard, shell, dialog, powerMonitor, type Session, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { z, ZodError } from 'zod'
import { DomainError } from '../../domain/errors'
import { readWidgetPreferences, widgetLayout, widgetPatchSchema, widgetPreferencesSchema } from '../../domain/widget'
import type { DesktopNotice, WidgetSnapshot } from '../../shared/widget'
import { desktopPanelTitles, desktopRailWidth, desktopRailTabWidth, desktopRailHeight, type DesktopPanel } from '../../shared/widget'
import type { Result, Task } from '../../shared/types'
import type { SettingsRepository } from '../database/repositories/settings'
import { WidgetWeatherService } from './weather'
import { releaseWhenIdle } from '../desktop-idle'
import { GpuMonitorService } from './gpu-service'
import { gpuMonitorOrigin } from '../../shared/gpu'
import { gpuOwnersInputSchema } from '../../domain/gpu'
import { GpuIdleAlerts } from './gpu-alerts'
import { CodexUsageService } from './codex-usage-service'
import { CpolarSshSyncService } from './cpolar-ssh-sync'
import { collectRemoteGpu } from './gpu-collector'
import { WaterReminder } from './water-reminder'
import { DesktopNotices } from './desktop-notices'
import { GpuLogin, gpuLoginSchema } from './gpu-login'

interface WidgetRuntime {
  settings: () => SettingsRepository
  mainWindow: () => BrowserWindow | null
  openMain: () => void
  rendererUrl: string | undefined
  trustedUrl: (url: string) => boolean
  relocating: () => boolean
  tasks: () => Task[]
}
export class DesktopWidgetController {
  window: BrowserWindow | null = null
  private rail: BrowserWindow | null = null
  private panel: DesktopPanel = 'checkin'
  private panelRequest = 0
  private tray: Tray | null = null
  private compact = false
  private scale = 0.75
  private startupError: string | null = null
  private returnToPanel = false
  private weather: WidgetWeatherService
  private gpu: GpuMonitorService
  private gpuLogin: GpuLogin
  private sshSync: CpolarSshSyncService
  private codex: CodexUsageService
  private gpuAlerts: GpuIdleAlerts
  private readonly waterReminder: WaterReminder
  private readonly notices: DesktopNotices
  private gpuConnection: Promise<Session> | undefined
  private gpuWebsite: BrowserWindow | null = null
  private channels: string[] = []
  private readonly startupManaged = app.isPackaged && !process.env.WORKBENCH_DATA_DIR && process.platform === 'win32'
  constructor(private readonly runtime: WidgetRuntime) {
    this.weather = new WidgetWeatherService(runtime.settings)
    this.notices = new DesktopNotices(runtime.settings, runtime.tasks, runtime.relocating,
      reveal => { this.notify(); if (reveal && this.rail?.isVisible()) this.rail.moveTop() })
    this.handle('widget:acknowledge', async rawId => {
      const id = z.string().max(350).parse(rawId)
      const notice = this.notices.pending().find(item => item.id === id)
      if (notice?.kind === 'checkin') await this.selectPanel('checkin', false)
      this.notices.acknowledge(id)
      return this.snapshot()
    }, 'desktop')
    this.waterReminder = new WaterReminder(runtime.settings, runtime.relocating,
      () => { this.notify(); if (this.rail?.isVisible()) this.rail.moveTop() },
      () => { void this.selectPanel('checkin', false).catch(() => { this.window?.show(); this.window?.focus() }) })
    this.handle('widget:water-reminder', action => {
      this.waterReminder.update(z.enum(['restart', 'stop']).parse(action))
      this.notify()
      return this.snapshot()
    }, 'desktop')
    this.codex = new CodexUsageService(snapshot => {
      for (const target of [this.rail, this.window]) if (target && !target.isDestroyed()) target.webContents.send('codex:usage-changed', snapshot)
    })
    this.handle('codex:usage', force => this.codex.read(z.boolean().optional().parse(force)))
    this.gpuAlerts = new GpuIdleAlerts(runtime.settings, () => { void this.selectPanel('gpu', false).catch(() => { this.window?.show(); this.window?.focus() }) }, () => this.broadcastGpu(), item => this.notices.publish(item))
    this.gpuLogin = new GpuLogin(() => this.gpuSession(), runtime.settings)
    this.gpu = new GpuMonitorService((async (input, init) => this.gpuLogin.request(String(input), init)) as typeof fetch, snapshot => {
      this.gpuAlerts.observe(snapshot)
      this.broadcastGpu()
    }, collectRemoteGpu)
    this.sshSync = new CpolarSshSyncService(join(process.env.WORKBENCH_DATA_DIR || homedir(), '.ssh', 'config'),
      () => this.gpu.readCpolar(true), () => this.broadcastGpu(), state => {
        if (!state.checkedAt || this.gpu.snapshot().auth === 'required') return
        this.notices.publish({ id: `cpolar:${state.checkedAt}`, kind: 'cpolar', at: Date.parse(state.checkedAt),
          title: state.error ? 'Cpolar 更新失败' : state.result === 'updated' ? 'Cpolar 已更新' : 'Cpolar 已是最新',
          detail: state.error ?? state.address ?? state.host })
      })
    this.handle('gpu:ssh-sync', async () => { await this.sshSync.refresh(true); return this.gpuSnapshot() })
    this.handle('gpu:snapshot', async force => { if (process.env.WORKBENCH_DISABLE_GPU_AUTO !== '1') await this.gpu.read(z.boolean().optional().parse(force)); return this.gpuSnapshot() })
    this.handle('gpu:alerts', enabled => { this.gpuAlerts.setEnabled(z.boolean().parse(enabled)); this.broadcastGpu(); return this.gpuSnapshot() })
    this.handle('gpu:owners', async input => {
      const { deviceId, names } = gpuOwnersInputSchema.parse(input)
      await this.gpu.setOwners(deviceId, names)
      if (this.gpuWebsite && !this.gpuWebsite.isDestroyed()) this.gpuWebsite.webContents.reload()
      return this.gpuSnapshot()
    })
    this.handle('gpu:website', () => this.openGpuWebsite())
    this.handle('gpu:login', async input => {
      await this.gpuLogin.save(gpuLoginSchema.parse(input))
      await this.gpu.reconnect()
      if (process.env.WORKBENCH_DISABLE_GPU_AUTO !== '1') this.sshSync.start()
      return this.gpuSnapshot()
    }, 'panel')
    this.handle('gpu:forget-login', () => { this.gpuLogin.forget(); this.broadcastGpu(); return this.gpuSnapshot() }, 'panel')
    this.handle('gpu:tunnel', async (id, action) => {
      const tunnel = this.gpu.snapshot().cpolar.tunnels.find(item => item.id === z.string().parse(id))
      if (!tunnel) throw new DomainError('NOT_FOUND', '地址已更新，请刷新后重试。')
      if (z.enum(['copy', 'open']).parse(action) === 'copy') { clipboard.writeText(tunnel.protocol === 'tcp' ? tunnel.url.replace(/^tcp:\/\//, '') : tunnel.url); return }
      if (!['http:', 'https:'].includes(new URL(tunnel.url).protocol)) throw new DomainError('VALIDATION', '请复制主机名和端口，在对应客户端连接。')
      await shell.openExternal(tunnel.url)
    })
    this.handle('widget:snapshot', () => this.snapshot())
    this.handle('widget:preferences', input => {
      const patch = widgetPatchSchema.parse(input)
      const next = widgetPreferencesSchema.parse({ ...this.preferences(), ...patch })
      runtime.settings().setWidget(next)
      this.refresh(patch.enabled !== undefined || patch.openAtLogin !== undefined)
      return this.snapshot()
    })
    this.handle('widget:show', () => { this.show(); return this.snapshot() })
    this.handle('widget:hide', () => { this.window?.hide(); this.notify(); this.updateTray() })
    this.handle('widget:panel', input => this.selectPanel(z.enum(['checkin', 'tasks', 'submissions', 'reading', 'gpu', 'codex', 'more']).parse(input)))
    this.handle('widget:rail-interactive', value => { this.rail?.setIgnoreMouseEvents(!z.boolean().parse(value), { forward: true }) })
    this.handle('widget:panel-ready', () => {
      if (!this.window || this.window.isDestroyed()) return
      const reveal = !this.window.isVisible()
      this.updateLayout()
      this.window.show(); this.window.focus()
      if (reveal) this.window.webContents.send('desktop:panel-shown')
      this.notify()
    }, 'panel')
    this.handle('widget:open-main', () => runtime.openMain())
    this.handle('widget:return', () => {
      const main = this.runtime.mainWindow()
      if (main && !main.isDestroyed()) main.close()
      else this.restoreAfterWorkbench()
    })
    this.handle('widget:compact', value => this.setCompact(z.boolean().parse(value)), 'panel')
    this.handle('widget:weather', force => this.weather.read(z.boolean().optional().parse(force)))
    this.handle('widget:city-search', query => this.weather.search(z.string().parse(query)))
    screen.on('display-metrics-changed', this.updateLayout)
    screen.on('display-removed', this.updateLayout)
  }
  private preferences() { return readWidgetPreferences(this.runtime.settings().getWidget()) }
  private gpuSnapshot() { return { ...this.gpu.snapshot(), alerts: this.gpuAlerts.settings(), sshSync: this.sshSync.snapshot(), rememberedLogin: this.gpuLogin.remembered() } }
  private resumeSshSync = () => { this.sshSync.checkDue() }
  private broadcastGpu() { for (const target of [this.rail, this.window]) if (target && !target.isDestroyed()) target.webContents.send('gpu:changed', this.gpuSnapshot()) }
  private gpuSession() {
    if (!this.gpuConnection) this.gpuConnection = (async () => {
      const profile = process.env.WORKBENCH_DATA_DIR && process.env.WORKBENCH_GPU_PROFILE ? process.env.WORKBENCH_GPU_PROFILE : join(app.getPath('userData'), 'gpu-monitor-session')
      const connection = session.fromPath(profile, { cache: false })
      // This origin is reachable directly; the current system proxy closes its connection.
      await connection.setProxy({ mode: 'direct' })
      connection.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
      return connection
    })()
    return this.gpuConnection
  }
  private async openGpuWebsite() {
    if (this.gpuWebsite && !this.gpuWebsite.isDestroyed()) { this.gpuWebsite.show(); this.gpuWebsite.focus(); return }
    const connection = await this.gpuSession(), loginRequired = this.gpu.snapshot().auth !== 'ready'
    const website = new BrowserWindow({ width: 1000, height: 800, show: false, title: 'GPU 看板', autoHideMenuBar: true,
      webPreferences: { session: connection, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    this.gpuWebsite = website
    website.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    website.webContents.on('will-navigate', (event, url) => { if (new URL(url).origin !== gpuMonitorOrigin) event.preventDefault() })
    website.once('ready-to-show', () => { website.show(); website.focus() })
    website.webContents.on('did-finish-load', () => {
      if (loginRequired) void this.gpu.reconnect().then(async snapshot => {
        if (snapshot.auth === 'ready') { await connection.cookies.flushStore(); void this.sshSync.refresh(); if (!website.isDestroyed()) website.close() }
      })
    })
    website.once('closed', () => { if (this.gpuWebsite === website) this.gpuWebsite = null })
    await website.loadURL(gpuMonitorOrigin + (loginRequired ? '/login' : '/'))
  }
  get railWindow() { return this.rail }
  setCheckinNotices(items: DesktopNotice[]) { this.notices.setCheckins(items) }
  refreshTaskNotices = () => { this.notices.refreshTasks() }
  workbenchChanged() {
    const main = this.runtime.mainWindow()
    if (main?.isVisible() && !main.isMinimized()) this.window?.hide()
    this.notify()
  }
  async selectPanel(panel: DesktopPanel, toggle = true) {
    const request = ++this.panelRequest
    const changed = this.panel !== panel
    if (this.window && !this.window.isDestroyed()) {
      if (toggle && this.panel === panel && this.window.isVisible() && this.window.isFocused()) { this.window.hide(); this.notify(); return }
      if (changed) {
        const editing = await this.hasOpenEditor()
        if (request !== this.panelRequest) return
        if (editing) throw new DomainError('VALIDATION', '请先保存或关闭当前编辑页，再切换便签。')
      }
    }
    this.panel = panel
    this.showPanel(!changed)
    this.window?.setTitle(`PhD 桌面${desktopPanelTitles[panel]}`)
  }
  hideForWorkbench() {
    this.returnToPanel ||= Boolean(this.window?.isVisible())
    this.workbenchChanged()
  }
  restoreAfterWorkbench(show = true) {
    if (!this.returnToPanel) return
    this.returnToPanel = false
    if (show) this.showPanel()
  }
  private authorized(event: IpcMainInvokeEvent, scope: 'panel' | 'desktop' | 'all') {
    const window = event.sender === this.window?.webContents ? this.window
      : scope !== 'panel' && event.sender === this.rail?.webContents ? this.rail
      : scope === 'all' && event.sender === this.runtime.mainWindow()?.webContents ? this.runtime.mainWindow() : null
    return !!window && event.senderFrame === window.webContents.mainFrame && this.runtime.trustedUrl(event.senderFrame.url)
  }
  private handle(channel: string, handler: (...args: unknown[]) => unknown, scope: 'panel' | 'desktop' | 'all' = 'all') {
    this.channels.push(channel)
    ipcMain.handle(channel, async (event, ...args): Promise<Result<unknown>> => {
      if (!this.authorized(event, scope)) return { ok: false, error: { code: 'FORBIDDEN', message: '无法执行此请求。' } }
      try {
        if (this.runtime.relocating()) throw new DomainError('UNAVAILABLE', '工作台数据正在迁移，请稍候。')
        return { ok: true, data: await handler(...args) }
      } catch (error) {
        if (error instanceof ZodError) return { ok: false, error: { code: 'VALIDATION', message: error.issues[0]?.message ?? '设置内容无效。' } }
        if (error instanceof DomainError) return { ok: false, error: { code: error.code, message: error.message } }
        return { ok: false, error: { code: 'UNAVAILABLE', message: '桌面面板暂时无法完成操作，请重试。' } }
      }
    })
  }
  snapshot(): WidgetSnapshot {
    const main = this.runtime.mainWindow()
    return { preferences: this.preferences(), visible: this.window?.isVisible() ?? false, workbenchVisible: Boolean(main?.isVisible() && !main.isMinimized()), panel: this.panel,
      startupManaged: this.startupManaged, startupError: this.startupError, scale: this.scale, waterReminderAt: this.waterReminder.dueAt(), notices: this.notices.pending() }
  }
  start() {
    this.waterReminder.refresh()
    this.refreshTaskNotices()
    powerMonitor.on('resume', this.waterReminder.refresh)
    powerMonitor.on('resume', this.refreshTaskNotices)
    if (process.env.WORKBENCH_DISABLE_GPU_AUTO !== '1') { this.sshSync.start(); powerMonitor.on('resume', this.resumeSshSync) }
    if (process.env.WORKBENCH_DISABLE_WIDGET_AUTO === '1') return
    const iconPath = app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(app.getAppPath(), 'resources/icon.png')
    this.tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 24, height: 24 }))
    this.tray.setToolTip('PhD 科研工作台')
    this.tray.on('double-click', () => this.show())
    this.refresh()
  }
  refresh(updateStartup = true) {
    const preferences = this.preferences()
    if (updateStartup) this.updateStartup()
    if (preferences.enabled) this.show(false)
    else { this.rail?.hide(); this.window?.hide() }
    this.window?.setAlwaysOnTop(preferences.alwaysOnTop)
    this.updateLayout()
    this.updateTray()
    this.notify()
    this.window?.webContents.send('reports:changed')
  }
  private updateStartup() {
    if (!this.startupManaged) return
    try {
      const preferences = this.preferences()
      const openAtLogin = preferences.enabled && preferences.openAtLogin
      app.setLoginItemSettings({ name: 'PhD Research Desktop', path: process.execPath,
        args: ['--desktop-widget'], openAtLogin, enabled: openAtLogin })
      this.startupError = null
    } catch { this.startupError = '开机启动未能设置，请重新切换此选项。' }
  }
  show(enable = true) {
    if (enable && !this.preferences().enabled) {
      this.runtime.settings().setWidget({ ...this.preferences(), enabled: true })
      this.updateStartup()
    }
    if (!this.rail || this.rail.isDestroyed()) this.createRail()
    else this.rail.showInactive()
    this.updateTray()
    this.notify()
  }
  private showPanel(reveal = true) {
    if (!this.window || this.window.isDestroyed()) this.create()
    else if (reveal) {
      const wasHidden = !this.window.isVisible()
      this.window.show(); this.window.focus()
      if (wasHidden) this.window.webContents.send('desktop:panel-shown')
    }
    this.show()
    this.notify()
  }
  private async hasOpenEditor() {
    if (!this.window || this.window.isDestroyed()) return false
    return this.compact || await this.window.webContents.executeJavaScript('Boolean(document.querySelector("[data-keep-awake=\\"true\\"]"))').catch(() => true)
  }
  private createRail() {
    const rail = new BrowserWindow({ width: desktopRailWidth, height: desktopRailHeight, frame: false, transparent: true,
      backgroundColor: '#00000000', resizable: false, minimizable: false, maximizable: false,
      fullscreenable: false, skipTaskbar: true, hasShadow: false, show: false, alwaysOnTop: false,
      title: 'PhD 桌面便签', webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
    this.rail = rail
    rail.setIgnoreMouseEvents(true, { forward: true })
    rail.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    rail.webContents.on('will-navigate', event => event.preventDefault())
    rail.webContents.on('context-menu', () => {
      const preferences = this.preferences()
      const hidden = preferences.railOrder.filter(id => preferences.hiddenPanels.includes(id))
      const open = (panel: DesktopPanel) => {
        void this.selectPanel(panel, false).catch(error => {
          void dialog.showMessageBox(rail, { type: 'info', message: error instanceof DomainError ? error.message : '暂时无法打开便签，请重试。' })
        })
      }
      Menu.buildFromTemplate([
        ...hidden.map(id => ({ id: `open-${id}`, label: desktopPanelTitles[id], click: () => open(id) })),
        ...(hidden.length ? [{ type: 'separator' as const }] : []),
        { id: 'manage-shortcuts', label: '便签管理', click: () => open('more') }
      ]).popup({ window: rail })
    })
    rail.once('ready-to-show', () => { this.updateLayout(); rail.showInactive(); this.notify() })
    rail.on('closed', () => { if (this.rail === rail) this.rail = null })
    if (this.runtime.rendererUrl) void rail.loadURL(new URL('rail.html', this.runtime.rendererUrl).href)
    else void rail.loadFile(join(import.meta.dirname, '../renderer/rail.html'))
  }
  private create() {
    const preferences = this.preferences()
    const area = (preferences.position ? screen.getDisplayNearestPoint(preferences.position) : screen.getPrimaryDisplay()).workArea
    const layout = widgetLayout(preferences.scale, area)
    this.compact = false
    this.scale = layout.scale
    const window = new BrowserWindow({ width: layout.width, height: layout.height,
      x: area.x + area.width - layout.width - desktopRailTabWidth - 8, y: area.y + Math.round((area.height - layout.height) / 2),
      frame: false, transparent: true, backgroundColor: '#00000000', useContentSize: true, resizable: false,
      maximizable: false, minimizable: false, fullscreenable: false, skipTaskbar: true,
      hasShadow: false, thickFrame: false, roundedCorners: false, show: false, alwaysOnTop: preferences.alwaysOnTop,
      title: `PhD 桌面${desktopPanelTitles[this.panel]}`, webPreferences: { preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true, spellcheck: false } })
    this.window = window
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', event => event.preventDefault())
    window.webContents.on('will-attach-webview', event => event.preventDefault())
    window.once('ready-to-show', () => { this.updateLayout() })
    window.on('closed', () => { if (this.window === window) this.window = null; this.notify() })
    releaseWhenIdle(window, async () => {
      if (!window.isVisible() && !this.runtime.relocating() && !await this.hasOpenEditor() && !window.isDestroyed()) window.close()
    })
    const query = { panel: this.panel }
    if (this.runtime.rendererUrl) {
      const url = new URL('widget.html', this.runtime.rendererUrl); url.search = new URLSearchParams(query).toString()
      void window.loadURL(url.href)
    } else void window.loadFile(join(import.meta.dirname, '../renderer/widget.html'), { query })
  }
  private setCompact(compact: boolean) {
    const window = this.window
    if (!window || window.isDestroyed()) return
    this.compact = compact
    this.updateLayout()
  }
  private updateLayout = () => {
    const railArea = screen.getPrimaryDisplay().workArea
    const railHeight = Math.min(desktopRailHeight - this.preferences().hiddenPanels.length * 72, railArea.height - 16)
    this.rail?.setBounds({ width: desktopRailWidth, height: railHeight, x: railArea.x + railArea.width - desktopRailWidth,
      y: railArea.y + Math.max(8, Math.min(Math.round(railArea.height * .25), railArea.height - railHeight - 8)) })
    if (!this.window || this.window.isDestroyed()) return
    const bounds = this.window.getBounds(), area = screen.getDisplayMatching(this.rail?.getBounds() ?? bounds).workArea
    const layout = widgetLayout(this.preferences().scale, area, this.compact)
    const scaleChanged = this.scale !== layout.scale
    this.scale = layout.scale
    const [contentWidth, contentHeight] = this.window.getContentSize()
    if (contentWidth !== layout.width || contentHeight !== layout.height) this.window.setContentSize(layout.width, layout.height)
    const native = this.window.getBounds()
    const x = Math.max(area.x, area.x + area.width - native.width - desktopRailTabWidth - 8)
    const y = area.y + Math.max(0, Math.round((area.height - native.height) / 2))
    if (bounds.x !== x || bounds.y !== y) this.window.setPosition(x, y)
    if (scaleChanged) this.notify()
  }
  private updateTray() {
    if (!this.tray) return
    this.tray.setContextMenu(Menu.buildFromTemplate([
      { label: '打开工作台', click: () => this.runtime.openMain() },
      { label: '显示桌面便签', click: () => this.show() },
      { type: 'separator' }, { label: '退出工作台', click: () => app.quit() }
    ]))
  }
  private notify() {
    const snapshot = this.snapshot()
    const keepRailOnTop = snapshot.notices.some(item => item.kind === 'task') || snapshot.visible && snapshot.preferences.alwaysOnTop
    if (this.rail && !this.rail.isDestroyed() && this.rail.isAlwaysOnTop() !== keepRailOnTop) this.rail.setAlwaysOnTop(keepRailOnTop)
    this.codex.setActive(snapshot.preferences.enabled && (!snapshot.preferences.hiddenPanels.includes('codex') || snapshot.visible && snapshot.panel === 'codex'))
    for (const window of [this.window, this.rail, this.runtime.mainWindow()]) {
      if (window && !window.isDestroyed()) window.webContents.send('widget:changed', snapshot)
    }
  }
  stop() {
    powerMonitor.removeListener('resume', this.refreshTaskNotices)
    this.notices.stop()
    powerMonitor.removeListener('resume', this.waterReminder.refresh)
    this.waterReminder.stop()
    this.sshSync.stop()
    powerMonitor.removeListener('resume', this.resumeSshSync)
    this.codex.stop()
    this.gpu.stop()
    this.gpuAlerts.stop()
    screen.removeListener('display-metrics-changed', this.updateLayout)
    screen.removeListener('display-removed', this.updateLayout)
    for (const channel of this.channels) ipcMain.removeHandler(channel)
    this.tray?.destroy()
    this.tray = null
  }
}
