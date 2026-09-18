import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { SettingsRepository } from './database/repositories/settings'

export function createWindow(
  settings: () => SettingsRepository | undefined,
  rendererUrl: string | undefined,
  isBusy: () => boolean = () => false
): BrowserWindow {
  const saved = settings()?.getWindowState()
  const visible =
    saved &&
    screen
      .getAllDisplays()
      .some(
        ({ workArea: a }) =>
          saved.x + 100 < a.x + a.width &&
          saved.x + saved.width - 100 > a.x &&
          saved.y >= a.y &&
          saved.y + 80 < a.y + a.height
      )
  const window = new BrowserWindow({
    width: saved?.width ?? 1440,
    height: saved?.height ?? 940,
    ...(visible ? { x: saved.x, y: saved.y } : {}),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'PhD 科研工作台',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'resources/icon.png'),
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#171e26' : '#e7ecf0',
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: nativeTheme.shouldUseDarkColors ? '#171e26' : '#e7ecf0',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#bec9d4' : '#4f5e6a',
      height: 40
    },
    webPreferences: {
      preload: join(import.meta.dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false
    }
  })
  const updateTheme = () => {
    if (window.isDestroyed()) return
    const dark = nativeTheme.shouldUseDarkColors
    window.setBackgroundColor(dark ? '#171e26' : '#e7ecf0')
    if (process.platform === 'win32')
      window.setTitleBarOverlay({
        color: dark ? '#171e26' : '#e7ecf0',
        symbolColor: dark ? '#bec9d4' : '#4f5e6a'
      })
  }
  nativeTheme.on('updated', updateTheme)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event) => event.preventDefault())
  window.webContents.on('will-attach-webview', (event) => event.preventDefault())
  window.once('ready-to-show', () => {
    if (saved?.maximized) window.maximize()
    window.show()
  })
  let allowClose = false
  let pendingToken: string | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined
  const flushResult = (event: Electron.IpcMainEvent, token: unknown, ok: unknown) => {
    if (
      event.sender !== window.webContents ||
      event.senderFrame !== window.webContents.mainFrame ||
      token !== pendingToken
    )
      return
    clearTimeout(closeTimer)
    pendingToken = undefined
    if (ok === true) {
      allowClose = true
      window.close()
    }
  }
  ipcMain.on('app:flush-result', flushResult)
  window.on('close', (event) => {
    if (isBusy()) { event.preventDefault(); return }
    if (!allowClose && !window.webContents.isCrashed()) {
      event.preventDefault()
      if (pendingToken) return
      pendingToken = randomUUID()
      window.webContents.send('app:flush', pendingToken)
      closeTimer = setTimeout(() => {
        pendingToken = undefined
        void dialog.showMessageBox(window, {
          type: 'error',
          title: '工作区仍在保存',
          message: '工作区尚未完成保存，请稍后重试。'
        })
      }, 8000)
      return
    }
    try {
      settings()?.setWindowState({ ...window.getNormalBounds(), maximized: window.isMaximized() })
    } catch (error) {
      console.error('Could not store window position', error)
    }
  })
  window.once('closed', () => {
    clearTimeout(closeTimer)
    nativeTheme.removeListener('updated', updateTheme)
    ipcMain.removeListener('app:flush-result', flushResult)
  })
  if (rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return window
}
