import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
const evidence = resolve('test-results', `reports-redesign-${version}`, executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const checks = [], errors = [], layouts = []
let app, page
const pass = name => { checks.push(name); console.log('PASS', name) }
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version)
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1050); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' })
}
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function inspectLayout(name) {
  const geometry = await page.evaluate(() => ({
    viewport: innerWidth, documentWidth: document.documentElement.scrollWidth,
    overflowing: [...document.querySelectorAll('.report-panel, .report-goal, .plan-note')].filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.className)
  }))
  assert.ok(geometry.documentWidth <= geometry.viewport)
  assert.deepEqual(geometry.overflowing, [])
  layouts.push({ name, ...geometry })
}
try {
  await launch()
  const initial = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  const fixture = await page.evaluate(async () => {
    const get = result => { if (!result.ok) throw Error(result.error.message); return result.data }
    const research = get(await window.workbench.createProject({ name: '材料实验', description: '', colorKey: 'sage' }))
    const writing = get(await window.workbench.createProject({ name: '论文写作', description: '', colorKey: 'blue' }))
    const tasks = []
    for (let i = 0; i < 6; i++) tasks.push(get(await window.workbench.createTask({ title: i === 3 ? '长标题光谱响应实验与材料表征结果整理'.repeat(3) : `实验任务 ${i + 1}`, projectId: research.id })))
    for (let i = 0; i < 2; i++) tasks.push(get(await window.workbench.createTask({ title: `写作任务 ${i + 1}`, projectId: writing.id })))
    for (const task of [tasks[0], tasks[1], tasks[6]]) get(await window.workbench.completeTask(task.id, true))
    const snapshot = get(await window.workbench.researchReport())
    get(await window.workbench.saveReportSettings({ ...snapshot.settings, projectIds: [research.id, writing.id], projectsConfigured: true,
      goals: { week: { ...snapshot.settings.goals.week, tasks: 4, papers: 2 }, month: { ...snapshot.settings.goals.month, tasks: 10, papers: 6 } } }))
    get(await window.workbench.saveCheckin({ date: '2026-09-01', startTime: '08:00', endTime: '18:45', endsNextDay: false, notes: '实验与论文阅读' }))
    get(await window.workbench.saveStipend({ receivedOn: '2026-09-02', source: '助研津贴', amountCents: 160000, notes: '' }))
    get(await window.workbench.saveStipend({ receivedOn: '2026-09-15', source: '奖学金', amountCents: 50000, notes: '' }))
    get(await window.workbench.saveStipend({ receivedOn: '2026-03-15', source: '研究补助', amountCents: 30000, notes: '' }))
    return { tasks: tasks.map(task => task.id) }
  })
  await app.close()
  const database = new DatabaseSync(initial.databasePath)
  for (const [i, id] of fixture.tasks.entries()) database.prepare('UPDATE tasks SET completed_at=? WHERE id=? AND status=?').run(i === 1 ? '2026-09-08T04:00:00Z' : '2026-09-01T04:00:00Z', id, 'completed')
  const readingDates = {}, pdf = join(profile, 'fixture.pdf')
  writeFileSync(pdf, '%PDF-1.7\nSynthetic fixture\n%%EOF')
  for (let i = 0; i < 2; i++) {
    const id = randomUUID()
    database.prepare('INSERT INTO papers(id,collection,title,original_name,source_path,sha256,reading_status,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, 'library', `已读论文 ${i + 1}`, 'fixture.pdf', pdf, randomUUID(), 'done', new Date().toISOString(), new Date().toISOString())
    readingDates[id] = i ? '2026-09-08' : '2026-09-01'
  }
  database.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('research.reading-dates.v1', JSON.stringify(readingDates))
  database.close()
  await launch()
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await page.locator('.plan-note').first().waitFor()
  const cardGeometry = await page.locator('.plan-note').evaluateAll(cards => cards.map(card => {
    const list = card.querySelector('.plan-note-task-scroll'), rows = [...list.querySelectorAll('.task-row')], rect = list.getBoundingClientRect()
    return { height: card.getBoundingClientRect().height, count: rows.length, viewport: list.clientHeight, content: list.scrollHeight,
      visible: rows.filter(row => { const r = row.getBoundingClientRect(); return r.top >= rect.top - 1 && r.bottom <= rect.bottom + 1 }).length }
  }))
  assert.ok(Math.abs(cardGeometry[0].height - cardGeometry[1].height) < 1)
  assert.equal(cardGeometry.find(card => card.count === 6).visible, 3)
  assert.ok(cardGeometry.find(card => card.count === 6).content > cardGeometry.find(card => card.count === 6).viewport)
  await page.getByRole('region', { name: '材料实验任务列表' }).evaluate(list => { list.scrollTop = list.scrollHeight })
  assert.ok(await page.getByRole('region', { name: '材料实验任务列表' }).evaluate(list => list.scrollTop > 0))
  await inspectLayout('planner-desktop'); await shot('01-planner-three-rows')
  pass('equal-height project cards show three rows and scroll to all tasks')
  await nav('文献阅读'); await nav('研究报表')
  await page.getByRole('heading', { name: '科研活动', exact: true }).waitFor()
  for (const label of ['完成任务', '读完论文', '打卡时长', '科研活动', '研究打卡']) await page.getByLabel(`${label}月份`, { exact: true }).fill('2026-09')
  const activity = page.locator('#report-trends'), checkins = page.locator('#report-checkins'), finance = page.locator('#report-finance')
  await finance.getByLabel('津贴统计年份').selectOption('2026')
  const clockGoal = page.getByRole('article', { name: '打卡时长', exact: true })
  assert.ok((await clockGoal.innerText()).includes('264 小时'))
  assert.ok((await clockGoal.innerText()).includes('4.1%'))
  assert.equal(await page.getByText('查看图表数值', { exact: true }).count(), 0)
  assert.equal(await page.getByText(/最高刻度|到账明细/).count(), 0)
  assert.equal(await checkins.locator('.report-chart-bars').count(), 0)
  assert.equal(await activity.locator('.report-project-bars progress').count(), 2)
  pass('automatic September target is 264 hours, ring shows 4.1%, obsolete chart controls removed')
  await checkins.getByRole('button', { name: '按周', exact: true }).click()
  const weeks = checkins.getByLabel('研究打卡周次')
  await weeks.click()
  assert.deepEqual(await page.getByRole('option').allTextContents(), ['9月第一周（9.1–9.7）', '9月第二周（9.8–9.14）', '9月第三周（9.15–9.21）', '9月第四周（9.22–9.28）', '9月第五周（9.29–9.30）'])
  await page.getByRole('option').nth(0).click()
  assert.equal(await checkins.locator('.report-heat-cell').count(), 7)
  assert.ok((await checkins.locator('.report-checkin-totals').innerText()).includes('10 小时 45 分钟'))
  assert.equal(await activity.getByRole('button', { name: '按月', exact: true }).getAttribute('aria-pressed'), 'true')
  assert.equal(await clockGoal.getByRole('button', { name: '按月', exact: true }).getAttribute('aria-pressed'), 'true')
  await weeks.click(); await page.getByRole('option').nth(1).click()
  assert.ok((await checkins.locator('.report-checkin-totals').innerText()).startsWith('所选期间累计\n0 分钟'))
  await clockGoal.getByRole('button', { name: '按周', exact: true }).click()
  await clockGoal.getByLabel('打卡时长周次').click(); await page.getByRole('option').nth(0).click()
  assert.ok((await clockGoal.innerText()).includes('60 小时'))
  assert.ok((await clockGoal.innerText()).includes('17.9%'))
  await clockGoal.getByRole('button', { name: '按月', exact: true }).click()
  await checkins.getByRole('button', { name: '按月', exact: true }).click()
  pass('month-local weekly dropdown totals correctly and all five period selectors are independent')
  await activity.getByRole('button', { name: '任务', exact: true }).click()
  assert.equal(await activity.locator('[data-date="2026-09-01"]').getAttribute('data-value'), '2')
  await activity.locator('[data-date="2026-09-01"]').hover()
  assert.ok((await page.getByRole('tooltip').innerText()).includes('完成任务：2 项'))
  await page.mouse.move(0, 0)
  await finance.locator('.report-chart-column').nth(8).hover()
  const tip = page.getByRole('tooltip')
  assert.ok((await tip.innerText()).includes('2,100.00'))
  assert.equal(await tip.locator('span').filter({ hasText: /^来源：/ }).count(), 2)
  assert.ok((await tip.innerText()).includes('来源：助研津贴'))
  assert.ok((await tip.innerText()).includes('来源：奖学金'))
  await tip.waitFor({ state: 'visible' })
  await page.mouse.move(0, 0)
  await finance.locator('.report-hover-anchor').nth(8).focus()
  await page.getByRole('tooltip').waitFor()
  await page.screenshot({ path: join(evidence, '03-finance-hover.png'), animations: 'allow', scale: 'css' })
  await page.keyboard.press('Escape')
  assert.equal(await page.getByRole('tooltip').count(), 0)
  await finance.getByRole('button', { name: '管理记录', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '编辑津贴 助研津贴' }).click()
  await page.getByLabel('津贴金额', { exact: true }).fill('1700')
  await page.getByRole('button', { name: '保存津贴修改', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.report-finance-total').textContent.includes('2,500.00'))
  pass('pointer and keyboard tooltips list separate sources; record editing remains available')
  await activity.scrollIntoViewIfNeeded()
  await inspectLayout('reports-desktop'); await shot('02-reports-activity')
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await shot('04-reports-dark')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900))
  await activity.scrollIntoViewIfNeeded()
  await inspectLayout('reports-narrow'); await shot('05-reports-narrow')
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18, background: 'orange' })))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' })
  await nav('研究报表')
  await page.getByRole('heading', { name: '科研活动', exact: true }).waitFor()
  await activity.scrollIntoViewIfNeeded()
  await inspectLayout('reports-narrow-18px'); await shot('07-reports-large-text')
  await checkins.getByRole('button', { name: '按周', exact: true }).click()
  await checkins.getByLabel('研究打卡周次').click(); await page.getByRole('option').nth(0).click()
  await checkins.scrollIntoViewIfNeeded()
  await inspectLayout('checkins-narrow-18px'); await shot('08-checkins-week')
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await page.locator('.plan-note').first().waitFor({ state: 'visible' })
  await page.locator('.plan-note').first().scrollIntoViewIfNeeded()
  await inspectLayout('planner-narrow'); await shot('06-planner-narrow')
  assert.deepEqual(errors, [])
  pass('desktop and narrow layouts render without overflow or renderer errors')
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ version, profile, executablePath, checks, cardGeometry, layouts, errors }, null, 2))
} finally { if (app) await app.close() }
