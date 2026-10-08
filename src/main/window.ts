import { app, BrowserWindow, dialog, ipcMain, nativeTheme, screen } from 'electron'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import type { SettingsRepository } from './database/repositories/settings'
import { interfacePalette } from '../shared/palette'

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
  const requestedWidth = saved?.width ?? 1440
  const requestedHeight = saved?.height ?? 940
  const appearance = settings()?.getAppearance() ?? 'system'
  const palette = interfacePalette(settings()?.getInterface().background ?? 'default', appearance === 'system' ? nativeTheme.shouldUseDarkColors : appearance === 'dark')
  const window = new BrowserWindow({
    width: requestedWidth,
    height: requestedHeight,
    ...(visible ? { x: saved.x, y: saved.y } : {}),
    minWidth: 1100,
    minHeight: 700,
    show: false,
    title: 'PhD 科研工作台',
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.png')
      : join(app.getAppPath(), 'resources/icon.png'),
    backgroundColor: palette.base,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: palette.base,
      symbolColor: palette.text,
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
  // On Windows with a hidden titlebar, BrowserWindow can add a few device-independent
  // pixels to the requested outer size. Persisting that expanded size verbatim makes the
  // window grow again on every launch, so retain the one-time frame correction.
  const initialBounds = window.getNormalBounds()
  const frameCorrection = {
    width: Math.max(0, initialBounds.width - requestedWidth),
    height: Math.max(0, initialBounds.height - requestedHeight)
  }
  // Renderer resolves the selected background, explicit theme and custom-image tint
  // together, then synchronizes the fixed, validated window:palette capability.
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
  let pendingWindowState: ReturnType<SettingsRepository['getWindowState']>
  const currentWindowState = () => {
    const bounds = window.getNormalBounds()
    return {
      ...bounds,
      width: Math.max(1100, bounds.width - frameCorrection.width),
      height: Math.max(700, bounds.height - frameCorrection.height),
      maximized: window.isMaximized()
    }
  }
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
  window.once('ready-to-show', () => {
    const readyBounds = window.getNormalBounds()
    frameCorrection.width = Math.max(0, readyBounds.width - requestedWidth)
    frameCorrection.height = Math.max(0, readyBounds.height - requestedHeight)
  })
  window.on('close', (event) => {
    if (isBusy()) { event.preventDefault(); return }
    if (!allowClose && !window.webContents.isCrashed()) {
      event.preventDefault()
      if (pendingToken) return
      pendingWindowState = currentWindowState()
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
      settings()?.setWindowState(pendingWindowState ?? currentWindowState())
    } catch (error) {
      console.error('Could not store window position', error)
    }
  })
  window.once('closed', () => {
    clearTimeout(closeTimer)
    ipcMain.removeListener('app:flush-result', flushResult)
  })
  if (rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadFile(join(import.meta.dirname, '../renderer/index.html'))
  return window
}
