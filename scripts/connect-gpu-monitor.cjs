/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS Electron bootstrap entry. */
const { app, BrowserWindow, session } = require('electron')
const { join, resolve, basename } = require('node:path')
const { mkdirSync, writeFileSync } = require('node:fs')

const origin = 'https://shulab-gpu-monitor.netlify.app'
// This is the real connection profile reused by the desktop monitor, not a test profile.
const profile = join(app.getPath('appData'), 'PhD Research Workbench', 'gpu-monitor-session')
app.setPath('userData', profile)
app.setName('PhD GPU 看板连接')
app.whenReady().then(async () => {
  const site = session.defaultSession
  await site.setProxy({ mode: 'direct' })
  const output = resolve('test-results/gpu-source')
  mkdirSync(output, { recursive: true })
  if (process.argv.includes('--read')) {
    for (const path of ['/api/status', '/api/cpolar', '/gpu-logic.js', '/snapshot-logic.js']) {
      const response = await site.fetch(origin + path, { signal: AbortSignal.timeout(40000) })
      const body = await response.text()
      writeFileSync(join(output, basename(path) + (path.startsWith('/api/') ? '.json' : '')), body)
      console.log(path, response.status, body.length)
    }
    app.quit(); return
  }
  const window = new BrowserWindow({ width: 960, height: 780, title: '登录 GPU 看板', webPreferences: { session: site, sandbox: true, contextIsolation: true, nodeIntegration: false } })
  window.webContents.on('did-fail-load', (_event, code, description) => { writeFileSync(join(output, 'connection-error.txt'), `${code} ${description}`) })
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let collected = false
  window.webContents.on('did-finish-load', async () => {
    if (collected) return
    try {
      const response = await site.fetch(origin + '/')
      const html = await response.text()
      if (html.includes('id="login-form"')) return
      collected = true
      writeFileSync(join(output, 'dashboard.html'), html)
      const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']+)/g)].map(match => new URL(match[1], origin))
      for (const url of scripts.filter(url => url.origin === origin)) {
        const source = await site.fetch(url.href).then(response => response.text())
        writeFileSync(join(output, basename(url.pathname)), source)
      }
      await site.cookies.flushStore()
      console.log('GPU_LOGIN_READY')
      window.close()
    } catch (error) { console.error(error.message) }
  })
  await window.loadURL(origin)
  window.show(); window.focus()
  console.log('GPU_LOGIN_WINDOW_OPEN')
})
app.on('window-all-closed', () => app.quit())
