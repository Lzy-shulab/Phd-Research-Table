import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, basename, resolve, join } from 'node:path'
import { format, addDays } from 'date-fns'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const directory = resolve('验收记录/日历汇总', executablePath ? 'packaged' : 'development')
mkdirSync(directory, { recursive: true })
const tempRoot = realpathSync(tmpdir())
const dataDirectory = mkdtempSync(join(tempRoot, 'workbench-calendar-'))
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: dataDirectory,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1'
}
delete env.ELECTRON_RUN_AS_NODE
const today = format(new Date(), 'yyyy-MM-dd')
const nextWeek = format(addDays(new Date(), 7), 'yyyy-MM-dd')
const checks = [],
  errors = []
const check = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
let app, page
const snapshot = async () => {
  const result = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(result.ok, true)
  return result.data
}
const nav = async (name) =>
  page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
const titles = async () => page.locator('.calendar-view .block-title').allTextContents()
async function launch() {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    env
  })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.hide()
    window.setBounds({ width: 1440, height: 1000 })
  })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), dataDirectory)
}
try {
  await launch()
  const ids = await page.evaluate(
    async ({ today, nextWeek }) => {
      const unwrap = (result) => {
        if (!result.ok) throw Error(result.error.message)
        return result.data
      }
      const a = unwrap(
        await window.workbench.createProject({
          name: '光谱重建研究',
          description: '隔离验收',
          colorKey: 'blue'
        })
      )
      const b = unwrap(
        await window.workbench.createProject({
          name: '论文写作',
          description: '隔离验收',
          colorKey: 'violet'
        })
      )
      const archived = unwrap(
        await window.workbench.createProject({
          name: '已归档课题',
          description: '隔离验收',
          colorKey: 'sage'
        })
      )
      for (const input of [
        {
          title: '重建实验',
          projectId: a.id,
          scheduledDate: today,
          startTime: '09:17',
          endTime: '10:43'
        },
        {
          title: '方法章节',
          projectId: b.id,
          scheduledDate: today,
          startTime: '10:05',
          endTime: '11:38'
        },
        {
          title: '归档项目安排',
          projectId: archived.id,
          scheduledDate: today,
          startTime: '13:00',
          endTime: '14:00'
        },
        { title: '整理文献', projectId: b.id, scheduledDate: today },
        {
          title: '下周实验',
          projectId: a.id,
          scheduledDate: nextWeek,
          startTime: '09:00',
          endTime: '10:00'
        },
        {
          title: '下周写作',
          projectId: b.id,
          scheduledDate: nextWeek,
          startTime: '11:00',
          endTime: '12:00'
        }
      ])
        unwrap(await window.workbench.createTask(input))
      const completed = unwrap(
        await window.workbench.createTask({
          title: '已完成安排',
          projectId: a.id,
          scheduledDate: today,
          startTime: '15:00',
          endTime: '16:00'
        })
      )
      unwrap(await window.workbench.completeTask(completed.id, true))
      unwrap(await window.workbench.updateProject(archived.id, { archived: true }))
      return { a: a.id, b: b.id }
    },
    { today, nextWeek }
  )
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  const before = await snapshot()
  const storageBefore = await page.evaluate(() => window.workbench.storageSnapshot())
  await nav('日历')
  await page.locator('.calendar-view').waitFor()
  assert.deepEqual((await titles()).sort(), ['重建实验', '方法章节', '归档项目安排'].sort())
  assert.equal(
    await page
      .locator('.calendar-anytime')
      .getByRole('button', { name: '整理文献', exact: true })
      .count(),
    1
  )
  assert.match(await page.locator('.workspace-breadcrumb').innerText(), /研究计划.*日历/s)
  assert.equal(await page.locator('.project-nav, .project-overview').count(), 0)
  assert.equal(await page.getByLabel('新计划所属项目').inputValue(), '')
  assert.equal(
    await page
      .getByTestId('schedule-block')
      .filter({ hasText: '方法章节' })
      .locator('.block-project')
      .innerText(),
    '论文写作'
  )
  check(
    'Calendar shows all projects, archived schedules and untimed tasks with project identity without a project-page scope'
  )
  await page.screenshot({ path: join(directory, 'week.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '日视图', exact: true }).click()
  assert.deepEqual((await titles()).sort(), ['重建实验', '方法章节', '归档项目安排'].sort())
  const geometry = await page
    .getByTestId('schedule-block')
    .filter({ hasText: '重建实验' })
    .evaluate((el) => ({
      top: parseFloat(el.style.top),
      height: parseFloat(el.style.height),
      width: el.getBoundingClientRect().width
    }))
  assert.ok(Math.abs(geometry.top - 557 * 1.2) < 0.01)
  assert.ok(Math.abs(geometry.height - 86 * 1.2) < 0.01)
  assert.ok(geometry.width < (await page.locator('.schedule-day').boundingBox()).width * 0.6)
  await page.screenshot({ path: join(directory, 'day.png'), animations: 'disabled' })
  await page.getByRole('button', { name: '周视图', exact: true }).click()
  await page.getByRole('button', { name: '下一时段', exact: true }).click()
  assert.deepEqual((await titles()).sort(), ['下周实验', '下周写作'].sort())
  check(
    'Day/week views and next week combine projects while preserving minute geometry and overlapping columns'
  )
  await page
    .getByRole('region', { name: '日期导航' })
    .getByRole('button', { name: format(new Date(), 'yyyy年M月d日'), exact: true })
    .click()
  assert.deepEqual((await titles()).sort(), ['重建实验', '方法章节', '归档项目安排'].sort())
  await nav('全部任务')
  assert.equal(await page.locator('.plan-note').filter({ hasText: '已归档课题' }).count(), 1)
  assert.equal(
    await page.getByRole('button', { name: '管理项目 已归档课题', exact: true }).count(),
    1
  )
  await nav('日历')
  assert.equal(
    await page
      .getByRole('button', { name: /^新建任务/ })
      .first()
      .isEnabled(),
    true
  )
  assert.deepEqual((await titles()).sort(), ['重建实验', '方法章节', '归档项目安排'].sort())
  check(
    'Mini-calendar, archived work in All Tasks and the shared calendar remain available without project-page navigation'
  )
  const after = await snapshot()
  assert.deepEqual(after.tasks, before.tasks)
  assert.deepEqual(after.projects, before.projects)
  assert.deepEqual(await page.evaluate(() => window.workbench.storageSnapshot()), storageBefore)
  check('Calendar navigation leaves all saved task/project fields and storage locations unchanged')
  await page.getByLabel('新计划所属项目').selectOption(ids.b)
  const recognition = page.getByRole('switch', { name: 'AI 识别', exact: true })
  if ((await recognition.getAttribute('aria-checked')) === 'true') await recognition.click()
  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).fill('从汇总日历新增')
  await page.getByRole('button', { name: '直接添加任务', exact: true }).click()
  await waitForAsync(
    page,
    async (id) => {
      const result = await window.workbench.bootstrap()
      return (
        result.ok &&
        result.data.tasks.some((task) => task.title === '从汇总日历新增' && task.projectId === id)
      )
    },
    ids.b
  )
  assert.deepEqual((await titles()).sort(), ['重建实验', '方法章节', '归档项目安排'].sort())
  const saved = await snapshot()
  await app.close()
  app = null
  await launch()
  assert.deepEqual((await snapshot()).tasks, saved.tasks)
  await nav('日历')
  assert.deepEqual((await titles()).sort(), ['重建实验', '方法章节', '归档项目安排'].sort())
  assert.equal(
    await page
      .locator('.calendar-anytime')
      .getByRole('button', { name: '从汇总日历新增', exact: true })
      .count(),
    1
  )
  check(
    'Creating a task retains its chosen project without filtering the calendar; restart preserves schedules'
  )
  assert.deepEqual(errors, [])
  writeFileSync(
    join(directory, 'report.json'),
    JSON.stringify(
      { checks, errors, isolated: true, geometry, packaged: !!executablePath },
      null,
      2
    )
  )
  console.log(`ALL ${checks.length} CALENDAR CHECKS PASSED`)
} catch (error) {
  await page
    ?.screenshot({ path: join(directory, 'failure.png'), animations: 'disabled' })
    .catch(() => {})
  throw error
} finally {
  if (app) await app.close()
  const target = realpathSync(dataDirectory)
  if (dirname(target) === tempRoot && basename(target).startsWith('workbench-calendar-'))
    rmSync(target, { recursive: true, force: true })
}
