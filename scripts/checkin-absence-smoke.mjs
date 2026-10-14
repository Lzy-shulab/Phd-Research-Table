import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const evidence = resolve(process.env.WORKBENCH_TEST_EVIDENCE || join('test-results', `absence-${version}`, 'packaged'))
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const executablePath = resolve(process.env.WORKBENCH_TEST_EXECUTABLE || 'release/win-unpacked/PhD 科研工作台.exe')
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const errors = [], checks = [], layouts = []
let app, page
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
const checkins = () => page.locator('#report-checkins')
const goal = () => page.getByRole('article', { name: '打卡时长', exact: true })
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function launch() {
  app = await electron.launch({ executablePath, env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1000); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  const boot = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.ok(boot.databasePath.startsWith(profile))
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '研究报表', exact: true }).click()
  await page.getByRole('heading', { name: '研究打卡', exact: true }).waitFor()
  for (const label of ['研究打卡', '打卡时长']) await page.getByLabel(`${label}月份`, { exact: true }).fill('2026-09')
}
async function register(kind, start, end, notes) {
  await checkins().getByRole('button', { name: `登记${kind}`, exact: true }).click()
  await page.getByLabel('出差或休假开始日期', { exact: true }).fill(start)
  await page.getByLabel('出差或休假结束日期', { exact: true }).fill(end)
  await page.getByLabel('出差或休假备注', { exact: true }).fill(notes)
  await page.getByRole('button', { name: `保存${kind}日期`, exact: true }).click()
  await page.getByRole('form', { name: '出差与休假日期' }).waitFor({ state: 'detached' })
}
async function chooseWeek(label, index) {
  const scope = label === '研究打卡' ? checkins() : goal()
  await scope.getByRole('button', { name: '按周', exact: true }).click()
  await page.getByRole('combobox', { name: `${label}周次`, exact: true }).click()
  await page.getByRole('option').nth(index).click()
}
async function layout(name) {
  const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('#report-checkins, .report-goal, .report-absence-form, .report-panel-actions, .report-absence-row')]
      .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className) }))
  assert.ok(result.document <= result.width)
  assert.deepEqual(result.overflow, [], name)
  layouts.push({ name, ...result })
}
try {
  await launch()
  unwrap(await page.evaluate(async () => {
    for (const input of [
      { date: '2026-09-07', startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '跨周实验' },
      { date: '2026-09-09', startTime: '09:00', endTime: '11:00', endsNextDay: false, notes: '文献阅读' },
      { date: '2026-09-14', startTime: '09:00', endTime: '10:00', endsNextDay: false, notes: '结果整理' },
      { date: '2026-09-30', startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '跨月实验' }
    ]) { const result = await window.workbench.saveCheckin(input); if (!result.ok) return result }
    return window.workbench.researchReport()
  }))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '研究报表', exact: true }).click()
  for (const label of ['研究打卡', '打卡时长']) await page.getByLabel(`${label}月份`, { exact: true }).fill('2026-09')
  await register('出差', '2026-09-06', '2026-09-08', '学术会议')
  await register('休假', '2026-09-14', '2026-09-14', '年假')
  await page.waitForFunction(() => document.querySelector('#report-checkins .report-checkin-totals').innerText.includes('3 小时'))
  assert.match(await checkins().locator('.report-checkin-totals').innerText(), /3 小时.*2\s*天.*216 小时/s)
  assert.match(await goal().innerText(), /3 小时.*目标 216 小时.*22 个工作日/s)
  assert.equal(await checkins().locator('[data-date="2026-09-06"]').getAttribute('data-value'), '0')
  assert.equal(await checkins().locator('[data-date="2026-09-07"]').getAttribute('data-value'), '0')
  assert.equal(await checkins().locator('[data-date="2026-09-07"] .report-day-badge').innerText(), '差')
  assert.equal(await checkins().locator('[data-date="2026-09-14"] .report-day-badge').innerText(), '假')
  await checkins().locator('[data-date="2026-09-07"]').click()
  assert.match(await checkins().locator('.report-day-summary').innerText(), /出差.*目标扣除 12 小时/)
  assert.equal(await checkins().locator('.report-checkin-row').count(), 1)
  await page.mouse.move(0, 0)
  await checkins().scrollIntoViewIfNeeded(); await layout('desktop-month'); await shot('01-month')
  pass('trip and leave dates deduct twelve target hours, including Sunday, without generated check-ins')
  await chooseWeek('研究打卡', 1); await chooseWeek('打卡时长', 1)
  assert.match(await checkins().locator('.report-checkin-totals').innerText(), /2 小时.*36 小时/s)
  assert.match(await goal().innerText(), /2 小时.*目标 36 小时/s)
  pass('weekly panel and goal card share the same clipped deduction')
  await checkins().getByRole('button', { name: '按月', exact: true }).click()
  await goal().getByRole('button', { name: '按月', exact: true }).click()
  await checkins().getByRole('button', { name: '编辑休假 2026-09-14' }).click()
  await page.getByLabel('出差或休假开始日期', { exact: true }).fill('2026-09-15')
  await page.getByRole('button', { name: '保存日期修改', exact: true }).click()
  await page.getByRole('form', { name: '出差与休假日期' }).waitFor({ state: 'detached' })
  assert.match(await checkins().locator('.report-checkin-totals').innerText(), /4 小时.*216 小时/s)
  await checkins().getByRole('button', { name: '移除休假 2026-09-15' }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.match(await checkins().locator('.report-checkin-totals').innerText(), /4 小时.*228 小时/s)
  await register('休假', '2026-09-14', '2026-09-14', '年假')
  await register('休假', '2026-09-12', '2026-09-13', '周末休假')
  assert.match(await checkins().locator('.report-checkin-totals').innerText(), /3 小时.*2\s*天.*192 小时/s)
  for (const date of ['2026-09-12', '2026-09-13']) assert.equal(await checkins().locator(`[data-date="${date}"]`).getAttribute('data-value'), '0')
  await checkins().locator('[data-date="2026-09-13"]').click()
  assert.match(await checkins().locator('.report-day-summary').innerText(), /休假.*目标扣除 12 小时/)
  assert.match(await checkins().locator('.report-day-empty').innerText(), /已从周、月目标扣除 12 小时/)
  pass('edits and removal recalculate targets; weekend leave deducts twenty-four hours without manual records')
  const saved = unwrap(await page.evaluate(() => window.workbench.researchReport()))
  assert.equal(saved.absences.length, 3); assert.equal(saved.checkins.length, 4)
  await app.close(); app = null
  await launch()
  assert.deepEqual(unwrap(await page.evaluate(() => window.workbench.researchReport())), saved)
  assert.match(await checkins().locator('.report-checkin-totals').innerText(), /3 小时.*192 小时/s)
  pass('packaged restart persists trip/leave dates and original check-in records')
  await checkins().getByRole('button', { name: '登记出差', exact: true }).click()
  await checkins().scrollIntoViewIfNeeded(); await layout('desktop-form'); await shot('02-form-desktop')
  await page.getByRole('form', { name: '出差与休假日期' }).getByRole('button', { name: '取消', exact: true }).click()
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '研究报表', exact: true }).click()
  for (const label of ['研究打卡', '打卡时长']) await page.getByLabel(`${label}月份`, { exact: true }).fill('2026-09')
  await checkins().getByRole('button', { name: '登记休假', exact: true }).click()
  await checkins().scrollIntoViewIfNeeded(); await layout('narrow-large-type'); await shot('03-form-narrow')
  await page.getByRole('form', { name: '出差与休假日期' }).getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await checkins().scrollIntoViewIfNeeded(); await layout('narrow-dark'); await shot('04-dark-narrow')
  pass('desktop and compact layouts support eighteen-pixel text, forms, keyboard labels and dark mode')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ version, checks, layouts, errors }, null, 2))
} catch (error) {
  if (page) await shot('failure').catch(() => {})
  throw error
} finally { if (app) await app.close() }
