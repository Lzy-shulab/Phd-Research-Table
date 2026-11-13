import { app, ipcMain, type BrowserWindow } from 'electron'

// A shorter deadline is available only to isolated development smoke tests.
export const desktopIdleMs = !app.isPackaged && process.env.WORKBENCH_DATA_DIR && process.env.WORKBENCH_IDLE_TEST_MS
  ? Math.max(1000, Number(process.env.WORKBENCH_IDLE_TEST_MS) || 600_000) : 600_000

export function releaseWhenIdle(window: BrowserWindow, release: () => void | Promise<void>) {
  let timer: ReturnType<typeof setTimeout>
  const touch = () => {
    clearTimeout(timer)
    timer = setTimeout(() => { void release(); if (!window.isDestroyed()) touch() }, desktopIdleMs)
    timer.unref()
  }
  const activity = (event: Electron.IpcMainEvent) => {
    if (event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame) touch()
  }
  ipcMain.on('desktop:activity', activity)
  window.on('focus', touch)
  window.webContents.on('before-input-event', touch)
  touch()
  window.once('closed', () => { clearTimeout(timer); ipcMain.removeListener('desktop:activity', activity) })
}
