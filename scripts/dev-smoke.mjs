import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chromium } from 'playwright'
import { resolve } from 'node:path'
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const entry = resolve(require.resolve('electron-vite/package.json'), '../bin/electron-vite.js')
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: resolve('test-results', `dev-${Date.now()}`) }
delete env.ELECTRON_RUN_AS_NODE
const child = spawn(process.execPath, [entry, 'dev', '--', '--remote-debugging-port=9239'], {
  env,
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe']
})
let logs = ''
child.stdout.on('data', (b) => {
  logs += b.toString()
})
child.stderr.on('data', (b) => {
  logs += b.toString()
})
let browser
try {
  await new Promise((accept, reject) => {
    const start = Date.now()
    const timer = setInterval(() => {
      if (logs.includes('DevTools listening on')) {
        clearInterval(timer)
        accept()
      } else if (Date.now() - start > 45000 || child.exitCode !== null) {
        clearInterval(timer)
        reject(new Error(logs || 'Dev launch timed out'))
      }
    }, 100)
  })
  browser = await chromium.connectOverCDP('http://127.0.0.1:9239')
  const page = browser.contexts()[0].pages()[0]
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor({ timeout: 60000 })
  const result = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(result.ok, true)
  assert.equal(result.data.tasks.length, 0)
  assert.ok(page.url().startsWith('http://127.0.0.1:'))
  const csp = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute('content')
  assert.ok(csp.includes("script-src 'self' 'unsafe-inline'"))
  await page
    .getByRole('textbox', { name: '添加一个研究任务', exact: true })
    .fill('Development capture')
  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).press('Enter')
  await page.getByTestId('task-row').waitFor()
  assert.deepEqual(errors, [])
  console.log('PASS npm run dev: Vite, React refresh CSP, Electron preload, SQLite capture')
  // Browser.close is the Chromium protocol's native shutdown path for this isolated test app.
  const session = await browser.newBrowserCDPSession()
  const disconnected = new Promise((accept) => browser.once('disconnected', accept))
  void session.send('Browser.close').catch(() => undefined)
  await disconnected
} catch (error) {
  console.error(logs)
  if (browser?.isConnected()) {
    for (const page of browser.contexts()[0].pages()) console.error('Dev page:', page.url(), await page.locator('body').innerText().catch(() => 'Unavailable'))
  }
  throw error
} finally {
  if (browser?.isConnected()) await browser.close()
  child.kill()
}
