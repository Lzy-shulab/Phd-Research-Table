import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format, addDays } from 'date-fns'
import { ensureTestProject, waitForAsync } from './test-helpers.mjs'

const directory = resolve('test-results', `minutes-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: resolve(directory, 'data') }
delete env.ELECTRON_RUN_AS_NODE
const today = format(new Date(), 'yyyy-MM-dd')
const tomorrow = format(addDays(new Date(), 1), 'yyyy-MM-dd')
let app, page
const errors = [], checks = []
const check = (message) => { checks.push(message); console.log(`PASS ${message}`) }
async function launch() {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (e) => errors.push(e.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await ensureTestProject(page)
}
async function snapshot() {
  const result = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(result.ok, true)
  return result.data
}
async function saved(title, expected) {
  await waitForAsync(page, async ({ title, expected }) => {
    const result = await window.workbench.bootstrap()
    const task = result.ok && result.data.tasks.find((t) => t.title === title)
    return task && Object.entries(expected).every(([key, value]) => task[key] === value)
  }, { title, expected })
  return (await snapshot()).tasks.find((t) => t.title === title)
}
async function nav(name) {
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: new RegExp(`^${name}`) }).click()
}
async function closeInspector() {
  const close = page.getByRole('button', { name: '关闭任务详情' })
  if (await close.count()) await close.click()
}
async function capture(title, { scheduledDate = null, view = '全部任务' } = {}) {
  const projectId = (await snapshot()).projects.find((project) => !project.archivedAt)?.id
  assert.ok(projectId)
  const created = await page.evaluate((input) => window.workbench.createTask(input), { title, projectId, scheduledDate })
  assert.equal(created.ok, true, JSON.stringify(created))
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  if (view !== 'Today Plan') await nav(view)
  return saved(title, {})
}
const block = (title) => page.getByTestId('schedule-block').filter({ has: page.locator('.block-title', { hasText: title }) })
async function setScroll(minute) {
  await page.locator('.schedule-viewport').evaluate((el, m) => { el.scrollTop = m * 1.2 }, minute)
}
async function point(minute, date = today) {
  const box = await page.locator(`.schedule-day[data-date="${date}"]`).boundingBox()
  return { x: box.x + box.width / 2, y: box.y + minute * 1.2 }
}
async function drag(from, to) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 5 })
  await page.mouse.up()
}
async function resize(title, edge, minutes) {
  const handle = block(title).getByRole('button', { name: `调整${edge === 'start' ? '开始' : '结束'}时间 ${title}`, exact: true })
  const bounds = await handle.boundingBox()
  const p = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
  await drag(p, { x: p.x, y: p.y + minutes * 1.2 })
}
async function screenshot(name) {
  await page.screenshot({ path: resolve(directory, name), animations: 'disabled' })
}
try {
  await launch()
  assert.equal(await page.title(), 'PhD 科研工作台')
  assert.equal(await app.evaluate(({ app }) => app.getName()), 'PhD 科研工作台')
  assert.deepEqual(await page.locator('.dock-item').allTextContents(), ['研究计划', '文献阅读', '科研成果', '论文投稿', '设置'])
  assert.deepEqual(await page.locator('.planner-nav .sidebar-link').allTextContents(), ['Today Plan', '日历', '全部任务'])
  assert.ok(!(await page.locator('.sidebar').innerText()).match(/Inbox|收集箱/))
  const task = await capture('分钟精度验证', { scheduledDate: today, view: 'Today Plan' })
  assert.equal(task.scheduledDate, today)
  await page.locator('.task-content').filter({ hasText: task.title }).click()
  await page.getByRole('button', { name: '选择截止日期', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '今天', exact: true }).click()
  await saved(task.title, { dueDate: today })
  await page.getByLabel('开始时间', { exact: true }).fill('09:')
  assert.equal((await snapshot()).tasks[0].startTime, null)
  const timeLayout = await page.locator('.time-fields').evaluate((container) => {
    const fields = [...container.querySelectorAll('.time-input')].map((element) => element.getBoundingClientRect())
    const bounds = container.getBoundingClientRect()
    return { widths: fields.map((field) => field.width), left: fields[0].left, right: fields[1].right, containerLeft: bounds.left, containerRight: bounds.right }
  })
  assert.ok(Math.abs(timeLayout.widths[0] - timeLayout.widths[1]) <= 1)
  assert.ok(timeLayout.left >= timeLayout.containerLeft && timeLayout.right <= timeLayout.containerRight + 0.5)
  await page.getByRole('button', { name: '选择开始时间', exact: true }).click()
  let picker = page.getByRole('dialog', { name: '选择开始时间', exact: true })
  await picker.getByLabel('开始时间小时', { exact: true }).selectOption('09')
  await picker.getByLabel('开始时间分钟', { exact: true }).selectOption('17')
  await screenshot('time-picker.png')
  await picker.getByRole('button', { name: '确定', exact: true }).click()
  await page.getByRole('button', { name: '选择结束时间', exact: true }).click()
  picker = page.getByRole('dialog', { name: '选择结束时间', exact: true })
  await picker.getByLabel('结束时间小时', { exact: true }).selectOption('10')
  await picker.getByLabel('结束时间分钟', { exact: true }).selectOption('43')
  await picker.getByRole('button', { name: '确定', exact: true }).click()
  await saved(task.title, { startTime: '09:17', endTime: '10:43' })
  await page.getByLabel('结束时间', { exact: true }).fill('09:17')
  await page.locator('.field-error').getByText('结束时间需要晚于开始时间。', { exact: true }).waitFor()
  assert.equal((await snapshot()).tasks[0].endTime, '10:43')
  await page.getByLabel('结束时间', { exact: true }).fill('10:43')
  await saved(task.title, { endTime: '10:43' })
  await closeInspector()
  await nav('日历')
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.schedule-day').length === 1)
  const geometry = await block(task.title).evaluate((el) => ({ top: parseFloat(el.style.top), height: parseFloat(el.style.height), text: el.innerText }))
  assert.ok(Math.abs(geometry.top - 557 * 1.2) < 0.01)
  assert.ok(Math.abs(geometry.height - 86 * 1.2) < 0.01)
  assert.ok(geometry.text.includes('09:17–10:43'))
  check('Chinese navigation, equal-width scroll pickers, arbitrary HH:mm editing, inline validation and exact pixel geometry')

  await drag(await point(577), await point(632))
  await saved(task.title, { startTime: '10:12', endTime: '11:38' })
  await drag(await point(632), await point(633))
  await saved(task.title, { startTime: '10:13', endTime: '11:39' })
  await drag(await point(633), await point(634))
  await saved(task.title, { startTime: '10:14', endTime: '11:40' })
  check('Pointer movement persists 10:12, 10:13 and 10:14 while preserving duration')

  const from = await point(634), to = await point(654)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y)
  await page.keyboard.press('Escape')
  await page.mouse.up()
  assert.equal((await snapshot()).tasks.find((t) => t.id === task.id).startTime, '10:14')
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.schedule-day').length === 7)
  const adjacent = await page.locator('.schedule-day').evaluateAll((els, current) => els.find((el) => el.dataset.date !== current).dataset.date, today)
  await drag(await point(634), await point(634, adjacent))
  await saved(task.title, { scheduledDate: adjacent, startTime: '10:14', endTime: '11:40' })
  await drag(await point(634, adjacent), await point(634))
  await saved(task.title, { scheduledDate: today, startTime: '10:14', endTime: '11:40' })
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.schedule-day').length === 1)
  check('Escape cancels without saving; moving across week columns changes only the date')

  await setScroll(600)
  await resize(task.title, 'end', 27)
  await saved(task.title, { startTime: '10:14', endTime: '12:07' })
  await resize(task.title, 'start', 13)
  await saved(task.title, { startTime: '10:27', endTime: '12:07' })
  await block(task.title).getByRole('button', { name: `调整结束时间 ${task.title}`, exact: true }).press('ArrowDown')
  await saved(task.title, { endTime: '12:08' })
  check('Top and bottom pointer resize and keyboard resize preserve individual minutes')

  await setScroll(750)
  await drag(await point(796), await point(882))
  await page.getByRole('textbox', { name: '新建计划任务标题' }).fill('框选时间验证')
  await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click()
  await saved('框选时间验证', { scheduledDate: today, startTime: '13:16', endTime: '14:42' })
  await closeInspector()
  await resize('框选时间验证', 'start', 57)
  await saved('框选时间验证', { startTime: '14:13', endTime: '14:42' })
  await resize('框选时间验证', 'end', 45)
  await saved('框选时间验证', { startTime: '14:13', endTime: '15:27' })
  check('Drag-select creates 13:16–14:42; both edges resize to 14:13–15:27')

  // Restore the representative interval, then inspect both themes and the actual application restart.
  await block(task.title).press('Enter')
  await page.getByLabel('开始时间', { exact: true }).fill('09:17')
  await page.getByLabel('结束时间', { exact: true }).fill('10:43')
  await saved(task.title, { startTime: '09:17', endTime: '10:43' })
  await setScroll(480)
  for (const [label, theme] of [['浅色模式', 'light'], ['深色模式', 'dark']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction((t) => document.documentElement.dataset.theme === t, theme)
    await screenshot(`calendar-inspector-${theme}.png`)
    const tokens = await page.evaluate(() => ['.sidebar', '.main-region', '.dock', '.task-inspector'].map((selector) => {
      const styles = getComputedStyle(document.querySelector(selector))
      return { background: styles.backgroundColor, border: styles.borderColor, blur: styles.backdropFilter, shadow: styles.boxShadow }
    }))
    assert.equal(tokens[0].background, tokens[1].background)
    assert.equal(tokens[1].background, tokens[2].background)
    assert.notEqual(tokens[2].background, tokens[3].background)
    assert.ok(tokens[0].blur.includes('blur(') && tokens[2].blur.includes('blur('))
    assert.ok(tokens.every((t) => t.shadow !== 'none'))
  }
  await closeInspector()
  await nav('全部任务')
  await capture('未来安排验证')
  await page.locator('.task-content').filter({ hasText: '未来安排验证' }).click()
  await page.getByRole('complementary', { name: '任务详情' }).waitFor()
  await page.getByLabel('计划日期', { exact: true }).fill(tomorrow)
  await saved('未来安排验证', { scheduledDate: tomorrow })
  await closeInspector()
  assert.equal(await page.locator('.task-content').filter({ hasText: '未来安排验证' }).count(), 1)
  await nav('全部任务')
  const unscheduled = await capture('未规划任务验证')
  assert.equal(unscheduled.scheduledDate, null)
  assert.equal(unscheduled.status, 'inbox')
  check('Future work can be scheduled from All Tasks; legacy inbox status remains available')

  const before = (await snapshot()).tasks
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  app = null
  await launch()
  assert.deepEqual((await snapshot()).tasks, before)
  assert.equal((await saved(task.title, { startTime: '09:17', endTime: '10:43' })).id, task.id)
  check('Native close and application restart preserve every task field and 09:17–10:43 exactly')
  assert.deepEqual(errors, [])
  writeFileSync(resolve(directory, 'report.json'), JSON.stringify({ checks, geometry, errors, databasePath: (await snapshot()).databasePath, packaged: Boolean(executablePath), executablePath: executablePath ? resolve(executablePath) : 'development' }, null, 2))
  console.log(`ALL ${checks.length} MINUTE CHECKS PASSED. Evidence: ${directory}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await screenshot('failure.png')
    writeFileSync(resolve(directory, 'failure.txt'), await page.locator('body').innerText())
  }
  throw error
} finally { if (app) await app.close() }
