import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/planner-quiet-ui', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const errors = []
const app = await electron.launch(executablePath ? { executablePath, args: [], env } : { args: ['.'], env })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 900)
    win.webContents.setBackgroundThrottling(false)
    win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.evaluate(async () => {
    const project = await window.workbench.createProject({ name: '界面验证项目', description: '', colorKey: 'blue' })
    if (!project.ok) throw Error(project.error.message)
    for (let index = 1; index <= 7; index++) {
      const task = await window.workbench.createTask({ title: `验证任务 ${index}`, projectId: project.data.id })
      if (!task.ok) throw Error(task.error.message)
    }
  })
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.locator('.planner-nav .sidebar-link').filter({ hasText: '全部任务' }).click()
  await page.getByRole('region', { name: '日期导航' }).waitFor()
  assert.equal(await page.locator('.empty-projects').count(), 0)
  const card = page.getByRole('region', { name: '界面验证项目项目卡片' })
  await card.waitFor()
  assert.equal(await card.getByTestId('task-row').count(), 5)
  await card.getByRole('button', { name: '查看剩余 2 项' }).click()
  assert.equal(await card.getByTestId('task-row').count(), 7)
  await card.getByRole('button', { name: '收起任务' }).click()
  const placement = await page.evaluate(() => {
    const dock = document.querySelector('.dock').getBoundingClientRect()
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const main = document.querySelector('.main-region').getBoundingClientRect()
    return { dockTop: dock.top, sidebarBottom: sidebar.bottom, mainBottom: main.bottom, mainLeft: main.left, sidebarRight: sidebar.right, viewport: innerWidth, viewportHeight: innerHeight, scrollWidth: document.documentElement.scrollWidth }
  })
  assert.ok(placement.dockTop < placement.mainBottom, JSON.stringify(placement))
  assert.ok(Math.abs(placement.viewportHeight - placement.sidebarBottom) <= 14, JSON.stringify(placement))
  assert.ok(Math.abs(placement.viewportHeight - placement.mainBottom) <= 14, JSON.stringify(placement))
  assert.ok(placement.mainLeft >= placement.sidebarRight - 2, JSON.stringify(placement))
  assert.ok(placement.scrollWidth <= placement.viewport + 1, JSON.stringify(placement))
  const firstTitle = await card.getByTestId('task-row').nth(0).locator('.task-title').innerText()
  const secondTitle = await card.getByTestId('task-row').nth(1).locator('.task-title').innerText()
  await card.getByTestId('task-row').nth(0).locator('.task-content').click()
  const inspector = page.locator('.task-inspector')
  await inspector.waitFor()
  assert.equal(await inspector.getByText('备注与更多', { exact: true }).count(), 0)
  assert.equal(await inspector.getByText('更多信息', { exact: true }).count(), 0)
  assert.equal(await inspector.getByRole('button', { name: '添加备注', exact: true }).count(), 0)
  assert.equal(await inspector.getByRole('button', { name: '添加子任务', exact: true }).count(), 0)
  assert.equal(await inspector.getByLabel('任务标题').inputValue(), firstTitle)
  await card.getByTestId('task-row').nth(1).locator('.task-content').click()
  assert.equal(await inspector.getByLabel('任务标题').inputValue(), secondTitle)
  await page.screenshot({ path: join(evidence, 'inspector-default.png'), animations: 'disabled', scale: 'css' })
  await inspector.getByRole('button', { name: '关闭任务详情' }).click()
  await page.locator('.all-task-focus button[aria-pressed]').first().click()
  assert.equal(await page.getByTestId('task-row').count(), 0)
  await page.getByRole('button', { name: '清除聚焦' }).click()
  await page.getByLabel('添加一个研究任务').fill('快速记录验证')
  await page.locator('input[aria-label="新任务安排日期"]').fill('2026-09-22')
  await page.getByRole('button', { name: '直接添加任务' }).click()
  await card.getByText('已完成 0 / 8').waitFor()
  const created = await page.evaluate(async () => {
    const result = await window.workbench.bootstrap()
    if (!result.ok) throw Error(result.error.message)
    return result.data.tasks.find((task) => task.title === '快速记录验证')
  })
  assert.equal(created.scheduledDate, '2026-09-22')
  await page.locator('.capture-more > summary').click()
  const recognition = page.getByRole('switch', { name: 'AI 识别日期时间和项目' })
  await recognition.click()
  await page.locator('input[aria-label="新任务安排日期"]').waitFor({ state: 'detached' })
  await recognition.click()
  await page.locator('input[aria-label="新任务安排日期"]').waitFor()
  await page.screenshot({ path: join(evidence, 'cards.png'), animations: 'disabled', scale: 'css' })
  await page.locator('.appearance-switch button').last().click()
  await page.screenshot({ path: join(evidence, 'dark.png'), animations: 'disabled', scale: 'css' })
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ placement, errors, checks: ['dock', 'calendar-in-all-tasks', 'card-limit', 'nonmodal-inspector', 'simplified-inspector', 'no-empty-project-placeholders', 'focus-filter', 'dated-quick-capture', 'recognition-date-visibility'] }, null, 2))
  console.log('PASS planner quiet UI, all-task calendar, simplified inspector, card expansion, focus filter, dated quick capture')
} finally {
  await app.close()
}
