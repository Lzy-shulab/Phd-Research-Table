import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results', 'approved-refinement-' + version, executablePath ? 'packaged' : 'development')
const profile = join(evidence, 'data-' + Date.now())
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], layouts = [], traces = {}
let app, page, databasePath
const get = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
const settleWorkspace = () => page.waitForFunction(() => {
  const stage = document.querySelector('.workspace-stage')
  if (!stage) return false
  const style = getComputedStyle(stage), matrix = new DOMMatrixReadOnly(style.transform)
  return Number(style.opacity) > 0.999 && Math.abs(matrix.m42) < 0.1
})
const nav = async name => {
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
  const workspace = { 设置: '.settings-workspace', 研究计划: '.planner-workspace', 研究报表: '.reports-workspace', 科研成果: '.outputs-workspace', 论文投稿: '.submissions-workspace' }[name]
  await page.locator(workspace).waitFor({ state: 'visible' })
  await settleWorkspace()
}
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1050); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  databasePath = get(await page.evaluate(() => window.workbench.bootstrap())).databasePath
  assert.ok(databasePath.startsWith(profile + '\\'), 'Tests must use an isolated database')
}
const storedCountdowns = () => {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try { return JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get('planner.countdowns.v1')?.value || '[]') }
  finally { db.close() }
}
async function geometry(name) {
  await settleWorkspace()
  const result = await page.evaluate(() => ({
    name: document.querySelector('main')?.className,
    width: innerWidth,
    documentWidth: document.documentElement.scrollWidth,
    headerBorder: getComputedStyle(document.querySelector('.workspace-header')).borderBottomWidth,
    overflow: [...document.querySelectorAll('.report-panel, .report-goal, .background-option, .plan-note, .book-detail-information, .book-detail-actions')]
      .filter(el => el.scrollWidth > el.clientWidth + 2).map(el => ({ className: el.className, width: el.clientWidth, scroll: el.scrollWidth }))
  }))
  assert.equal(result.headerBorder, '0px', name)
  assert.ok(result.documentWidth <= result.width + 1, name)
  assert.deepEqual(result.overflow, [], name)
  layouts.push({ label: name, ...result })
}
async function shot(name) {
  await settleWorkspace()
  await page.screenshot({ path: join(evidence, name + '.png'), animations: 'disabled', scale: 'css' })
}
async function traceClick(locator, selector, milliseconds = 1050) {
  const handle = await locator.elementHandle()
  return page.evaluate(async ({ element, selector, milliseconds }) => {
    const frames = [], start = performance.now()
    element.click()
    await new Promise(done => {
      const collect = () => {
        const target = document.querySelector(selector)
        if (target) frames.push({ ms: Math.round(performance.now() - start), transform: getComputedStyle(target).transform, opacity: getComputedStyle(target).opacity })
        if (performance.now() - start >= milliseconds) done()
        else requestAnimationFrame(collect)
      }
      requestAnimationFrame(collect)
    })
    return frames
  }, { element: handle, selector, milliseconds })
}
try {
  await launch()
  const publicationSources = Array.from({ length: 7 }, (_, index) => {
    const source = join(evidence, 'fixture-publication-' + index + '.pdf')
    writeFileSync(source, Buffer.concat([readFileSync(resolve('tests/fixtures/translation-check.pdf')), Buffer.from('\n% Synthetic publication ' + index + '\n')]))
    return source
  })
  const fixture = await page.evaluate(async sources => {
    const get = result => { if (!result.ok) throw Error(result.error.message); return result.data }
    const tasks = []
    for (const [name, colorKey] of [['材料光谱实验', 'sage'], ['论文写作', 'blue'], ['文献整理', 'slate']]) {
      const project = get(await window.workbench.createProject({ name, colorKey, description: '隔离界面验证项目' }))
      for (let index = 0; index < 6; index++) {
        const task = get(await window.workbench.createTask({ title: index === 0 ? '整理不同矿物颜料的高光谱响应与材料实验记录，核对跨批次结果' : name + ' · 任务 ' + (index + 1), projectId: project.id, scheduledDate: '2026-09-29' }))
        if (index < 2) { get(await window.workbench.completeTask(task.id, true)); tasks.push(task.id) }
      }
    }
    for (let index = 0; index < 7; index++) get(await window.workbench.createPublication(sources[index], {
      title: index === 0 ? 'Material Spectra: An Editable Research Record' : 'Research Publication ' + (index + 1),
      authors: 'Lin Researcher, Chen Researcher', journal: index % 2 ? 'Journal of Material Research' : 'Spectral Research',
      publishedDate: (2026 - index % 3) + '-06-15', casPartition: '1区', jcrQuartile: 'Q1', doi: '',
      honors: index === 0 ? ['best-paper'] : [], notes: '隔离验收样例，元数据仅供界面检查。'
    }))
    get(await window.workbench.saveCheckin({ date: '2026-09-01', startTime: '08:00', endTime: '18:45', endsNextDay: false, notes: '隔离验收记录' }))
    get(await window.workbench.updateInterfacePreferences({ fontSize: 14 }))
    return { tasks }
  }, publicationSources)
  await app.close()
  const db = new DatabaseSync(databasePath)
  fixture.tasks.forEach(id => db.prepare('UPDATE tasks SET completed_at=? WHERE id=?').run('2026-09-24T04:00:00Z', id))
  const future = { id: randomUUID(), title: '未来的重要日期', deadline: new Date(Date.now() + 86_400_000).toISOString(), createdAt: new Date().toISOString() }
  const old = { id: randomUUID(), title: '关闭期间已到期', deadline: new Date(Date.now() - 60_000).toISOString(), createdAt: new Date(Date.now() - 120_000).toISOString() }
  db.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('planner.countdowns.v1', JSON.stringify([future, old]))
  db.close()
  await launch()
  assert.deepEqual(storedCountdowns().map(item => item.id), [future.id])
  pass('startup removes only expired independent countdowns')
  await nav('设置')
  const deadline = new Date(Date.now() + 1700).toISOString()
  get(await page.evaluate(deadline => window.workbench.saveCountdown({ title: '其他页面到期事件', deadline }), deadline))
  await delay(1950)
  assert.deepEqual(storedCountdowns().map(item => item.id), [future.id])
  pass('main process expires countdowns while another page is open')
  await page.locator('.background-options').scrollIntoViewIfNeeded()
  const backgrounds = await page.locator('.background-option').evaluateAll(items => items.map(item => ({ x: item.offsetLeft, y: item.offsetTop, width: item.clientWidth })))
  assert.equal(backgrounds.filter(item => item.y === backgrounds[0].y).length, 6)
  assert.ok(Math.max(...backgrounds.map(item => item.width)) - Math.min(...backgrounds.map(item => item.width)) <= 1)
  await geometry('backgrounds-desktop'); await shot('01-backgrounds-six-columns')
  pass('background previews use six equal columns on the desktop')
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  const card = page.locator('.plan-note').first()
  await card.waitFor()
  const cardRows = await card.locator('.plan-note-task-scroll').evaluate(list => {
    const rect = list.getBoundingClientRect(), rows = [...list.querySelectorAll('.task-row')]
    return { visible: rows.filter(row => { const bounds = row.getBoundingClientRect(); return bounds.top >= rect.top - 1 && bounds.bottom <= rect.bottom + 1 }).length, viewport: list.clientHeight, content: list.scrollHeight, tabIndex: list.tabIndex }
  })
  assert.equal(cardRows.visible, 3); assert.ok(cardRows.content > cardRows.viewport); assert.equal(cardRows.tabIndex, 0)
  await card.locator('.plan-note-task-scroll').focus()
  await page.keyboard.press('End')
  await page.waitForFunction(() => document.querySelector('.plan-note-task-scroll').scrollTop > 0)
  await card.locator('.plan-note-task-scroll').evaluate(el => { el.scrollTop = 0 })
  await geometry('planner-desktop'); await shot('02-three-task-cards')
  pass('three visible tasks retain keyboard-accessible internal scrolling')
  await nav('设置')
  const liveDeadline = new Date(Date.now() + 6000).toISOString()
  get(await page.evaluate(deadline => window.workbench.saveCountdown({ title: '当前页面即将到期', deadline }), liveDeadline))
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await page.getByRole('heading', { name: '全部任务', exact: true }).waitFor()
  await page.getByText('当前页面即将到期', { exact: true }).waitFor({ timeout: 7500 })
  await page.getByText('当前页面即将到期', { exact: true }).waitFor({ state: 'hidden', timeout: 9000 })
  assert.deepEqual(storedCountdowns().map(item => item.id), [future.id])
  assert.equal(get(await page.evaluate(() => window.workbench.bootstrap())).tasks.length, 18)
  pass('visible countdown clears at its deadline and research tasks remain intact')
  await nav('研究报表')
  await page.getByRole('heading', { name: '科研活动', exact: true }).waitFor()
  for (const label of ['打卡时长', '科研活动']) await page.getByLabel(label + '月份', { exact: true }).fill('2026-09')
  assert.match(await page.getByRole('article', { name: '打卡时长', exact: true }).innerText(), /264 小时.*22 个工作日/s)
  const activity = page.locator('#report-trends')
  assert.equal(await activity.locator('[data-date="2026-09-20"] .is-work').innerText(), '班')
  assert.equal(await activity.locator('.report-side-detail .report-projects').count(), 0)
  const reportGeometry = await activity.evaluate(panel => {
    const calendar = panel.querySelector('.report-activity-calendar').getBoundingClientRect()
    const detail = panel.querySelector('.report-side-detail').getBoundingClientRect()
    const projects = panel.querySelector('.report-activity-projects').getBoundingClientRect()
    return { calendarBottom: calendar.bottom, detailBottom: detail.bottom, projectsTop: projects.top, projectWidth: projects.width, panelWidth: panel.clientWidth }
  })
  assert.ok(reportGeometry.projectsTop >= Math.max(reportGeometry.calendarBottom, reportGeometry.detailBottom))
  assert.ok(reportGeometry.projectsTop - reportGeometry.calendarBottom < 30)
  assert.ok(reportGeometry.projectWidth > reportGeometry.panelWidth * 0.8)
  await geometry('reports-desktop'); await shot('03-compact-reports')
  pass('September uses 22 official workdays and project distribution follows the calendar without the old blank region')
  traces.entrance = await traceClick(page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '科研成果', exact: true }), '.book-arrival')
  assert.ok(new Set(traces.entrance.map(frame => frame.transform)).size > 3, 'Books must animate on entering the page')
  await page.getByTestId('publication-book').first().waitFor()
  await geometry('bookshelf-desktop'); await shot('04-bookshelf')
  const firstBook = page.getByTestId('publication-book').first()
  traces.open = await traceClick(firstBook, '.book-opening-cover')
  assert.ok(new Set(traces.open.map(frame => frame.transform)).size > 4, 'Cover opening must have visible intermediate rotations')
  await page.locator('.book-title-page .pdf-cover img').waitFor()
  await geometry('book-open'); await shot('05-book-open')
  traces.close = await traceClick(page.getByRole('button', { name: '放回书架', exact: true }), '.book-opening-cover')
  assert.ok(new Set(traces.close.map(frame => frame.transform)).size > 3, 'Cover closing must have intermediate rotations')
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  assert.equal(await firstBook.evaluate(el => el === document.activeElement), true)
  pass('book arrival, opening and closing have measurable animation and return focus to the spine')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await nav('科研成果')
  await firstBook.click()
  await page.getByTestId('publication-detail').waitFor()
  assert.equal(await page.locator('.book-opening-cover').count(), 0)
  await page.keyboard.press('Escape')
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  await page.emulateMedia({ reducedMotion: 'no-preference' })
  pass('reduced motion uses an accessible fade and preserves opening and closing')
  await nav('论文投稿'); await geometry('submissions-header')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1080, 850))
  get(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.textSize === '18' && !document.documentElement.dataset.visualStyle)
  await nav('设置')
  await page.locator('.background-options').scrollIntoViewIfNeeded()
  assert.ok(await page.locator('.background-options').evaluate(el => el.scrollWidth <= el.clientWidth + 1))
  await geometry('settings-narrow-large-type'); await shot('06-backgrounds-narrow-large-type')
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await card.waitFor()
  await geometry('planner-narrow-large-type'); await shot('07-planner-narrow-large-type')
  await nav('研究报表'); await page.getByRole('heading', { name: '科研活动', exact: true }).waitFor()
  await geometry('reports-narrow-large-type'); await shot('08-reports-narrow-large-type')
  pass('narrow windows and large text preserve layout across the affected modules')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ version, executablePath, profile, checks, layouts, reportGeometry, cardRows, traces, errors }, null, 2))
  console.log('ALL ' + checks.length + ' APPROVED REFINEMENT CHECKS PASSED')
} finally { if (app) await app.close() }
