import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executable = process.argv.find(arg => arg.startsWith('--executable='))?.slice(13)
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-results/codex-quota/ui')
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, `profile-${Date.now()}`), WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(20000)
const errors = [], checks = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
const pageWith = async text => {
  for (let index = 0; index < 100; index++) {
    const page = app.windows().find(page => page.url().includes(text))
    if (page) return page
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Missing ${text}`)
}
const pass = message => { checks.push(message); console.log('PASS', message) }
const publish = snapshot => app.evaluate(({ BrowserWindow }, state) => { for (const window of BrowserWindow.getAllWindows()) window.webContents.send('codex:usage-changed', state) }, snapshot)
const geometry = page => page.evaluate(() => {
  const panel = document.querySelector('.desktop-panel').getBoundingClientRect()
  return { width: innerWidth, height: innerHeight, panelWidth: panel.width, panelHeight: panel.height,
    overflow: document.documentElement.scrollWidth > innerWidth,
    clipped: [...document.querySelectorAll('.codex-window,.codex-reset-toggle,.desktop-panel-footer button')].some(element => { const rect = element.getBoundingClientRect(); return rect.x < 0 || rect.right > innerWidth + 1 || rect.bottom > innerHeight + 1 }) }
})
try {
  const rail = await pageWith('rail.html')
  await rail.getByRole('button', { name: 'Codex 额度', exact: true }).waitFor()
  assert.equal(app.windows().length, 1)
  await rail.getByRole('button', { name: 'Codex 额度', exact: true }).click()
  const panel = await pageWith('panel=codex')
  await panel.getByRole('button', { name: '刷新额度', exact: true }).waitFor()
  assert.equal(app.windows().length, 2)
  pass('quota panel opens on demand without creating the workbench')
  const now = Date.now()
  const single = { windows: [{ label: '本周', durationMinutes: 10080, remainingPercent: 76, resetsAt: now + 86400000 }], availableResetCredits: 3, resetExpirations: [now + 86400000 * 7, now + 86400000 * 14, null], updatedAt: now, error: null }
  await publish(single)
  await panel.getByRole('progressbar', { name: '本周剩余额度' }).waitFor()
  await rail.getByText('周 76%', { exact: true }).waitFor()
  await panel.getByRole('button', { name: /完整重置/ }).click()
  await panel.getByText('到期时间未提供', { exact: true }).waitFor()
  await panel.waitForTimeout(600)
  await panel.screenshot({ path: join(output, 'single-window.png'), scale: 'css' })
  pass('single window, remaining percentage and reset expiry details render from supplied data')
  const dual = { ...single, windows: [{ label: '5 小时', durationMinutes: 300, remainingPercent: 8, resetsAt: now + 3600000 }, ...single.windows] }
  await publish(dual)
  await panel.getByRole('progressbar', { name: '5 小时剩余额度' }).waitFor()
  await rail.getByText('5h 8% / 周 76%', { exact: true }).waitFor()
  await panel.waitForTimeout(600)
  await panel.screenshot({ path: join(output, 'dual-window.png'), scale: 'css' })
  await rail.screenshot({ path: join(output, 'rail.png'), scale: 'css' })
  const full = await geometry(panel)
  assert.equal(full.overflow, false); assert.equal(full.clipped, false)
  assert.ok(Math.abs(full.panelWidth - full.width) < 1 && Math.abs(full.panelHeight - full.height) < 1)
  const railFits = await rail.evaluate(() => [...document.querySelectorAll('nav button')].every(button => button.getBoundingClientRect().bottom <= innerHeight))
  assert.equal(railFits, true)
  pass('dual windows and all seven rail entries fit without clipping')
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('rail.html')); window.setSize(176, 480) })
  await rail.getByRole('button', { name: '打开 PhD 工作台', exact: true }).scrollIntoViewIfNeeded()
  assert.equal(await rail.evaluate(() => document.querySelector('#workbench').getBoundingClientRect().bottom <= innerHeight), true)
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('rail.html')); window.setSize(176, 536) })
  pass('short display areas keep the launcher reachable by scrolling')
  unwrap(await panel.evaluate(() => window.workbench.updateWidgetPreferences({ scale: .8 })))
  await panel.waitForTimeout(250)
  const scaled = await geometry(panel)
  assert.equal(scaled.overflow, false); assert.equal(scaled.clipped, false)
  await panel.screenshot({ path: join(output, 'scaled.png'), scale: 'css' })
  pass('manual 80% scale preserves panel layout')
  await publish({ ...dual, error: '暂时无法读取 Codex 额度，请稍后刷新。' })
  await panel.getByText('显示上次读取结果', { exact: true }).waitFor()
  await rail.getByText('待更新', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('progressbar', { name: '本周剩余额度' }).getAttribute('aria-valuenow'), '76')
  pass('failed updates retain values and mark the summary as stale')
  await publish({ ...single, availableResetCredits: null, resetExpirations: null, windows: [{ ...single.windows[0], remainingPercent: null }] })
  await panel.getByText('完整重置次数暂未提供', { exact: true }).waitFor()
  assert.equal(await panel.getByRole('progressbar', { name: '本周剩余额度' }).getAttribute('aria-valuenow'), null)
  pass('unavailable values remain unknown rather than displaying zero')
  unwrap(await panel.evaluate(() => window.workbench.updateWidgetPreferences({ scale: null })))
  const real = unwrap(await panel.evaluate(() => window.workbench.codexUsage(true)))
  assert.equal(real.error, null, real.error)
  assert.ok(real.updatedAt && real.windows.length > 0)
  await panel.waitForTimeout(600)
  await panel.screenshot({ path: join(output, 'live.png'), scale: 'css' })
  pass('installed Codex app-server returns real account quota through the desktop IPC')
  await rail.getByRole('button', { name: '任务总览', exact: true }).click()
  await panel.getByRole('tablist', { name: '任务范围' }).waitFor()
  await rail.getByRole('button', { name: 'Codex 额度', exact: true }).click()
  await panel.getByRole('button', { name: '刷新额度', exact: true }).waitFor()
  await panel.getByRole('button', { name: '刷新额度', exact: true }).click()
  await panel.getByRole('button', { name: '刷新额度', exact: true }).waitFor({ state: 'visible' })
  await panel.waitForFunction(() => !document.querySelector('[aria-label="刷新额度"]').disabled)
  await panel.emulateMedia({ reducedMotion: 'reduce' })
  await panel.getByRole('button', { name: '收起面板', exact: true }).click()
  await panel.waitForTimeout(250)
  await rail.getByRole('button', { name: 'Codex 额度', exact: true }).click()
  await panel.waitForTimeout(250)
  assert.ok(await panel.evaluate(() => Number(getComputedStyle(document.querySelector('.desktop-header')).opacity) > .9))
  pass('switching, refresh and reduced-motion collapse/reopen remain usable')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, errors, geometry: { full, scaled }, liveWindows: real.windows.length, liveResetCountProvided: real.availableResetCredits !== null }, null, 2))
} finally { await app.close() }
