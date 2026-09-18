import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { resolve } from 'node:path'
import { mkdirSync, writeFileSync } from 'node:fs'

const directory = resolve('test-results', `packaged-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: resolve(directory, 'isolated-data') }
delete env.ELECTRON_RUN_AS_NODE
const executablePath = resolve(process.env.WORKBENCH_TEST_EXECUTABLE || 'release/win-unpacked/PhD 科研工作台.exe')
const app = await electron.launch({ executablePath, args: [], env })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  const result = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(result.ok, true)
  const runtime = await app.evaluate(({ app, BrowserWindow, screen }) => ({
    packaged: app.isPackaged,
    dataPath: app.getPath('userData'),
    bounds: BrowserWindow.getAllWindows()[0].getBounds(),
    scaleFactor: screen.getPrimaryDisplay().scaleFactor
  }))
  assert.equal(runtime.packaged, true)
  assert.equal(runtime.dataPath, env.WORKBENCH_DATA_DIR)
  const controls = await app.evaluate(async ({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    await new Promise(resolve => { window.once('minimize', resolve); window.minimize() })
    const minimized = window.isMinimized()
    await new Promise(resolve => { window.once('restore', resolve); window.restore() })
    if (window.isMaximized()) await new Promise(resolve => { window.once('unmaximize', resolve); window.unmaximize() })
    await new Promise(resolve => { window.once('maximize', resolve); window.maximize() })
    const maximized = window.isMaximized()
    await new Promise(resolve => { window.once('unmaximize', resolve); window.unmaximize() })
    return { minimized, maximized, restored: !window.isMinimized() && !window.isMaximized(), title: window.getTitle() }
  })
  assert.deepEqual(controls, { minimized: true, maximized: true, restored: true, title: 'PhD 科研工作台' })
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content')
  assert.ok(csp.includes("connect-src 'self'"))
  assert.ok(csp.includes("script-src 'self' 'wasm-unsafe-eval';"))
  assert.ok(!csp.includes("'unsafe-eval'"))
  assert.ok(!csp.includes('ws:'))
  const geometry = []
  for (const [width, height] of [[1100, 700], [1920, 1080], [2560, 1440]]) {
    await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), { width, height })
    await page.waitForFunction(({ width, height }) => Math.abs(innerWidth - width) <= 4 && Math.abs(innerHeight - height) <= 4, { width, height })
    const measured = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }))
    assert.equal(measured.overflow, false)
    geometry.push(measured)
    await page.screenshot({ path: resolve(directory, `${width}x${height}.png`), animations: 'disabled' })
  }
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setBounds(bounds), runtime.bounds)
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读' }).click()
  const imported = await page.evaluate((path) => window.workbench.importPapers([path], null, false), resolve('tests/fixtures/translation-check.pdf'))
  assert.equal(imported.ok, true)
  assert.equal(imported.data.added, 1)
  await page.waitForFunction(() => document.querySelector('.pdf-cover img')?.complete)
  await page.getByRole('button', { name: '原文', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.textLayer')?.textContent?.includes('Research'))
  const pdf = await page.locator('.pdf-page').evaluate((host) => {
    const spans = Array.from(host.querySelectorAll('.textLayer span')).filter((span) => span.textContent.trim())
    const bounds = host.getBoundingClientRect()
    return { text: host.querySelector('.textLayer').textContent, canvas: !!host.querySelector('canvas')?.width,
      allTextInPage: spans.every((span) => { const b = span.getBoundingClientRect(); return b.left >= bounds.left - 2 && b.right <= bounds.right + 2 && b.top >= bounds.top - 2 && b.bottom <= bounds.bottom + 2 }) }
  })
  assert.equal(pdf.canvas, true)
  assert.equal(pdf.allTextInPage, true)
  await page.screenshot({ path: resolve(directory, 'packaged-pdf-reader.png'), animations: 'disabled' })
  assert.deepEqual(errors, [])
  const report = { executablePath, ...runtime, controls, databasePath: result.data.databasePath, tasks: result.data.tasks.length, projects: result.data.projects.length, geometry, pdf, errors }
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log('PASS Packaged executable, isolated SQLite and migrations, production CSP, high-DPI sizes, bundled PDF worker/text layer, no renderer errors')
  console.log(JSON.stringify(report, null, 2))
} finally { await app.close() }
