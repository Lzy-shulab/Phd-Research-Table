import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase, type DatabaseConnection } from './database/db'
import { SettingsRepository } from './database/repositories/settings'
import { TaskRepository } from './database/repositories/tasks'
import { seedDevelopmentDatabase } from './database/seed'
import { registerIpc } from './ipc/register'
import { createWindow } from './window'
import { DatabaseLocation } from './database/location'
import { DesktopWidgetController } from './widget/controller'

app.setName('PhD 科研工作台')
if (process.platform === 'win32') app.setAppUserModelId('local.phd.researchworkbench')
app.commandLine.appendSwitch('lang', 'zh-CN')
app.commandLine.appendSwitch('disk-cache-size', String(32 * 1024 * 1024))
// Preserve the v0.1 data directory when changing the displayed name.
const demo = !app.isPackaged && process.argv.includes('--seed-demo')
const userData =
  process.env.WORKBENCH_DATA_DIR
    ? process.env.WORKBENCH_DATA_DIR
    : join(app.getPath('appData'), demo ? 'PhD Research Workbench Demo' : 'PhD Research Workbench')
app.setPath('userData', userData)
const location = new DatabaseLocation(userData)
let relocating = false
let connection: DatabaseConnection | undefined
let stopServices: (() => void) | undefined
let window: BrowserWindow | null = null
let quitting = false
app.on('before-quit', () => { quitting = true })
let desktop: DesktopWidgetController | undefined
let openWorkbench: (section?: 'submissions' | 'literature', paper?: { id: string; variant: 'source' | 'translated' }) => void = () => {}
const getConnection = () => {
  if (!connection) {
    connection = openDatabase(
      location.get(),
      app.isPackaged
        ? join(process.resourcesPath, 'migrations')
        : join(app.getAppPath(), 'src/main/database/migrations')
    )
    if (demo) seedDevelopmentDatabase(connection.db)
  }
  return connection
}
const rendererUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined
const fileUrl = pathToFileURL(join(import.meta.dirname, '../renderer/index.html')).href
const widgetUrl = pathToFileURL(join(import.meta.dirname, '../renderer/widget.html')).href
const railUrl = pathToFileURL(join(import.meta.dirname, '../renderer/rail.html')).href
const isTrustedUrl = (url: string) =>
  rendererUrl ? new URL(url).origin === new URL(rendererUrl).origin : [fileUrl, widgetUrl, railUrl].includes(url.split('?')[0] ?? '')

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', (_event, argv) => {
    if (argv.includes('--workbench')) openWorkbench()
    else desktop?.show()
  })
  void app.whenReady().then(() => {
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) =>
      callback(false)
    )
    session.defaultSession.setPermissionCheckHandler(() => false)
    if (app.isPackaged)
      session.defaultSession.webRequest.onBeforeRequest((details, callback) =>
        callback({ cancel: !['file:', 'devtools:'].includes(new URL(details.url).protocol) })
      )
    Menu.setApplicationMenu(
      process.platform === 'darwin'
        ? Menu.buildFromTemplate([
            { role: 'appMenu' },
            { role: 'editMenu' },
            { role: 'windowMenu' }
          ])
        : null
    )
    desktop = new DesktopWidgetController({ settings: () => new SettingsRepository(getConnection().db),
      tasks: () => new TaskRepository(getConnection().db).list(),
      mainWindow: () => window, openMain: () => openWorkbench(), rendererUrl, trustedUrl: isTrustedUrl, relocating: () => relocating })
    stopServices = registerIpc(getConnection, () => window, isTrustedUrl, {
      openSubmissions: () => {
        openWorkbench('submissions')
      },
      getWidgetWindow: () => desktop?.window ?? null,
      getRailWindow: () => desktop?.railWindow ?? null,
      openPaper: (id, variant) => openWorkbench('literature', { id, variant }),
      openCheckin: () => { void desktop?.selectPanel('checkin', false) },
      openDesktopPanel: async panel => { await desktop?.selectPanel(panel, false) },
      refreshDesktop: () => desktop?.refresh(false),
      checkinNotices: items => desktop?.setCheckinNotices(items),
      refreshTaskNotices: () => desktop?.refreshTaskNotices(),
      migrationsFolder: app.isPackaged ? join(process.resourcesPath, 'migrations') : join(app.getAppPath(), 'src/main/database/migrations'),
      setRelocating: (value) => { relocating = value },
      activateDatabase: (next) => {
        location.set(next.path)
        const previous = connection
        connection = next
        try { previous?.close() } catch (error) { console.error('Previous database could not close', error) }
        desktop?.refresh()
      }
    })
    openWorkbench = (section, paper) => {
      desktop?.hideForWorkbench()
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore()
        window.show(); window.focus()
        if (paper) window.webContents.send('desktop:open-paper', paper)
        else if (section === 'submissions') window.webContents.send('submission:open')
        window.webContents.send('workbench:shown')
        return
      }
      let settings: SettingsRepository | undefined
      try {
        settings = new SettingsRepository(getConnection().db)
        nativeTheme.themeSource = settings.getAppearance()
      } catch (error) {
        console.error('Database initialization failed', error)
      }
      window = createWindow(() => { try { return new SettingsRepository(getConnection().db) } catch { return undefined } }, rendererUrl, () => relocating, section, paper)
      const current = window
      current.on('show', () => desktop?.workbenchChanged())
      current.on('hide', () => desktop?.workbenchChanged())
      current.on('minimize', () => desktop?.workbenchChanged())
      current.on('restore', () => desktop?.workbenchChanged())
      current.on('closed', () => {
        if (window === current) window = null
        if (!quitting) { desktop?.restoreAfterWorkbench(); desktop?.workbenchChanged() }
      })
    }
    if (process.argv.includes('--workbench') || process.env.WORKBENCH_DISABLE_WIDGET_AUTO === '1') openWorkbench()
    desktop.start()
    app.on('activate', () => {
      openWorkbench()
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => { desktop?.stop(); stopServices?.(); connection?.close() })
