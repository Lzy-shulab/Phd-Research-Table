import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { format, addDays } from 'date-fns'
import { waitForAsync } from './test-helpers.mjs'

const directory = resolve('test-results', `e2e-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DATA_DIR: resolve(directory, 'data')
}
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = [],
  checks = []
const check = (name) => {
  checks.push(name)
  console.log(`PASS ${name}`)
}
const today = format(new Date(), 'yyyy-MM-dd'),
  future = format(addDays(new Date(), 3), 'yyyy-MM-dd')
async function launch() {
  app = await electron.launch({ args: ['.'], env, timeout: 30000 })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
async function snapshot() {
  const result = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(result.ok, true)
  return result.data
}
async function saved(title, expected) {
  await waitForAsync(
    page,
    async ({ title, expected }) => {
      const result = await window.workbench.bootstrap()
      if (!result.ok) return false
      const task = result.data.tasks.find((t) => t.title === title)
      return !!task && Object.entries(expected).every(([key, value]) => task[key] === value)
    },
    { title, expected }
  )
  return (await snapshot()).tasks.find((t) => t.title === title)
}
async function nav(name) {
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: new RegExp(`^${name}(?:\\s*\\d+)?$`) })
    .click()
}
async function capture(title) {
  const state = await snapshot()
  const projectId = state.projects.find((project) => !project.archivedAt)?.id
  assert.ok(projectId)
  const context = await page.locator('.workspace-header h1').innerText()
  const scheduledDate = context === 'Today Plan' ? today : undefined
  const created = await page.evaluate((input) => window.workbench.createTask(input), {
    title,
    projectId,
    scheduledDate
  })
  assert.equal(created.ok, true, JSON.stringify(created))
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  if (context === '全部任务') await nav('全部任务')
  else if (context !== 'Today Plan') await nav('全部任务')
  return await saved(title, {})
}
async function edit(title) {
  await page.locator('.task-content').filter({ hasText: title }).click()
  await page.getByRole('complementary', { name: '任务详情' }).waitFor()
}
async function closeInspector() {
  if (await page.getByRole('button', { name: '关闭任务详情' }).count())
    await page.getByRole('button', { name: '关闭任务详情' }).click()
}
async function screenshot(name) {
  await page.screenshot({ path: resolve(directory, name), animations: 'disabled' })
}

try {
  await launch()
  assert.equal((await snapshot()).tasks.length, 0)
  assert.equal((await snapshot()).projects.length, 0)
  assert.equal((await snapshot()).appearance, 'system')
  const security = await app.evaluate(({ BrowserWindow }) => {
    const prefs = BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences()
    return {
      isolation: prefs.contextIsolation,
      sandbox: prefs.sandbox,
      node: prefs.nodeIntegration
    }
  })
  assert.deepEqual(security, { isolation: true, sandbox: true, node: false })
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined')
  check('Clean first launch on Today; sandboxed renderer and typed preload')
  await screenshot('01-empty.png')

  await page.getByRole('button', { name: '新建项目', exact: true }).last().click()
  await page.getByRole('textbox', { name: '项目名称' }).fill('PhD Thesis')
  await page
    .getByRole('textbox', { name: '描述', exact: true })
    .fill('A rigorous research direction.')
  await page.getByRole('button', { name: '鼠尾草绿项目颜色' }).click()
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  await page.locator('.plan-note').filter({ hasText: 'PhD Thesis' }).waitFor()
  const projectId = (await snapshot()).projects[0].id
  const task = await capture('Read papers about spectral reconstruction')
  assert.equal(task.projectId, projectId)
  assert.equal(task.status, 'planned')
  assert.equal(task.scheduledDate, today)
  check("Create a project from the task entry, keep it selected, and add today's task")

  await edit(task.title)
  await page.getByRole('textbox', { name: '任务标题', exact: true }).fill('Read three HSI papers')
  await page
    .getByLabel('任务描述', { exact: true })
    .fill('Compare assumptions.\n记录光谱重建实验。')
  await page.getByLabel('计划日期', { exact: true }).fill(today)
  await page.getByLabel('开始时间', { exact: true }).fill('09:17')
  await page.getByLabel('结束时间', { exact: true }).fill('10:43')
  await page.getByLabel('截止日期', { exact: true }).fill(future)
  await page.getByLabel('预计分钟数', { exact: true }).fill('90')
  await page.getByLabel('优先级', { exact: true }).selectOption('high')
  await saved('Read three HSI papers', {
    status: 'planned',
    scheduledDate: today,
    startTime: '09:17',
    endTime: '10:43',
    dueDate: future,
    estimatedMinutes: 90,
    priority: 'high',
    description: 'Compare assumptions.\n记录光谱重建实验。'
  })
  check('Auto-save every inspector field, Unicode text, dates and times')
  assert.equal(
    await page.getByLabel('所属项目', { exact: true }).locator('option[value=""]').count(),
    0
  )
  const orphan = await page.evaluate(
    (id) => window.workbench.updateTask(id, { projectId: null }),
    task.id
  )
  assert.equal(orphan.ok, false)
  await saved('Read three HSI papers', { projectId })
  await closeInspector()

  await nav('Today Plan')
  await page.getByRole('button', { name: '时间安排', exact: true }).click()
  await page.getByTestId('schedule-block').filter({ hasText: 'Read three HSI papers' }).waitFor()
  await capture('Prepare supervisor meeting')
  await screenshot('02-today-light.png')
  await nav('全部任务')
  await capture('Review unscheduled idea')
  await capture('Plan next experiment')
  await edit('Plan next experiment')
  await page.getByLabel('计划日期', { exact: true }).fill(future)
  await saved('Plan next experiment', { scheduledDate: future, status: 'planned' })
  await closeInspector()
  await nav('全部任务')
  await page.locator('.task-content').filter({ hasText: 'Plan next experiment' }).waitFor()
  await nav('全部任务')
  await page.getByLabel('任务排序', { exact: true }).selectOption('priority')
  assert.match(await page.getByTestId('task-row').first().innerText(), /Read three HSI papers/)
  await page.getByLabel('任务排序', { exact: true }).selectOption('manual')
  check('Today Plan, future work in All Tasks, unscheduled legacy tasks and sorting')

  await page.getByRole('checkbox', { name: '完成 Read three HSI papers', exact: true }).click()
  await saved('Read three HSI papers', { status: 'completed' })
  await nav('全部任务')
  await page.getByRole('checkbox', { name: '恢复 Read three HSI papers', exact: true }).click()
  await saved('Read three HSI papers', { status: 'planned', completedAt: null })
  check('Complete and restore within All Tasks')

  await nav('全部任务')
  const beforeOrder = (await snapshot()).tasks
    .filter((t) => t.status !== 'completed')
    .sort((a, b) => a.order - b.order)
  const grip = page.getByRole('button', { name: `调整顺序 ${beforeOrder[0].title}`, exact: true })
  await grip.focus()
  await page.keyboard.press('Space')
  await page.locator('.task-row.dragging').waitFor()
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.body.textContent.includes('移动到第2项。'))
  await page.keyboard.press('Space')
  await waitForAsync(
    page,
    async (expected) => {
      const result = await window.workbench.bootstrap()
      return (
        result.ok &&
        result.data.tasks
          .filter((t) => t.status !== 'completed')
          .sort((a, b) => a.order - b.order)[0]?.id === expected
      )
    },
    beforeOrder[1].id
  )
  check('Keyboard drag ordering persists through dnd-kit and SQLite')

  await nav('全部任务')
  await edit('Review unscheduled idea')
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  assert.ok((await snapshot()).tasks.some((t) => t.title === 'Review unscheduled idea'))
  await page.getByRole('button', { name: '删除任务', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.ok(!(await snapshot()).tasks.some((t) => t.title === 'Review unscheduled idea'))
  check('Task deletion requires confirmation and cancellation preserves data')

  await nav('日历')
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.schedule-day').length === 1)
  await page.getByRole('button', { name: `安排任务 ${today} 14:00`, exact: true }).press('Enter')
  await page
    .getByRole('textbox', { name: '新建计划任务标题' })
    .fill('Run Washington DC Mall experiment')
  await page.getByRole('dialog').getByRole('button', { name: '创建任务', exact: true }).click()
  await saved('Run Washington DC Mall experiment', {
    scheduledDate: today,
    startTime: '14:00',
    endTime: '15:00'
  })
  await page.getByLabel('结束时间', { exact: true }).fill('16:00')
  await saved('Run Washington DC Mall experiment', { endTime: '16:00' })
  await closeInspector()
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  await page.getByTestId('schedule-block').filter({ hasText: 'Read three HSI papers' }).click()
  await screenshot('03-week-inspector-light.png')
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await screenshot('04-week-inspector-dark.png')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ x: 40, y: 40, width: 1100, height: 700 })
  )
  await screenshot('05-minimum-dark.png')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  assert.equal(overflow, false)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 940 })
  )
  check('Calendar slot creation, day/week blocks, light/dark and minimum window size')

  const invalid = await page.evaluate(
    async (id) => ({
      update: await window.workbench.updateTask(id, { endTime: '08:00' }),
      malformed: await window.workbench.createTask({ title: '', command: 'invalid' }),
      missing: await window.workbench.updateTask('00000000-0000-4000-8000-000000000000', {
        title: 'Missing'
      })
    }),
    task.id
  )
  assert.equal(invalid.update.error.code, 'VALIDATION')
  assert.equal(invalid.malformed.error.code, 'VALIDATION')
  assert.equal(invalid.missing.error.code, 'NOT_FOUND')
  await saved('Read three HSI papers', { endTime: '10:43' })
  check('IPC rejects malformed requests, missing tasks and invalid intervals')
  await closeInspector()

  await nav('全部任务')
  await page.getByRole('button', { name: '管理项目 PhD Thesis', exact: true }).click()
  await page.getByRole('textbox', { name: '项目名称' }).fill('Thesis Research')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '管理项目 Thesis Research', exact: true }).click()
  await page.getByRole('button', { name: '归档项目', exact: true }).click()
  await page.getByRole('button', { name: '管理项目 Thesis Research', exact: true }).click()
  await page.getByRole('button', { name: '恢复项目', exact: true }).click()
  await page.getByRole('button', { name: '新建项目', exact: true }).last().click()
  await page.getByRole('textbox', { name: '项目名称' }).fill('Research continuation')
  await page.getByRole('button', { name: '创建项目', exact: true }).click()
  const receivingId = (await snapshot()).projects.find((p) => p.name === 'Research continuation').id
  await page.getByRole('button', { name: '管理项目 Thesis Research', exact: true }).click()
  await page.getByRole('button', { name: '删除项目', exact: true }).click()
  await page.getByLabel('将计划转移到').selectOption(receivingId)
  await page
    .getByRole('dialog', { name: '删除此项目？' })
    .getByRole('button', { name: '转移计划并删除', exact: true })
    .click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal((await snapshot()).projects.length, 1)
  assert.equal((await snapshot()).tasks.find((t) => t.id === task.id).projectId, receivingId)
  check('Project rename, archive, restore and deletion preserve tasks')

  for (const name of ['文献阅读', '科研成果']) {
    await page
      .getByRole('navigation', { name: '科研工作空间' })
      .getByRole('button', { name, exact: true })
      .click()
    if (name === '文献阅读')
      await page.getByRole('heading', { name: '文献库', exact: true }).waitFor()
    else await page.getByRole('heading', { name: '科研成果', exact: true }).waitFor()
    assert.equal(await page.getByRole('navigation', { name: '研究计划视图' }).count(), 0)
  }
  await page
    .getByRole('navigation', { name: '科研工作空间' })
    .getByRole('button', { name: '研究计划', exact: true })
    .click()
  await page.keyboard.press('Control+n')
  assert.equal(
    await page
      .getByRole('textbox', { name: '添加一个研究任务', exact: true })
      .evaluate((el) => el === document.activeElement),
    true
  )
  await page.keyboard.press('Control+k')
  await page.getByText(/命令面板尚未开放/).waitFor()
  check('Contextual module navigation and keyboard shortcuts')

  await nav('全部任务')
  await edit('Read three HSI papers')
  await page
    .getByLabel('任务描述', { exact: true })
    .fill('Final edit immediately before closing. 最后一条记录。')
  // Close before the 450 ms debounce expires. The main process must await the preload flush acknowledgement.
  const closed = app.waitForEvent('close')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  app = null
  await launch()
  const restored = await snapshot()
  assert.equal(
    restored.tasks.find((t) => t.id === task.id).description,
    'Final edit immediately before closing. 最后一条记录。'
  )
  assert.equal(restored.tasks.find((t) => t.id === task.id).startTime, '09:17')
  assert.equal(restored.tasks.find((t) => t.id === task.id).endTime, '10:43')
  assert.equal(restored.appearance, 'dark')
  assert.equal(restored.projects.length, 1)
  check('Native window close flushes final edits; restart restores SQLite state and appearance')
  assert.deepEqual(errors, [])
  check('No renderer errors')
  writeFileSync(
    resolve(directory, 'report.json'),
    JSON.stringify({ checks, errors, databasePath: restored.databasePath }, null, 2)
  )
  console.log(`ALL ${checks.length} CHECKS PASSED. Evidence: ${directory}`)
} catch (error) {
  if (page && !page.isClosed()) {
    await screenshot('failure.png')
    writeFileSync(resolve(directory, 'failure.txt'), await page.locator('body').innerText())
  }
  throw error
} finally {
  if (app) await app.close()
}
