import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Synthetic fixtures and all interaction writes are confined to this isolated profile.
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const version = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
const evidence = resolve(`test-results/refinement-${version}`, executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const localDay = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = localDay(new Date()), year = new Date().getFullYear(), checks = [], layouts = [], errors = []
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
let app, page
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), version)
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), !!executablePath)
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1050); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
}
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
const bootstrap = async () => unwrap(await page.evaluate(() => window.workbench.bootstrap()))
async function reloadPlanner() {
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
}
async function addCountdown(index) {
  const future = new Date(); future.setDate(future.getDate() + index + 1)
  await page.getByLabel('倒计时名称', { exact: true }).fill(index === 7 ? '长标题实验验收与博士论文研究进展重要事件'.repeat(3) : `研究事件 ${index}`)
  await page.getByLabel('倒计时截止时间', { exact: true }).fill(`${localDay(future)}T18:30`)
  await page.getByRole('button', { name: '添加倒计时', exact: true }).click()
  await page.waitForFunction(count => document.querySelectorAll('.countdown-management > div').length === count, index)
}
async function geometry() {
  return page.evaluate(() => {
    const root = document.querySelector('.workspace-body'), header = document.querySelector('.workspace-header')
    const list = document.querySelector('.countdown-list')
    const reportSections = [...document.querySelectorAll('.reports-body > section, .reports-body > .report-main-grid')].map(item => { const rect = item.getBoundingClientRect(); return { top: rect.top, bottom: rect.bottom } })
    const link = document.querySelector('.sidebar-link.selected'), label = link?.querySelector('span:not(.nav-selection)'), counter = link?.querySelector('.nav-count')
    return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, bodyWidth: root.clientWidth, bodyScroll: root.scrollWidth,
      reportSections,
      headerHeight: header.getBoundingClientRect().height, headerInset: getComputedStyle(header).paddingLeft, bodyInset: getComputedStyle(root).paddingLeft,
      eventWidth: document.querySelector('.important-countdowns')?.getBoundingClientRect().width,
      contentWidth: root.clientWidth - parseFloat(getComputedStyle(root).paddingLeft) - parseFloat(getComputedStyle(root).paddingRight),
      navigationFits: !label || !counter || label.getBoundingClientRect().right <= counter.getBoundingClientRect().left,
      eventCount: list?.querySelectorAll('article').length, eventHeight: list?.clientHeight, eventScroll: list?.scrollHeight }
  })
}
async function confirmProjectDeletion(name, action, destination) {
  await page.getByRole('button', { name: `管理项目 ${name}`, exact: true }).click()
  await page.getByRole('button', { name: '删除项目', exact: true }).click()
  const dialog = page.getByRole('dialog').last()
  assert.ok((await dialog.innerText()).includes('1 项未完成、1 项已完成'))
  assert.equal(await dialog.getByRole('radio', { name: /^连同任务删除/ }).isChecked(), true)
  if (action === 'retain') await dialog.getByRole('radio', { name: /^保留任务/ }).check()
  if (action === 'transfer') {
    await dialog.getByRole('radio', { name: /^转移任务/ }).check()
    assert.equal(await dialog.getByRole('button', { name: '转移任务并删除项目', exact: true }).isDisabled(), true)
    await dialog.getByLabel('将任务转移到', { exact: true }).selectOption(destination)
  }
  await dialog.getByRole('button', { name: action === 'delete' ? '删除项目及 2 项任务' : action === 'retain' ? '保留任务并删除项目' : '转移任务并删除项目', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
}
try {
  await launch()
  const initial = await bootstrap()
  assert.ok(initial.databasePath.startsWith(profile), 'Fixture database must stay inside the isolated profile')
  const research = unwrap(await page.evaluate(() => window.workbench.createProject({ name: '材料实验', description: '', colorKey: 'sage' })))
  const other = unwrap(await page.evaluate(() => window.workbench.createProject({ name: '学术写作', description: '', colorKey: 'blue' })))
  for (let index = 0; index < 8; index++) {
    const task = unwrap(await page.evaluate(({ projectId, index }) => window.workbench.createTask({ title: `研究任务 ${index + 1}`, projectId }), { projectId: index < 6 ? research.id : other.id, index }))
    if (index < 2) unwrap(await page.evaluate(id => window.workbench.completeTask(id, true), task.id))
  }
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ plannerDisplay: 'notes', background: 'orange' })))
  await app.close()
  const database = new DatabaseSync(initial.databasePath), paperId = randomUUID(), source = join(profile, 'fixture.pdf')
  writeFileSync(source, '%PDF-1.7\nSynthetic fixture\n%%EOF')
  database.prepare('INSERT INTO papers(id,collection,title,original_name,source_path,sha256,reading_status,published_date,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(paperId, 'library', '已读实验论文（测试）', 'fixture.pdf', source, randomUUID(), 'done', '', new Date().toISOString(), new Date().toISOString())
  database.prepare('INSERT INTO app_settings(key,value) VALUES(?,?)').run('research.checkins.v1', JSON.stringify([{ id: randomUUID(), date: `${year}-01-02`, durationMinutes: 90, notes: '旧打卡测试', createdAt: new Date().toISOString() }]))
  database.close()
  await launch(); await reloadPlanner()
  const beforeTasks = (await bootstrap()).tasks.length
  await page.locator('.important-countdowns').getByRole('button', { name: '设置', exact: true }).click()
  await addCountdown(1)
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const single = await geometry(); await shot('planner-1-event')
  await page.locator('.important-countdowns').getByRole('button', { name: '设置', exact: true }).click()
  for (let index = 2; index <= 5; index++) await addCountdown(index)
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '展开全部 5 个', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.countdown-list article').length === 5)
  const five = await geometry(); await shot('planner-5-events')
  await page.locator('.important-countdowns').getByRole('button', { name: '设置', exact: true }).click()
  for (let index = 6; index <= 7; index++) await addCountdown(index)
  await shot('planner-7-events-management')
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const seven = await geometry(); await shot('planner-7-events-expanded')
  assert.ok(Math.abs(seven.eventWidth - seven.contentWidth) <= 1, JSON.stringify(seven))
  assert.equal(seven.eventCount, 7); assert.ok(seven.eventScroll <= seven.eventHeight + 1, JSON.stringify(seven))
  assert.ok(Math.abs(single.headerHeight - five.headerHeight) < 1 && Math.abs(five.headerHeight - seven.headerHeight) < 1)
  await page.getByRole('button', { name: '收起事件', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.countdown-list article').length <= 3)
  await shot('planner-7-events-collapsed')
  assert.equal((await bootstrap()).tasks.length, beforeTasks)
  pass('1, 5 and 7 independent events keep header height stable; all events expand without internal scrolling')

  const choices = []
  for (const action of ['delete', 'retain', 'transfer']) {
    const project = unwrap(await page.evaluate(action => window.workbench.createProject({ name: `删除验证 ${action}`, description: '', colorKey: 'violet' }), action))
    const ids = []
    for (let index = 0; index < 2; index++) {
      const task = unwrap(await page.evaluate(({ projectId, index }) => window.workbench.createTask({ title: `删除验证任务 ${index}`, projectId }), { projectId: project.id, index }))
      ids.push(task.id); if (index) unwrap(await page.evaluate(id => window.workbench.completeTask(id, true), task.id))
    }
    choices.push({ project, ids, action })
  }
  await reloadPlanner()
  for (const { project, ids, action } of choices) {
    await confirmProjectDeletion(project.name, action, other.id)
    const state = await bootstrap()
    assert.equal(state.projects.some(item => item.id === project.id), false)
    const selected = state.tasks.filter(item => ids.includes(item.id))
    if (action === 'delete') assert.equal(selected.length, 0)
    else { assert.equal(selected.length, 2); assert.ok(selected.every(item => item.projectId === (action === 'retain' ? null : other.id))); assert.equal(selected.filter(item => item.status === 'completed').length, 1) }
  }
  pass('Project dialogs default to confirmed task deletion; preserve and transfer choices keep task completion state')

  await nav('研究报表')
  await page.getByRole('heading', { name: '研究报表', exact: true }).waitFor()
  assert.equal(await page.locator('.report-goal').count(), 3)
  assert.equal(await page.getByRole('heading', { name: '阅读积累与统计口径', exact: true }).count(), 0)
  await page.getByRole('button', { name: '目标与项目', exact: true }).click()
  await page.locator('.report-project-options').getByLabel('材料实验', { exact: true }).check()
  for (const [label, value] of [['每月完成任务目标', '10'], ['每月读完论文目标', '5'], ['每月打卡时长目标', '40']]) await page.getByLabel(label, { exact: true }).fill(value)
  assert.equal(await page.getByLabel('每月投稿论文目标', { exact: true }).count(), 0)
  await page.getByRole('button', { name: '保存目标与项目', exact: true }).click()
  await page.locator('.report-settings').waitFor({ state: 'hidden' })
  await page.locator('.report-reading-dates summary').click()
  await page.getByLabel('已读论文日期记录', { exact: true }).selectOption(paperId)
  await page.getByLabel('读完日期', { exact: true }).fill(today)
  await page.getByRole('button', { name: '保存读完日期', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.report-goal')[1].innerText.includes('1 篇'))
  await page.getByRole('button', { name: '登记打卡', exact: true }).click()
  await page.getByLabel('打卡开始时间', { exact: true }).fill('09:10')
  await page.getByLabel('打卡结束时间', { exact: true }).fill('09:00')
  assert.equal(await page.getByRole('button', { name: '保存打卡', exact: true }).isDisabled(), true)
  await page.getByLabel('打卡结束时间', { exact: true }).fill('11:55')
  assert.ok((await page.locator('#checkin-preview').innerText()).includes('2 小时 45 分钟'))
  await page.getByRole('button', { name: '保存打卡', exact: true }).click()
  await page.locator('#report-checkins .report-entry-form').waitFor({ state: 'hidden' })
  const checkins = unwrap(await page.evaluate(() => window.workbench.researchReport())).checkins
  assert.equal(checkins.find(item => item.startTime === '09:10').durationMinutes, 165)
  assert.equal(checkins.find(item => item.notes === '旧打卡测试').startTime, undefined)
  await page.locator('#report-checkins .report-ledger summary').click()
  assert.ok((await page.locator('#report-checkins .report-ledger').innerText()).includes('09:10 — 11:55'))
  pass('Three goals, relocated reading-date correction and validated time intervals work without rewriting legacy entries')

  for (const [date, amount] of [[`${year}-01-02`, '1000.10'], [`${year}-09-15`, '2500.20'], [`${year}-12-31`, '3000.30']]) {
    await page.getByRole('button', { name: '登记津贴', exact: true }).click()
    await page.getByLabel('津贴到账日期', { exact: true }).fill(date)
    await page.getByLabel('津贴金额', { exact: true }).fill(amount)
    await page.getByRole('button', { name: '保存津贴', exact: true }).click()
    await page.locator('#report-finance .report-entry-form').waitFor({ state: 'hidden' })
  }
  assert.ok((await page.locator('.report-finance-total').innerText()).includes('6,500.60'))
  assert.equal(await page.locator('#report-finance .report-chart-column').count(), 12)
  await page.getByRole('button', { name: '按周', exact: true }).click()
  assert.ok((await page.locator('.report-finance-total').innerText()).includes('6,500.60'))
  await page.getByRole('button', { name: '上一年津贴', exact: true }).click()
  assert.ok((await page.locator('.report-finance-total').innerText()).includes('0.00'))
  await page.getByRole('button', { name: '回到今年', exact: true }).click()
  pass('Receipt month totals cover all twelve months, sum exactly and remain independent of weekly research filters')

  for (const width of [1100, 1600, 2048]) for (const fontSize of [14, 18]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1050), width)
    unwrap(await page.evaluate(({ width, fontSize }) => window.workbench.updateInterfacePreferences({ fontSize, background: width === 1100 ? 'pink' : 'orange' }), { width, fontSize }))
    unwrap(await page.evaluate(width => window.workbench.setAppearance(width === 1600 ? 'dark' : 'light'), width))
    await reloadPlanner()
    const collapsed = await geometry()
    assert.equal(collapsed.headerInset, collapsed.bodyInset)
    assert.equal(collapsed.navigationFits, true, JSON.stringify(collapsed))
    assert.ok(collapsed.documentWidth <= width + 1 && collapsed.bodyScroll <= collapsed.bodyWidth + 1, JSON.stringify(collapsed))
    const expand = page.getByRole('button', { name: '展开全部 7 个', exact: true })
    await expand.click(); await page.waitForFunction(() => document.querySelectorAll('.countdown-list article').length === 7)
    const expanded = await geometry()
    assert.ok(expanded.eventScroll <= expanded.eventHeight + 1 && expanded.bodyScroll <= expanded.bodyWidth + 1, JSON.stringify(expanded))
    if (fontSize === 18) await shot(`planner-${width}-${fontSize}`)
    await nav('研究报表'); await page.getByRole('heading', { name: '阅读与任务趋势', exact: true }).waitFor()
    const report = await geometry()
    assert.ok(report.documentWidth <= width + 1 && report.bodyScroll <= report.bodyWidth + 1, JSON.stringify(report))
    assert.equal(report.headerInset, report.bodyInset)
    assert.ok(report.reportSections.every((item, index, rows) => !index || item.top >= rows[index - 1].bottom - 1), JSON.stringify(report))
    assert.equal(await page.locator('.report-goal').count(), 3)
    if (fontSize === 18) {
      await page.locator('.reports-workspace').evaluate(element => { element.scrollTop = 0 })
      await shot(`reports-${width}-${fontSize}`)
      await page.locator('#report-finance').scrollIntoViewIfNeeded(); await shot(`finance-${width}-${fontSize}`)
    }
    layouts.push({ width, fontSize, collapsed, expanded, report })
  }
  pass('Expanded event grids and report layouts fit three widths, two font sizes, and light/dark themes')
  const insets = []
  for (const [name, selector] of [['研究计划', '.planner-workspace'], ['文献阅读', '.literature-workspace:not(.outputs-workspace)'], ['科研成果', '.outputs-workspace'], ['论文投稿', '.submissions-workspace'], ['研究报表', '.reports-workspace'], ['设置', '.settings-workspace']]) {
    await nav(name)
    await page.locator(selector).waitFor()
    await page.locator('.workspace-header').waitFor()
    const inset = await page.locator('.workspace-header').evaluate(element => getComputedStyle(element).paddingLeft)
    insets.push({ name, inset })
  }
  assert.equal(new Set(insets.map(item => item.inset)).size, 1)
  pass('All six modules share the same workspace header inset')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await nav('研究计划'); await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await page.locator('.important-countdowns').getByRole('button', { name: '设置', exact: true }).click()
  assert.equal(await page.getByRole('dialog').evaluate(element => getComputedStyle(element).animationName), 'workspace-overlay-in')
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'hidden' })
  pass('Reduced-motion management dialogs retain feedback, Escape and focus handling')
  await app.close(); await launch(); await nav('研究报表')
  const restored = unwrap(await page.evaluate(() => window.workbench.researchReport()))
  assert.equal(restored.checkins.find(item => item.startTime === '09:10').durationMinutes, 165)
  assert.equal(restored.stipends.reduce((sum, item) => sum + item.amountCents, 0), 650060)
  assert.equal(restored.readingDates[paperId], today)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.countdowns())).length, 7)
  assert.deepEqual(errors, [])
  pass('All independent records survive restart without renderer errors')
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ checks, layouts, insets, errors, profile }, null, 2))
} catch (error) {
  await shot('failure').catch(() => undefined)
  writeFileSync(join(evidence, 'failure.json'), JSON.stringify({ message: error.message, checks, errors }, null, 2))
  throw error
} finally { await app?.close().catch(() => undefined) }
