import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const directory = resolve('test-results', `today-plan-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: join(directory, 'isolated-data'),
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const app = await electron.launch(executablePath
  ? { executablePath: resolve(executablePath), args: [], env, timeout: 30000 }
  : { args: ['.'], env, timeout: 30000 })
const page = await app.firstWindow()
const errors = []
const checks = []
const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const shiftDay = (days) => { const date = new Date(); date.setDate(date.getDate() + days); return localDay(date) }
const today = shiftDay(0), yesterday = shiftDay(-1), tomorrow = shiftDay(1)
const pass = (name) => { checks.push(name); console.log('PASS', name) }
const screenshot = (name) => page.screenshot({ path: join(directory, `${name}.png`), animations: 'disabled', scale: 'css' })
const createTask = async (input) => {
  const result = await page.evaluate((task) => window.workbench.createTask(task), input)
  assert.equal(result.ok, true, JSON.stringify(result))
}

try {
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.hide()
    window.setBounds({ width: 1600, height: 900 })
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  assert.equal(await page.locator('.plan-note').count(), 0)
  assert.equal(await page.locator('.today-empty').count(), 1)
  pass('A new workspace shows one actionable empty state and no project cards')

  const projects = []
  for (let index = 1; index <= 8; index++) {
    const result = await page.evaluate((name) => window.workbench.createProject({ name, description: '', colorKey: 'blue' }), `审查项目 ${index}`)
    assert.equal(result.ok, true, JSON.stringify(result))
    projects.push(result.data)
  }
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  assert.equal(await page.locator('.plan-note').count(), 0)
  assert.equal(await page.locator('.today-other-projects').count(), 0)
  assert.equal(await page.locator('.today-empty').count(), 1)
  await screenshot('empty-projects-hidden')
  pass('Projects without today tasks do not add a redundant secondary entry')

  await page.getByRole('textbox', { name: '添加一个研究任务' }).fill('今天修改论文框架')
  await page.getByRole('combobox', { name: '新计划所属项目' }).selectOption(projects[0].id)
  await page.getByRole('button', { name: '直接添加任务' }).click()
  await page.getByText('今天修改论文框架', { exact: true }).waitFor()
  assert.equal(await page.locator('.plan-note').count(), 0)
  pass('Plain quick add creates a visible today task without AI')

  await createTask({ title: '今天截止但明天计划', projectId: projects[1].id, scheduledDate: tomorrow, dueDate: today })
  await createTask({ title: '昨天遗留实验', projectId: projects[2].id, scheduledDate: yesterday })
  await page.reload()
  await page.getByText('今天截止但明天计划', { exact: true }).waitFor()
  assert.equal(await page.getByText('今天截止但明天计划', { exact: true }).count(), 1)
  assert.equal(await page.locator('.today-task-section').filter({ hasText: '今天截止，尚未安排到今天' }).getByTestId('task-row').count(), 1)
  assert.equal(await page.locator('.overdue-row').count(), 1)
  await screenshot('today-tasks-light')
  pass('Today, due-only and overdue tasks remain distinct and visible')

  assert.equal(await page.getByRole('switch', { name: 'AI 识别日期时间和项目' }).isVisible(), false)
  await page.getByText('更多选项', { exact: false }).first().click()
  assert.equal(await page.getByRole('switch', { name: 'AI 识别日期时间和项目' }).isVisible(), true)
  pass('Advanced quick-entry controls stay out of the primary input path')

  const tomorrowLabel = new Date(`${tomorrow}T12:00:00`).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' }).replaceAll(' ', '')
  await page.locator('.mini-calendar').getByRole('button', { name: tomorrowLabel }).click()
  await page.getByRole('heading', { name: '日历', exact: true }).waitFor()
  assert.equal(await page.locator('.schedule-day').count(), 1)
  assert.ok((await page.locator('.calendar-period').innerText()).includes(tomorrowLabel))
  pass('Sidebar date selection opens that date in the day calendar')

  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: '今日计划' }).click()
  await page.getByRole('button', { name: '深色模式' }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 700 }))
  await screenshot('today-tasks-dark-1100x700')
  const geometry = await page.evaluate(() => {
    const rect = (selector) => { const box = document.querySelector(selector).getBoundingClientRect(); return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height } }
    return { viewport: { width: innerWidth, height: innerHeight }, rootWidth: document.documentElement.scrollWidth, rail: rect('.dock-wrap'), sidebar: rect('.sidebar'), main: rect('.main-region') }
  })
  assert.ok(geometry.sidebar.right <= geometry.main.left)
  assert.ok(geometry.rail.top < geometry.main.bottom)
  assert.ok(Math.abs(geometry.viewport.height - geometry.sidebar.bottom) <= 14)
  assert.ok(Math.abs(geometry.viewport.height - geometry.main.bottom) <= 14)
  assert.ok(geometry.main.height > 500)
  assert.ok(geometry.rootWidth <= geometry.viewport.width)
  assert.deepEqual(errors, [])
  pass('Bottom Dock occupies its integrated bay while the sidebar and main content reach the small dark window edge')
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ checks, errors, geometry, executablePath: executablePath ? resolve(executablePath) : 'development', dataDir: env.WORKBENCH_DATA_DIR }, null, 2))
  console.log('EVIDENCE', directory)
} finally {
  await app.close()
}
