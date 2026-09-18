import { app, BrowserWindow, Menu, nativeTheme, session } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openDatabase, type DatabaseConnection } from './database/db'
import { SettingsRepository } from './database/repositories/settings'
import { seedDevelopmentDatabase } from './database/seed'
import { registerIpc } from './ipc/register'
import { createWindow } from './window'
import { DatabaseLocation } from './database/location'

app.setName('PhD 科研工作台')
if (process.platform === 'win32') app.setAppUserModelId('local.phd.researchworkbench')
app.commandLine.appendSwitch('lang', 'zh-CN')
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
const isTrustedUrl = (url: string) =>
  rendererUrl ? new URL(url).origin === new URL(rendererUrl).origin : url === fileUrl

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore()
      window.focus()
    }
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
    stopServices = registerIpc(getConnection, () => window, isTrustedUrl, {
      migrationsFolder: app.isPackaged ? join(process.resourcesPath, 'migrations') : join(app.getAppPath(), 'src/main/database/migrations'),
      setRelocating: (value) => { relocating = value },
      activateDatabase: (next) => {
        location.set(next.path)
        const previous = connection
        connection = next
        try { previous?.close() } catch (error) { console.error('Previous database could not close', error) }
      }
    })
    const open = () => {
      let settings: SettingsRepository | undefined
      try {
        settings = new SettingsRepository(getConnection().db)
        nativeTheme.themeSource = settings.getAppearance()
      } catch (error) {
        console.error('Database initialization failed', error)
      }
      window = createWindow(() => { try { return new SettingsRepository(getConnection().db) } catch { return undefined } }, rendererUrl, () => relocating)
      window.on('closed', () => {
        window = null
      })
    }
    open()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) open()
    })
  })
}
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
app.on('will-quit', () => { stopServices?.(); connection?.close() })
