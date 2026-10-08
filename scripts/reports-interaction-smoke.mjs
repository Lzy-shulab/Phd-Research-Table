import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const evidence = resolve('test-results', `interaction-${version}`, executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = [], checks = [], layouts = []
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = text => { checks.push(text); console.log('PASS', text) }
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1050); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.addStyleTag({ content: '* { scroll-behavior: auto !important; }' })
}
async function layout(name) {
  const result = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth,
    overflow: [...document.querySelectorAll('.report-panel, .report-goal, .report-local-period, .visual-style-option')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => ({ class: el.className, width: el.clientWidth, content: el.scrollWidth })) }))
  assert.ok(result.document <= result.width); assert.deepEqual(result.overflow, [], name); layouts.push({ name, ...result })
}
async function chooseWeek(label, index) {
  await page.getByRole('combobox', { name: `${label}周次`, exact: true }).click()
  await page.getByRole('option').nth(index).click()
}
try {
  await launch()
  const initial = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.ok(initial.databasePath.startsWith(profile))
  const fixture = await page.evaluate(async path => {
    const get = result => { if (!result.ok) throw Error(result.error.message); return result.data }
    const project = get(await window.workbench.createProject({ name: '光谱研究', colorKey: 'sage', description: '' }))
    const task = get(await window.workbench.createTask({ title: '完成材料光谱实验与结果整理', projectId: project.id }))
    get(await window.workbench.completeTask(task.id, true))
    get(await window.workbench.importPapers([path], null, false))
    const paper = get(await window.workbench.librarySnapshot()).papers[0]
    get(await window.workbench.updatePaper(paper.id, { readingStatus: 'done' }))
    const snapshot = get(await window.workbench.researchReport())
    if (!snapshot.readingDates[paper.id]) throw Error('completion date did not sync')
    get(await window.workbench.saveCheckin({ date: '2026-09-01', startTime: '08:00', endTime: '18:45', endsNextDay: false, notes: '材料实验与文献阅读' }))
    get(await window.workbench.saveCheckin({ date: '2026-08-31', startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '跨日实验' }))
    return { task: task.id, paper: paper.id }
  }, resolve('tests/fixtures/translation-check.pdf'))
  await app.close()
  const db = new DatabaseSync(initial.databasePath)
  db.prepare('UPDATE tasks SET completed_at=? WHERE id=?').run('2026-09-01T04:00:00Z', fixture.task)
  db.prepare('UPDATE app_settings SET value=? WHERE key=?').run(JSON.stringify({ [fixture.paper]: '2026-09-01' }), 'research.reading-dates.v1')
  db.prepare('INSERT INTO papers(id,collection,title,original_name,source_path,sha256,reading_status,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), 'library', '无日期的历史文献', 'test.pdf', resolve('tests/fixtures/translation-check.pdf'), randomUUID(), 'done', new Date().toISOString(), new Date().toISOString())
  db.close()
  await launch(); await nav('研究报表')
  await page.getByRole('heading', { name: '科研活动', exact: true }).waitFor()
  for (const label of ['完成任务', '读完论文', '打卡时长', '科研活动', '研究打卡']) await page.getByLabel(`${label}月份`, { exact: true }).fill('2026-09')
  const activity = page.locator('#report-trends'), checkins = page.locator('#report-checkins')
  assert.equal(await page.locator('.report-reading-dates, .report-ledger').count(), 0)
  assert.equal(await activity.locator('[data-date="2026-09-01"]').getAttribute('data-value'), '1')
  assert.ok((await activity.innerText()).includes('1 篇历史已读'))
  await activity.locator('[data-date="2026-09-01"]').click()
  assert.equal(await activity.locator('.report-day-detail .report-source-row').count(), 2)
  assert.equal(await activity.locator('[data-date="2026-09-01"]').evaluate(el => el.classList.contains('is-selected')), true)
  await activity.locator('[data-date="2026-09-02"]').locator('..').focus(); await page.keyboard.press('Enter')
  assert.equal(await activity.locator('.report-day-detail .report-source-row').count(), 0)
  await activity.locator('[data-date="2026-09-01"]').click()
  for (const panel of [activity, checkins]) {
    assert.equal(await panel.locator('[data-date="2026-09-25"] .report-day-badge').innerText(), '法')
    assert.equal(await panel.locator('[data-date="2026-09-19"] .report-day-badge').innerText(), '休')
    assert.equal(await panel.locator('[data-date="2026-09-20"] .report-day-badge').count(), 0)
  }
  pass('automatic cross-page records, undated legacy handling, click/keyboard details and holiday marks')
  const clockGoal = page.getByRole('article', { name: '打卡时长', exact: true })
  await clockGoal.getByRole('button', { name: '按周', exact: true }).click(); await chooseWeek('打卡时长', 1)
  assert.equal(await page.getByRole('combobox', { name: '打卡时长周次' }).innerText(), '9月第二周')
  const rects = await page.locator('.report-goal').evaluateAll(nodes => nodes.map(el => ({ top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })))
  assert.ok(Math.max(...rects.map(r => r.height)) - Math.min(...rects.map(r => r.height)) < 1)
  const controls = await clockGoal.locator('input[type="month"], .report-week-trigger').evaluateAll(nodes => nodes.map(el => ({ top: el.getBoundingClientRect().top, left: el.getBoundingClientRect().left })))
  assert.ok(Math.abs(controls[0].top - controls[1].top) < 1 && controls[1].left > controls[0].left)
  await page.getByRole('combobox', { name: '打卡时长周次' }).click()
  assert.equal(await page.getByRole('option').nth(1).innerText(), '9月第二周（9.8–9.14）')
  await page.keyboard.press('Escape')
  await layout('desktop-mixed-periods'); await page.locator('.report-goals').scrollIntoViewIfNeeded(); await shot('01-goals-and-activity')
  pass('mixed periods have equal-height cards and compact inline weekly selection')
  await checkins.locator('[data-date="2026-09-01"]').hover()
  assert.ok((await page.getByRole('tooltip').innerText()).includes('跨日实验'))
  await checkins.locator('[data-date="2026-09-01"]').click()
  assert.equal(await checkins.locator('.report-checkin-row').count(), 2)
  assert.ok((await checkins.locator('.report-day-summary').innerText()).includes('11 小时 45 分钟'))
  await page.mouse.move(0, 0); await checkins.scrollIntoViewIfNeeded(); await shot('02-checkin-details')
  await checkins.getByRole('button', { name: '编辑打卡 2026-09-01' }).click()
  await page.getByLabel('打卡备注', { exact: true }).fill('已修改的隔离测试备注')
  await page.getByRole('button', { name: '保存打卡修改' }).click()
  await checkins.getByText('已修改的隔离测试备注').waitFor()
  pass('hover shows notes and cross-day entries; inline day record editing persists')
  await activity.getByLabel('科研活动月份', { exact: true }).fill('2026-08')
  assert.equal(await activity.locator('.is-empty-period').count(), 1)
  await activity.scrollIntoViewIfNeeded(); await shot('02b-empty-period')
  await activity.getByLabel('科研活动月份', { exact: true }).fill('2026-09')
  await nav('设置'); await page.getByRole('heading', { name: '外观与显示', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '工作台风格', exact: true }).count(), 0)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.interfacePreferences())).preferences.visualStyle, 'classic')
  for (const [label, id] of [['默认', 'default'], ['青绿', 'sage'], ['极夜黑', 'midnight']]) {
    await page.getByRole('button', { name: `${label}背景`, exact: true }).click()
    await page.waitForFunction(id => document.documentElement.dataset.background === id, id)
    await nav('研究报表'); await activity.scrollIntoViewIfNeeded(); await layout(id); await shot(`03-background-${id}`)
    await nav('设置')
  }
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await nav('研究报表'); await activity.scrollIntoViewIfNeeded(); await shot('03a-classic-dark')
  await nav('设置')
  // One high-DPI-sized desktop capture in addition to the normal logical sizes.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(2044, 1248))
  await nav('研究报表'); await activity.scrollIntoViewIfNeeded(); await layout('wide-user-reference'); await shot('03b-wide-reference')
  await nav('设置'); await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1050))
  await page.locator('.background-options').scrollIntoViewIfNeeded(); await shot('04-background-picker')
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await nav('研究报表'); await activity.scrollIntoViewIfNeeded(); await shot('05-dark-classic')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 900))
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor(); await nav('研究报表')
  await page.getByRole('heading', { name: '科研活动', exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-visual-style'), null)
  await clockGoal.getByRole('button', { name: '按周', exact: true }).click(); await chooseWeek('打卡时长', 0)
  await layout('narrow-large-type'); await page.locator('.report-goals').scrollIntoViewIfNeeded(); await shot('06-narrow-large-type')
  await checkins.getByRole('button', { name: '按周', exact: true }).click(); await chooseWeek('研究打卡', 0)
  await checkins.scrollIntoViewIfNeeded(); await layout('narrow-weekly'); await shot('07-narrow-weekly')
  pass('the single geometric style retains source behavior and supports backgrounds, dark mode, reduced motion and large type')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ version, checks, layouts, errors, profile }, null, 2))
} catch (error) {
  if (page) await shot('failure').catch(() => {})
  throw error
} finally { if (app) await app.close() }
