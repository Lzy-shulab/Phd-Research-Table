import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const executable = process.argv.find(arg => arg.startsWith('--executable='))?.slice(13)
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-results/performance-attendance/ui')
mkdirSync(output, { recursive: true })
const profile = join(output, `profile-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app
const checks = [], errors = []
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
const pass = text => { checks.push(text); console.log('PASS', text) }
const start = async () => {
  app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
  app.context().setDefaultTimeout(15000)
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
}
const pageWith = async text => {
  for (let index = 0; index < 100; index++) { const page = app.windows().find(page => page.url().includes(text)); if (page) return page; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Missing ${text}`)
}
const noWorkbench = async () => {
  for (let index = 0; index < 100; index++) {
    if (await app.evaluate(({ BrowserWindow }) => !BrowserWindow.getAllWindows().some(window => window.webContents.getURL().includes('index.html')))) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('Workbench renderer remained after returning to the panel')
}
const choose = async (panel, start, end) => {
  await panel.getByRole('button', { name: '选择统计月份', exact: true }).click()
  await panel.getByLabel('统计开始月份', { exact: true }).fill(start)
  await panel.getByLabel('统计结束月份', { exact: true }).fill(end)
  await panel.getByRole('button', { name: '应用区间', exact: true }).click()
  await panel.getByLabel('统计开始月份', { exact: true }).waitFor({ state: 'hidden' })
}
try {
  await start()
  let rail = await pageWith('rail.html')
  unwrap(await rail.evaluate(() => window.workbench.openDesktopPanel('checkin')))
  let panel = await pageWith('widget.html')
  await panel.getByRole('progressbar', { name: '区间打卡进度', exact: true }).waitFor()
  for (const entry of [
    { date: '2026-07-01', startTime: '09:00', endTime: '13:00', endsNextDay: false, notes: '' },
    { date: '2026-08-05', startTime: '09:00', endTime: '15:00', endsNextDay: false, notes: '' },
    { date: '2026-06-30', startTime: '09:00', endTime: '12:00', endsNextDay: false, notes: '' },
    { date: '2025-12-31', startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '' }
  ]) unwrap(await panel.evaluate(entry => window.workbench.saveCheckin(entry), entry))
  unwrap(await panel.evaluate(() => window.workbench.saveCheckinAbsence({ kind: 'trip', startDate: '2026-07-02', endDate: '2026-07-02', notes: '' })))
  await choose(panel, '2026-07', '2026-08')
  assert.match(await panel.locator('.attendance-period-total').innerText(), /10\s*\/ 516 小时/)
  assert.equal(await panel.getByRole('progressbar', { name: '区间打卡进度', exact: true }).getAttribute('aria-valuenow'), '2')
  const positions = await panel.evaluate(() => ({ period: document.querySelector('.attendance-period').getBoundingClientRect().top, today: document.querySelector('.desktop-today-records').getBoundingClientRect().top, blur: getComputedStyle(document.querySelector('.desktop-panel')).backdropFilter }))
  assert.ok(positions.period < positions.today); assert.equal(positions.blur, 'none')
  await panel.screenshot({ path: join(output, 'period.png'), scale: 'css' })
  pass('the selected whole-month total and percentage use existing workday and absence rules above Today segments')
  await choose(panel, '2025-12', '2026-01')
  assert.match(await panel.locator('.attendance-period-total').innerText(), /2\s*\//)
  await choose(panel, '2026-08', '2026-08')
  assert.match(await panel.locator('.attendance-period-total').innerText(), /6\s*\/ 252 小时/)
  assert.equal(unwrap(await panel.evaluate(() => window.workbench.researchReport())).checkins.length, 4)
  await panel.getByRole('button', { name: '选择统计月份', exact: true }).click()
  assert.equal((await rail.evaluate(() => window.workbench.openDesktopPanel('tasks'))).ok, false)
  await panel.screenshot({ path: join(output, 'period-edit.png'), scale: 'css' })
  await panel.getByRole('button', { name: '选择统计月份', exact: true }).click()
  pass('changing or crossing years leaves saved check-ins intact; an open period editor is retained')
  unwrap(await panel.evaluate(() => window.workbench.updateWidgetPreferences({ scale: .8 })))
  await panel.waitForTimeout(300)
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  await panel.screenshot({ path: join(output, 'scaled.png'), scale: 'css' })
  unwrap(await panel.evaluate(() => window.workbench.updateWidgetPreferences({ scale: null })))
  await rail.locator('#workbench').click()
  let main = await pageWith('index.html')
  await main.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const firstId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).id)
  await main.evaluate(() => window.workbench.returnToDesktop()).catch(() => {})
  await noWorkbench()
  assert.equal(main.isClosed(), true)
  assert.equal(unwrap(await panel.evaluate(() => window.workbench.researchReport())).checkins.length, 4)
  await rail.locator('#workbench').click()
  main = await pageWith('index.html')
  await main.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const nextId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).id)
  assert.notEqual(nextId, firstId)
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html')).close())
  await noWorkbench()
  pass('returning and closing destroy the full workbench renderer; reopening creates a new window and keeps the panel data')
  assert.equal(await app.evaluate(({ app }) => app.commandLine.getSwitchValue('disk-cache-size')), '33554432')
  await app.close(); app = null
  await start(); rail = await pageWith('rail.html')
  unwrap(await rail.evaluate(() => window.workbench.openDesktopPanel('checkin')))
  panel = await pageWith('widget.html')
  await panel.getByText('2026.08 — 2026.08', { exact: true }).waitFor()
  assert.match(await panel.locator('.attendance-period-total').innerText(), /6\s*\/ 252 小时/)
  pass('the month selection survives restart and the disk cache has a 32 MiB limit')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, errors, positions }, null, 2))
} catch (error) {
  const panel = app?.windows().find(page => page.url().includes('widget.html'))
  if (panel) await panel.screenshot({ path: join(output, 'failure.png'), scale: 'css' }).catch(() => {})
  throw error
} finally { if (app) await app.close() }
