import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readdirSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'
import Database from 'better-sqlite3'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const directory = resolve(
  `test-results/current/evolution-${executablePath ? 'packaged' : 'development'}`
)
mkdirSync(directory, { recursive: true })
const dataDirectory = join(directory, `profile-${Date.now()}`)
const env = {
  ...process.env,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1',
  WORKBENCH_DATA_DIR: dataDirectory
}
delete env.ELECTRON_RUN_AS_NODE
delete env.WORKBENCH_DISABLE_METADATA_AUTO
const sourceDirectory = 'D:/Desktop/我的文件/Phd Research Move/LiteratureTranslation/source'
const source = join(
  sourceDirectory,
  readdirSync(sourceDirectory).find((name) => name.startsWith('Li_Learning_'))
)
const expectedTitle =
  'Learning without Exact Guidance: Updating Large-scale High-resolution Land Cover Maps from Low-resolution Historical Labels'
const checks = [],
  errors = []
const record = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
const unwrap = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data
}
let app, page
async function launch() {
  app = await electron.launch(
    executablePath
      ? { executablePath: resolve(executablePath), args: [], env }
      : { args: ['.'], env }
  )
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
const section = (name) =>
  page
    .getByRole('navigation', { name: '科研工作空间' })
    .getByRole('button', { name, exact: true })
    .click()
const snapshot = async () => unwrap(await page.evaluate(() => window.workbench.librarySnapshot()))
const capture = async (name) => {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('.nav-selection, .dock-selection')).every((item) => {
      const a = item.getBoundingClientRect(),
        b = item.parentElement.getBoundingClientRect()
      return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
    })
  )
  await page.screenshot({ path: join(directory, name), animations: 'disabled', scale: 'css' })
}
try {
  await launch()
  const fixtures = unwrap(
    await page.evaluate(async () => {
      const p1 = await window.workbench.createProject({
        name: '光谱重建研究',
        description: '模型实验、消融和论文写作',
        colorKey: 'blue'
      })
      const p2 = await window.workbench.createProject({
        name: '已归档的分类研究',
        description: '保留已完成任务',
        colorKey: 'sage'
      })
      const p3 = await window.workbench.createProject({
        name: '准备中的新课题',
        description: '',
        colorKey: 'violet'
      })
      const inputs = [
        {
          title: '未来实验任务',
          projectId: p1.data.id,
          scheduledDate: '2027-01-08',
          startTime: '09:17',
          endTime: '10:43'
        },
        { title: '已完成的论文初稿', projectId: p1.data.id },
        { title: '已归档项目任务', projectId: p2.data.id },
        { title: '还没有归属的研究事项', projectId: p1.data.id }
      ]
      const tasks = []
      for (const input of inputs) {
        const result = await window.workbench.createTask(input)
        if (!result.ok) return result
        tasks.push(result.data)
      }
      await window.workbench.completeTask(tasks[1].id, true)
      const archived = await window.workbench.updateProject(p2.data.id, { archived: true })
      if (!archived.ok) return archived
      return { ok: true, data: { projects: [p1.data, p2.data, p3.data], tasks } }
    })
  )
  // Existing v0.1 unassigned rows remain valid; current creation requires a project.
  const fixtureDb = new Database(join(dataDirectory, 'workbench.sqlite'))
  fixtureDb.prepare('UPDATE tasks SET project_id = NULL WHERE id = ?').run(fixtures.tasks[3].id)
  fixtureDb.close()
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: /^全部任务/ })
    .click()
  await page.getByRole('heading', { name: '全部任务', exact: true }).waitFor()
  assert.equal(await page.locator('.plan-note').count(), 4)
  for (const task of fixtures.tasks)
    assert.equal(await page.locator('.task-content').filter({ hasText: task.title }).count(), 1)
  assert.equal(await page.getByRole('button', { name: '全部项目', exact: true }).count(), 0)
  await page.getByLabel('筛选任务').fill('未来实验')
  assert.equal(await page.locator('.plan-note').count(), 1)
  await page.getByLabel('筛选任务').fill('')
  await page.getByRole('button', { name: '浅色模式' }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000))
  await capture('all-tasks-light.png')
  record(
    'All Tasks notes include active, archived, completed, future and unassigned work; the removed project hierarchy is replaced by task search'
  )

  await app.evaluate(({ session }, expectedTitle) => {
    const research = session.fromPartition('workbench-research')
    globalThis.__researchFetch = research.fetch.bind(research)
    research.fetch = async (url) => {
      globalThis.__metadataUrls = [...(globalThis.__metadataUrls ?? []), String(url)]
      const paper = {
        title: [expectedTitle],
        DOI: '10.1109/CVPR52733.2024.02247',
        author: [{ given: 'Bibliography', family: 'Fixture' }],
        'container-title': ['CVPR 2024 · 书目接口验收数据'],
        published: { 'date-parts': [[2024, 6, 17]] }
      }
      return new Response(
        JSON.stringify({ message: String(url).includes('works?') ? { items: [paper] } : paper }),
        { headers: { 'Content-Type': 'application/json' } }
      )
    }
  }, expectedTitle)
  unwrap(await page.evaluate((path) => window.workbench.importPapers([path], null, false), source))
  await waitForAsync(
    page,
    async () => {
      const r = await window.workbench.librarySnapshot()
      return (
        r.ok &&
        r.data.papers.length === 1 &&
        ['ready', 'partial', 'failed'].includes(r.data.papers[0].metadataStatus)
      )
    },
    null,
    45_000
  )
  let paper = (await snapshot()).papers[0]
  writeFileSync(join(directory, 'metadata-result.json'), JSON.stringify(paper, null, 2))
  assert.ok(paper.title.includes('Learning without Exact Guidance'), paper.title)
  assert.ok(paper.authors.length > 3, JSON.stringify(paper))
  assert.equal(paper.year, '2024')
  assert.ok(paper.journal.length > 3)
  assert.equal(paper.metadataStatus, 'ready', paper.metadataMessage)
  assert.ok(paper.pageCount > 5)
  const urls = await app.evaluate(() => globalThis.__metadataUrls)
  assert.ok(
    urls.length > 0 && urls.every((url) => url.startsWith('https://api.crossref.org/works'))
  )
  await section('文献阅读')
  await page.locator('.paper-card .pdf-cover img').waitFor()
  await page.getByRole('button', { name: `阅读 ${paper.title}`, exact: true }).click()
  await page.getByTestId('pdf-page').waitFor()
  await page.getByLabel('文献页码', { exact: true }).fill('5')
  await page.getByLabel('文献页码', { exact: true }).press('Enter')
  await waitForAsync(page, async () => {
    const r = await window.workbench.librarySnapshot()
    return r.ok && r.data.papers[0].readPage === 5
  })
  const progress = (await snapshot()).papers[0].readProgress
  await page.getByLabel('文献页码', { exact: true }).fill('2')
  await page.getByLabel('文献页码', { exact: true }).press('Enter')
  await waitForAsync(page, async () => {
    const r = await window.workbench.librarySnapshot()
    return r.ok && r.data.papers[0].readPage === 2
  })
  assert.equal((await snapshot()).papers[0].readProgress, progress)
  await page.getByRole('button', { name: '返回文献库', exact: true }).click()
  assert.equal(
    await page.locator('.paper-progress-track').getAttribute('aria-valuenow'),
    String(progress)
  )
  assert.match(
    await page
      .locator('.paper-progress-track > i')
      .evaluate((item) => getComputedStyle(item).backgroundImage),
    /linear-gradient/
  )
  await capture('library-light.png')
  record(
    'Real PDF title/author extraction with a mocked Crossref response fills the card; rendered reading pages persist a monotonic gradient progress bar'
  )

  await section('论文投稿')
  assert.deepEqual(await page.locator('.dock-item').allTextContents(), [
    '研究计划',
    '文献阅读',
    '科研成果',
    '论文投稿',
    '设置'
  ])
  await page.getByRole('button', { name: '新增投稿', exact: true }).first().click()
  await page
    .getByLabel('投稿论文标题')
    .fill('CFSSR-Net: Cross-Scale Fusion for Hyperspectral Image Reconstruction')
  await page.getByLabel('投稿期刊或会议').fill('Information Fusion')
  await page.getByLabel('状态 1 名称', { exact: true }).fill('Submitted to Journal')
  await page.getByLabel('状态 1 日期', { exact: true }).fill('2026-09-01')
  await page.getByLabel('稿件编号').fill('INFFUS-2026-DEMO')
  await page.getByRole('button', { name: '保存投稿记录' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: /更新投稿 CFSSR-Net/ }).click()
  await page.getByRole('button', { name: '添加状态', exact: true }).click()
  await page.getByLabel('状态 2 名称', { exact: true }).fill('Major Revision')
  await page.getByLabel('状态 2 日期', { exact: true }).fill('2026-09-10')
  await page.getByLabel('返修截止日期').fill('2026-09-11')
  await page.getByLabel('投稿备注').fill('验收样例：补充模型效率分析，逐条整理审稿回复。')
  await page.getByRole('button', { name: '保存投稿记录' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(
    await page
      .getByTestId('submission-card')
      .filter({ hasText: 'CFSSR-Net' })
      .getByTestId('submission-stage')
      .count(),
    2
  )
  const submission = unwrap(await page.evaluate(() => window.workbench.submissionsSnapshot()))
    .submissions[0]
  unwrap(
    await page.evaluate(
      (base) => window.workbench.createSubmission({ ...base, title: '尚未添加状态的第二篇论文' }),
      {
        title: '',
        journal: 'IEEE TGRS',
        manuscriptId: '',
        stages: [],
        revisionDueDate: null,
        reminderEnabled: true,
        reminderDays: 3,
        notes: ''
      }
    )
  )
  unwrap(
    await page.evaluate(() =>
      window.workbench.createSubmission({
        title: '已录用论文 · 验收样例',
        journal: 'Remote Sensing',
        manuscriptId: '',
        stages: [{ name: 'Accepted', occurredOn: '2026-07-01' }],
        revisionDueDate: null,
        reminderEnabled: true,
        reminderDays: 3,
        notes: ''
      })
    )
  )
  await page.waitForFunction(() => document.querySelectorAll('.submission-card').length === 3)
  assert.match(await page.getByTestId('stat-累计投稿').innerText(), /2/)
  assert.match(await page.getByTestId('stat-本月进展').innerText(), /1/)
  assert.match(await page.getByTestId('stat-返修截止').innerText(), /1/)
  assert.match(await page.getByTestId('stat-阶段记录').innerText(), /3/)
  assert.equal(
    await page
      .getByTestId('submission-card')
      .filter({ hasText: 'CFSSR-Net' })
      .locator('.submission-progress')
      .getAttribute('aria-valuenow'),
    '2'
  )
  await capture('submissions-light.png')
  await page.getByRole('button', { name: '深色模式' }).click()
  await capture('submissions-dark.png')
  record(
    'Submission dialog saves custom status names and dates; the adaptive timeline shows only recorded stages and counts empty records separately'
  )

  await section('设置')
  const previous = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  const target = join(directory, `自定义数据库-${Date.now()}`)
  mkdirSync(target)
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [target] })
  }, target)
  await page.getByRole('button', { name: '更改工作台数据保存位置', exact: true }).click()
  await page
    .getByText('工作台数据已迁移，新位置将在下次打开时继续使用。', { exact: true })
    .waitFor()
  const next = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.equal(next.databasePath, join(target, 'workbench.sqlite'))
  assert.deepEqual(next.tasks, previous.tasks)
  assert.deepEqual(next.projects, previous.projects)
  assert.equal(existsSync(previous.databasePath), false)
  assert.equal((await snapshot()).papers[0].sourcePath, paper.sourcePath)
  assert.ok(unwrap(await page.evaluate((id) => window.workbench.readPaper(id, 'source'), paper.id)))
  assert.equal(
    unwrap(await page.evaluate(() => window.workbench.submissionsSnapshot())).submissions.length,
    3
  )
  await capture('settings-dark.png')
  record(
    'Database picker migrates a nonempty live workspace without changing task/project/submission records or PDF locations'
  )
  await app.close()
  app = null
  await launch()
  assert.equal(
    unwrap(await page.evaluate(() => window.workbench.bootstrap())).databasePath,
    join(target, 'workbench.sqlite')
  )
  paper = (await snapshot()).papers[0]
  assert.equal(paper.readProgress, progress)
  assert.equal(
    unwrap(await page.evaluate(() => window.workbench.submissionsSnapshot())).submissions.find(
      (item) => item.id === submission.id
    ).currentStage,
    'Major Revision'
  )
  await section('论文投稿')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700))
  await capture('submissions-minimum-dark.png')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(
    await page
      .locator('.submissions-workspace')
      .evaluate((item) => item.scrollWidth > item.clientWidth),
    false
  )
  await page.getByRole('button', { name: /更新投稿 CFSSR-Net/ }).click()
  await capture('submission-dialog-minimum.png')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' })
  await capture('submissions-accessibility.png')
  await section('文献阅读')
  await page.locator('.paper-card .pdf-cover img').waitFor()
  await capture('library-minimum-dark.png')
  await section('设置')
  await page.getByRole('heading', { name: '保存位置', exact: true }).waitFor()
  await capture('settings-minimum-dark.png')
  record(
    'Restart uses the custom database and preserves custom stages; minimum-size, dark, reduced-motion and high-contrast layouts render without overflow'
  )
  assert.deepEqual(errors, [])
  writeFileSync(
    join(directory, 'report.json'),
    JSON.stringify(
      {
        checks,
        errors,
        executablePath: executablePath ?? 'development',
        dataDirectory,
        databasePath: join(target, 'workbench.sqlite'),
        source,
        boundary:
          'Real PDF parsing, rendering and database migration. Crossref response and folder picker stubbed. OS notifications disabled; reminder scheduling covered separately in unit tests.'
      },
      null,
      2
    )
  )
  console.log(`ALL ${checks.length} EVOLUTION CHECKS PASSED`)
} finally {
  if (app) await app.close()
}
