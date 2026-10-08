import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const directory = resolve('test-results', `research-workflows-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: resolve(directory, 'isolated-data'), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const app = await electron.launch(executablePath
  ? { executablePath: resolve(executablePath), args: [], env, timeout: 30000 }
  : { args: ['.'], env, timeout: 30000 })
const page = await app.firstWindow()
const checks = [], errors = []
const check = (text) => { checks.push(text); console.log('PASS', text) }
const today = new Date().toLocaleDateString('en-CA')
const yesterdayDate = new Date(); yesterdayDate.setDate(yesterdayDate.getDate() - 1)
const yesterday = yesterdayDate.toLocaleDateString('en-CA')
const navModule = (name) => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const bootstrap = async () => { const result = await page.evaluate(() => window.workbench.bootstrap()); assert.equal(result.ok, true); return result.data }

try {
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.setBounds({ width: 1100, height: 700 }) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const assistant = await page.evaluate(() => window.workbench.assistantSettings())
  assert.equal(assistant.ok, true); assert.equal(assistant.data.quickRecognitionEnabled, false)
  const capture = page.getByRole('textbox', { name: '添加一个研究任务', exact: true })
  await capture.fill('首条任务保留输入')
  await page.getByRole('button', { name: '直接添加任务', exact: true }).click()
  await page.getByRole('dialog', { name: '新建项目' }).waitFor()
  assert.equal(await page.evaluate(() => document.querySelector('input[aria-label="添加一个研究任务"]')?.value), '首条任务保留输入')
  await page.getByRole('textbox', { name: '项目名称' }).fill('新工作区项目')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.waitForFunction(async () => { const result = await window.workbench.bootstrap(); return result.ok && result.data.tasks.some((task) => task.title === '首条任务保留输入') })
  check('New workspace creates its first project and task without AI, preserving typed content')

  const state = await bootstrap(), projectId = state.projects[0].id
  const overdue = await page.evaluate(({ projectId, yesterday }) => window.workbench.createTask({ title: '昨日遗留实验', projectId, scheduledDate: yesterday }), { projectId, yesterday })
  assert.equal(overdue.ok, true)
  for (let index = 1; index <= 18; index++) {
    const created = await page.evaluate(({ projectId, today, index }) => window.workbench.createTask({ title: `未指定时间 ${index}`, projectId, scheduledDate: today }), { projectId, today, index })
    assert.equal(created.ok, true)
  }
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.locator('.overdue-row').filter({ hasText: '昨日遗留实验' }).getByRole('button', { name: '暂缓到明天' }).click()
  await page.waitForFunction(async ({ id, yesterday }) => { const result = await window.workbench.bootstrap(); const task = result.ok && result.data.tasks.find((item) => item.id === id); return task && task.scheduledDate === yesterday && !!task.deferredUntil }, { id: overdue.data.id, yesterday })
  check('Overdue panel finds yesterday work and defers it without changing the original date')

  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: '日历', exact: true }).click()
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  const anytime = page.locator('.calendar-anytime').first()
  assert.equal(await anytime.locator('.anytime-chip').count(), 3)
  await anytime.getByRole('button', { name: /还有 \d+ 项/ }).click()
  const dayGeometry = await page.evaluate(() => { const lane = document.querySelector('.calendar-anytime'), timeline = document.querySelector('.schedule-day'); return { lane: lane.getBoundingClientRect().height, timeline: timeline.getBoundingClientRect().height, scrollable: lane.scrollHeight > lane.clientHeight } })
  assert.ok(dayGeometry.lane <= 178 && dayGeometry.timeline > 1000 && dayGeometry.scrollable)
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  assert.ok(await page.locator('.calendar-anytime').count() >= 7)
  check('Day and week calendars bound 18 unspecified-time tasks while preserving the time axis')

  await navModule('研究计划')
  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).fill('跨模块未提交输入')
  await navModule('文献阅读'); await page.getByRole('heading', { name: '文献库', exact: true }).waitFor()
  await navModule('研究计划'); assert.equal(await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).inputValue(), '跨模块未提交输入')
  await page.keyboard.press('Control+k')
  const search = page.getByRole('dialog', { name: '全局搜索' })
  await search.getByLabel('全局搜索').fill('昨日遗留实验')
  await search.getByRole('option').filter({ hasText: '昨日遗留实验' }).click()
  await page.getByRole('complementary', { name: '任务详情' }).waitFor()
  check('Quick input survives module switches and Ctrl+K locates a task directly')

  await navModule('科研成果')
  await page.getByRole('button', { name: '添加成果', exact: true }).click()
  const publication = page.getByRole('dialog', { name: '添加已发表成果' })
  await publication.getByLabel('成果标题').fill('Metadata-only publication')
  await publication.getByLabel('作者', { exact: true }).fill('Test Author')
  await publication.getByLabel('期刊 / 会议', { exact: true }).fill('Test Journal')
  await publication.getByLabel('发表时间精度').selectOption('year')
  await publication.getByLabel('发表时间', { exact: true }).fill('2026')
  await publication.getByRole('button', { name: '保存成果', exact: true }).click()
  await publication.waitFor({ state: 'hidden' })
  const library = await page.evaluate(() => window.workbench.librarySnapshot())
  assert.equal(library.ok, true)
  const savedPublication = library.data.papers.find((paper) => paper.title === 'Metadata-only publication')
  assert.ok(savedPublication && savedPublication.sourcePath === '')
  await page.getByRole('table', { name: '科研成果列表' }).getByRole('button', { name: 'Metadata-only publication', exact: true }).click()
  await page.getByLabel('成果备注').fill('未保存的成果草稿')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.getByRole('dialog', { name: '保留尚未保存的修改？' }).getByRole('button', { name: '保留草稿并关闭' }).click()
  await page.getByRole('table', { name: '科研成果列表' }).getByRole('button', { name: 'Metadata-only publication', exact: true }).click()
  assert.equal(await page.getByLabel('成果备注').inputValue(), '未保存的成果草稿')
  await page.getByRole('button', { name: '保存成果', exact: true }).click()
  check('Metadata-only results save successfully and unsaved long-form drafts recover')

  await navModule('设置')
  await page.getByRole('button', { name: '特大字号 18', exact: true }).click()
  await page.getByRole('button', { name: /紧凑模式/ }).click()
  await page.getByRole('button', { name: /隐藏每日鼓励语/ }).click()
  await page.getByRole('button', { name: '收起侧栏 已展开', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.density === 'compact' && document.documentElement.dataset.sidebar === 'collapsed' && document.documentElement.dataset.encouragement === 'hidden')
  const layout = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, overflowX: document.documentElement.scrollWidth > innerWidth, main: document.querySelector('.main-region').getBoundingClientRect().toJSON() }))
  assert.equal(layout.overflowX, false)
  await page.screenshot({ path: resolve(directory, '1100x700-compact-large-light.png'), animations: 'disabled' })
  await page.getByRole('group', { name: '显示模式' }).getByRole('button', { name: '深色', exact: true }).click()
  await page.screenshot({ path: resolve(directory, '1100x700-compact-large-dark.png'), animations: 'disabled' })
  check('Remembered compact mode keeps primary content reachable at 1100×700 with 18px text in light and dark themes')

  await page.reload(); await page.waitForFunction(() => document.documentElement.dataset.density === 'compact')
  assert.equal(await page.evaluate(() => document.documentElement.dataset.density), 'compact')
  assert.deepEqual(errors, [])
  const report = { checks, errors, layout, databasePath: (await bootstrap()).databasePath }
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
  console.log(`ALL ${checks.length} RESEARCH WORKFLOW CHECKS PASSED. Evidence: ${directory}`)
} finally {
  await app.close()
}
