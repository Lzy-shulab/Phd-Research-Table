import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve('test-results/all-tasks-redesign', `layout-${Date.now()}`)
mkdirSync(root, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: resolve(root, 'data'),
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE
const packaged = !!process.env.WORKBENCH_TEST_EXECUTABLE
const app = await electron.launch(packaged
  ? { executablePath: resolve(process.env.WORKBENCH_TEST_EXECUTABLE), args: [], env }
  : { args: ['.'], env })
const page = await app.firstWindow()
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const day = (shift) => {
  const date = new Date()
  date.setDate(date.getDate() + shift)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
const layout = async (name, width, height) => {
  await app.evaluate(({ BrowserWindow }, bounds) => BrowserWindow.getAllWindows()[0].setContentSize(bounds.width, bounds.height), { width, height })
  await page.waitForFunction((expected) => Math.abs(innerWidth - expected) <= 24, width)
  const metrics = await page.evaluate(() => ({
    rootOverflow: document.documentElement.scrollWidth > innerWidth + 1,
    cardScrolls: [...document.querySelectorAll('.plan-note .task-list')].map((list) => ({
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      overflowY: getComputedStyle(list).overflowY
    })),
    emptyProjects: document.querySelectorAll('.empty-projects').length,
    cards: document.querySelectorAll('.plan-note').length
  }))
  assert.equal(metrics.rootOverflow, false, `${name}: horizontal overflow`)
  assert.ok(metrics.cardScrolls.every((item) => item.overflowY !== 'auto' && item.overflowY !== 'scroll' && item.scrollHeight <= item.clientHeight + 2), `${name}: nested card scroll ${JSON.stringify(metrics.cardScrolls)}`)
  assert.equal(metrics.emptyProjects, 0)
  await page.screenshot({ path: resolve(root, `${name}.png`), animations: 'disabled', scale: 'css' })
  return metrics
}

try {
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const seeded = await page.evaluate(async ({ yesterday, today, tomorrow }) => {
    const get = (value) => { if (!value.ok) throw Error(value.error.message); return value.data }
    const a = get(await window.workbench.createProject({ name: '论文写作', description: '', colorKey: 'blue' }))
    const b = get(await window.workbench.createProject({ name: '光谱实验', description: '', colorKey: 'sage' }))
    get(await window.workbench.createProject({ name: '空项目甲', description: '', colorKey: 'violet' }))
    get(await window.workbench.createProject({ name: '空项目乙', description: '', colorKey: 'amber' }))
    for (let index = 0; index < 5; index++) {
      const task = get(await window.workbench.createTask({ title: `论文任务 ${index + 1}`, projectId: a.id, scheduledDate: index === 0 ? yesterday : index === 1 ? today : null }))
      if (index === 4) get(await window.workbench.completeTask(task.id, true))
    }
    get(await window.workbench.createTask({ title: '明日实验', projectId: b.id, dueDate: tomorrow }))
    get(await window.workbench.createTask({ title: '待安排实验', projectId: b.id }))
    return { projects: 4, tasks: 7 }
  }, { yesterday: day(-1), today: day(0), tomorrow: day(1) })
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /全部任务/ }).click()
  await page.getByRole('button', { name: '任务列表' }).waitFor()
  await page.getByRole('button', { name: '任务列表' }).click()
  assert.equal(await page.getByRole('button', { name: '任务列表' }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByTestId('task-row').count(), seeded.tasks)
  assert.match(await page.getByTestId('task-row').first().innerText(), /论文任务 1/)
  assert.match(await page.getByTestId('task-row').last().innerText(), /论文任务 5/)
  assert.equal(await page.locator('.mini-calendar').count(), 1)
  await page.screenshot({ path: resolve(root, 'all-tasks-list-light-1600.png'), animations: 'disabled', scale: 'css' })
  await page.getByRole('button', { name: '项目卡片' }).click()
  await page.locator('.plan-note').first().waitFor()
  assert.equal(await page.locator('.plan-note').count(), 2)
  assert.match(await page.locator('.plan-note').first().locator('.plan-note-count').innerText(), /已完成 1 \/ 5/)
  assert.equal(await page.locator('.empty-projects').count(), 0)
  assert.equal(await page.locator('.plan-note-board').getByText('空项目甲', { exact: true }).count(), 0)
  assert.equal(await page.locator('.plan-note-board').getByText('空项目乙', { exact: true }).count(), 0)
  assert.equal(await page.locator('.all-task-focus').getByText('逾期', { exact: true }).count(), 1)
  const checks = {
    light: await layout('all-tasks-light-1600', 1600, 900),
    narrow: await layout('all-tasks-light-1100', 1100, 700)
  }
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  checks.dark = await layout('all-tasks-dark-1600', 1600, 900)
  await page.getByRole('button', { name: '任务列表' }).click()
  assert.equal(await page.getByTestId('task-row').count(), seeded.tasks)
  assert.deepEqual(errors, [])
  writeFileSync(resolve(root, 'report.json'), JSON.stringify({ packaged, checks, errors }, null, 2))
  console.log(`PASS all tasks list/cards, persistent calendar, no empty-project placeholders, status, no nested scroll, light/dark, 1600/1100; ${root}`)
} finally {
  await app.close()
}
