import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

// All records and API replies below are synthetic and isolated from the user's workspace data.
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve(
  'test-results/task-overview-upgrade',
  executablePath ? 'packaged' : 'development'
)
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: profile,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE
const checks = [],
  errors = [],
  layouts = []
const pass = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
const unwrap = (value) => {
  assert.equal(value.ok, true, JSON.stringify(value))
  return value.data
}
const localDay = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const today = localDay(new Date()),
  next = new Date()
next.setDate(next.getDate() + 1)
const tomorrow = localDay(next)
const zh = {
  titleZh: '科研工作流程验证',
  abstractZh:
    '本文档仅用于验证本地科研工作台，不包含私人数据，也不提出科研结论。原文与译文应保持独立，概览仅呈现中文题目和中文摘要。'
}
let overviewRequests = 0,
  planRequests = 0,
  failNext = false
const server = createServer(async (req, res) => {
  let body = ''
  for await (const chunk of req) body += chunk
  const request = JSON.parse(body),
    input = JSON.parse(request.messages[1].content)
  let content
  if ('abstract' in input) {
    overviewRequests++
    assert.deepEqual(Object.keys(input).sort(), ['abstract', 'title'])
    assert.ok(input.abstract.length > 20)
    if (failNext) {
      failNext = false
      res.writeHead(503)
      res.end('{}')
      return
    }
    content = zh
  } else {
    planRequests++
    const name = input.request.includes('材料实验') ? '材料实验' : '论文写作'
    const project = input.projects.find((item) => item.name === name)
    content = {
      action: 'create_tasks',
      message: '已理解',
      tasks: [
        {
          title: name === '材料实验' ? '整理实验记录' : '会议安排',
          projectId: project.id,
          scheduledDate: today,
          startTime: '18:00',
          endTime: null
        }
      ]
    }
  }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(content) }, finish_reason: 'stop' }]
    })
  )
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
let app, page
async function launch() {
  app = await electron.launch({
    ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }),
    env
  })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 1000)
    win.webContents.setBackgroundThrottling(false)
    win.showInactive()
  })
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
const nav = (name) =>
  page
    .getByRole('navigation', { name: '科研工作空间' })
    .getByRole('button', { name, exact: true })
    .click()
const globalView = (name) =>
  page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
const screenshot = (name) =>
  page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function geometry(name) {
  const layout = await page.evaluate(() => ({
    width: innerWidth,
    rootWidth: document.documentElement.scrollWidth,
    items: [
      ...document.querySelectorAll(
        '.capture-ai, .submission-key-detail, .paper-card-actions, .paper-overview-content'
      )
    ].map((el) => ({ name: el.className, client: el.clientWidth, scroll: el.scrollWidth }))
  }))
  assert.ok(layout.rootWidth <= layout.width + 1, `${name}: root overflow`)
  for (const item of layout.items)
    assert.ok(item.scroll <= item.client + 2, `${name}: ${JSON.stringify(item)}`)
  layouts.push({ name, ...layout })
}
function makePdf(path, hasAbstract) {
  const lines = [
    'Research workflow verification',
    ...(hasAbstract
      ? [
          'Abstract',
          'This synthetic document verifies a local research workbench.',
          'It contains no private data and makes no scientific claims.',
          'Original and translated documents should remain independent.',
          'Keywords: verification, research',
          '1. Introduction'
        ]
      : ['No abstract is present in this synthetic document.'])
  ]
  const stream =
    'BT /F1 12 Tf 50 780 Td 20 TL ' +
    lines.map((line, i) => `${i ? 'T* ' : ''}(${line}) Tj`).join('\n') +
    ' ET'
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'
  ]
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => String(offset).padStart(10, '0') + ' 00000 n \n')
    .join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`
  writeFileSync(path, pdf)
}
try {
  await launch()
  const seed = unwrap(
    await page.evaluate(
      async ({ today, tomorrow, baseUrl }) => {
        const get = (r) => {
          if (!r.ok) throw Error(r.error.message)
          return r.data
        }
        const a = get(
          await window.workbench.createProject({
            name: '论文写作',
            description: '',
            colorKey: 'blue'
          })
        )
        const b = get(
          await window.workbench.createProject({
            name: '材料实验',
            description: '',
            colorKey: 'sage'
          })
        )
        get(
          await window.workbench.createTask({
            title: '今日写作',
            projectId: a.id,
            scheduledDate: today
          })
        )
        get(
          await window.workbench.createTask({
            title: '今日实验',
            projectId: b.id,
            scheduledDate: today,
            startTime: '14:15'
          })
        )
        get(
          await window.workbench.createTask({
            title: '明日实验',
            projectId: b.id,
            scheduledDate: tomorrow
          })
        )
        get(await window.workbench.createTask({ title: '待安排实验', projectId: b.id }))
        const done = get(
          await window.workbench.createTask({ title: '已完成写作', projectId: a.id })
        )
        get(await window.workbench.completeTask(done.id, true))
        get(
          await window.workbench.saveAssistantSettings({
            provider: 'custom',
            baseUrl,
            model: 'controlled-fixture'
          })
        )
        get(
          await window.workbench.createSubmission({
            title: 'Synthetic research submission for interface verification',
            journal: 'Demonstration Journal',
            manuscriptId: 'DEMO-2026-0910-001',
            stages: [{ name: 'Submitted to Journal', occurredOn: today }],
            revisionDueDate: null,
            reminderEnabled: false,
            reminderDays: 3,
            notes: ''
          })
        )
        get(
          await window.workbench.createSubmission({
            title: 'Submission draft with missing details',
            journal: 'Example Journal',
            manuscriptId: '',
            stages: [],
            revisionDueDate: null,
            reminderEnabled: false,
            reminderDays: 3,
            notes: ''
          })
        )
        return { ok: true, data: { a: a.id, b: b.id } }
      },
      { today, tomorrow, baseUrl }
    )
  )
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  assert.equal(
    await page
      .locator('.planner-nav .sidebar-link')
      .filter({ hasText: '全部任务' })
      .locator('.nav-count')
      .innerText(),
    '5'
  )
  await globalView('全部任务')
  assert.equal(await page.locator('.task-row').count(), 5)
  assert.equal(await page.locator('.plan-note').count(), 2)
  assert.equal(await page.getByRole('button', { name: '全部项目', exact: true }).count(), 0)
  await globalView('Today Plan')
  await page.getByText('今日写作', { exact: true }).waitFor()
  assert.equal(await page.getByTestId('task-row').filter({ hasText: '今日实验' }).count(), 1)
  assert.equal(await page.getByText('明日实验', { exact: true }).count(), 0)
  assert.ok((await page.locator('.workspace-breadcrumb').innerText()).includes('研究计划'))
  pass(
    'The flat planner navigation, All Tasks notes and Today Plan include work from both projects'
  )

  for (const [index, text] of [
    '今天晚上6点，论文写作项目会议安排',
    '今天晚上6点，材料实验项目整理实验记录'
  ].entries()) {
    await page.getByLabel('添加一个研究任务', { exact: true }).fill(text)
    if (index === 0)
      await page.getByRole('button', { name: 'AI 识别并添加任务', exact: true }).click()
    else await page.getByLabel('添加一个研究任务', { exact: true }).press('Enter')
    await page.getByRole('dialog').getByText('已添加 1 项计划。', { exact: true }).waitFor()
    await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  }
  const snapshot = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.equal(snapshot.tasks.length, 7)
  assert.equal(planRequests, 2)
  assert.equal(snapshot.tasks.find((t) => t.title === '整理实验记录').projectId, seed.b)
  assert.equal(snapshot.tasks.find((t) => t.title === '会议安排').endTime, null)
  await globalView('全部任务')
  await screenshot('all-tasks')
  await geometry('all-tasks')
  pass(
    'Enabled AI mode and Enter create consecutive dated tasks through the visible recognition switch'
  )

  await nav('论文投稿')
  await page.getByText('DEMO-2026-0910-001', { exact: true }).waitFor()
  const emphasis = await page
    .locator('.submission-key-detail strong')
    .first()
    .evaluate((el) => ({
      size: parseFloat(getComputedStyle(el).fontSize),
      labelSize: parseFloat(getComputedStyle(el.previousElementSibling).fontSize),
      weight: Number(getComputedStyle(el).fontWeight)
    }))
  assert.ok(emphasis.size > emphasis.labelSize && emphasis.weight >= 600)
  assert.equal(await page.getByText('未填写', { exact: true }).count(), 1)
  await screenshot('submissions')
  await geometry('submissions')
  pass(
    'Submission date and manuscript ID have independent prominent fields and missing-value states'
  )

  const source = join(profile, 'overview-source.pdf'),
    missing = join(profile, 'missing-abstract.pdf'),
    daily = join(profile, 'arxiv-source.pdf')
  makePdf(source, true)
  makePdf(missing, false)
  copyFileSync(resolve('tests/fixtures/translation-check.pdf'), daily)
  const report = unwrap(
    await page.evaluate(
      (paths) => window.workbench.importPapers(paths, null, false),
      [source, missing, daily]
    )
  )
  assert.equal(report.added, 3)
  let papers = unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers
  const sourcePaper = papers.find((p) => p.originalName === 'overview-source.pdf'),
    missingPaper = papers.find((p) => p.originalName === 'missing-abstract.pdf'),
    dailyPaper = papers.find((p) => p.originalName === 'arxiv-source.pdf')
  const originals = new Map(
    [sourcePaper, missingPaper].map((paper) => [paper.id, readFileSync(paper.sourcePath)])
  )
  await app.close()
  app = null
  const dailyDirectory = join(profile, 'library', 'Arxiv Daily', today, dailyPaper.id)
  mkdirSync(dailyDirectory, { recursive: true })
  const dailySource = join(dailyDirectory, 'source.pdf'),
    dailyTranslation = join(dailyDirectory, 'bilingual.pdf')
  copyFileSync(dailyPaper.sourcePath, dailySource)
  copyFileSync(dailyPaper.sourcePath, dailyTranslation)
  const db = new DatabaseSync(join(profile, 'workbench.sqlite'))
  db.prepare(
    'UPDATE papers SET collection = ?, abstract = ?, arxiv_id = ?, collected_date = ?, source_path = ?, translated_path = ?, translation_status = ? WHERE id = ?'
  ).run(
    'arxiv',
    'A synthetic abstract from the arXiv feed for overview testing.',
    '2609.00000',
    today,
    dailySource,
    dailyTranslation,
    'ready',
    dailyPaper.id
  )
  db.close()
  await launch()
  await nav('文献阅读')
  const card = () => page.getByTestId('paper-card').filter({ hasText: 'overview-source' })
  await card().waitFor()
  assert.deepEqual(await card().locator('.paper-card-actions button').allTextContents(), [
    '原文',
    '未翻译',
    '中英摘要'
  ])
  await screenshot('library-three-actions')
  assert.equal(await card().locator('.paper-translation-state').count(), 0)
  await card().getByRole('button', { name: '中英摘要', exact: true }).click()
  await page.getByRole('dialog').getByRole('heading', { name: zh.titleZh, exact: true }).waitFor()
  assert.equal(overviewRequests, 1)
  assert.deepEqual(await page.locator('.paper-overview-content h3').allTextContents(), [
    '英文原文 Original',
    '中文翻译 中文'
  ])
  assert.equal(await page.locator('.paper-summary-translation p').innerText(), zh.abstractZh)
  assert.match(await page.locator('.paper-summary-original p').innerText(), /This synthetic document/)
  const overviewSections = await page.locator('.paper-overview-section').evaluateAll((sections) =>
    sections.map((section) => {
      const bounds = section.getBoundingClientRect(),
        style = getComputedStyle(section)
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        left: bounds.left,
        right: bounds.right,
        borderTop: style.borderTopWidth,
        borderLeft: style.borderLeftWidth,
        radius: style.borderRadius
      }
    })
  )
  assert.equal(overviewSections.length, 2)
  assert.ok(overviewSections[1].left - overviewSections[0].right >= 20)
  assert.ok(Math.abs(overviewSections[1].top - overviewSections[0].top) < 2)
  assert.notEqual(overviewSections[0].borderTop, '0px')
  assert.notEqual(overviewSections[1].borderTop, '0px')
  assert.ok(parseFloat(overviewSections[1].borderTop) > parseFloat(overviewSections[0].borderTop))
  await screenshot('overview')
  await geometry('overview')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await card().getByRole('button', { name: '中英摘要', exact: true }).click()
  await page.getByRole('heading', { name: zh.titleZh, exact: true }).waitFor()
  assert.equal(overviewRequests, 1)
  failNext = true
  await page.getByRole('button', { name: '重新翻译', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '503' }).waitFor()
  assert.equal(await page.getByRole('heading', { name: zh.titleZh, exact: true }).count(), 1)
  await page.getByRole('button', { name: '重新翻译', exact: true }).click()
  await page.waitForFunction(
    () =>
      !document.querySelector('.paper-overview-loading') &&
      !document.querySelector('.paper-overview-dialog [role="alert"]')
  )
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  pass(
    'Ordinary PDF abstract extraction, clearly separated Chinese title/abstract, cached reopen and failed-refresh recovery'
  )

  await page
    .getByTestId('paper-card')
    .filter({ hasText: 'missing-abstract' })
    .getByRole('button', { name: '中英摘要', exact: true })
    .click()
  await page.getByLabel('原文摘要', { exact: true }).waitFor()
  const beforeMissing = overviewRequests
  assert.equal(await page.getByRole('button', { name: '翻译摘要', exact: true }).isDisabled(), true)
  await page
    .getByLabel('原文摘要', { exact: true })
    .fill('This original abstract is supplied explicitly for the synthetic paper.')
  await page.getByRole('button', { name: '翻译摘要', exact: true }).click()
  await page.getByRole('heading', { name: zh.titleZh, exact: true }).waitFor()
  assert.equal(overviewRequests, beforeMissing + 1)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await page.getByRole('button', { name: /^Arxiv Daily/ }).click()
  const dailyCard = page.getByTestId('paper-card')
  await dailyCard.waitFor()
  assert.deepEqual(await dailyCard.locator('.paper-card-actions button').allTextContents(), [
    '原文',
    '已翻译',
    '中英摘要'
  ])
  await dailyCard.locator('.paper-title').click()
  await page.getByRole('heading', { name: zh.titleZh, exact: true }).waitFor()
  assert.equal(await page.locator('.pdf-page').count(), 0)
  assert.equal(await page.locator('.paper-summary-original p').innerText(), 'A synthetic abstract from the arXiv feed for overview testing.')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  papers = unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers
  for (const original of [sourcePaper, missingPaper]) {
    const current = papers.find((p) => p.id === original.id)
    assert.equal(current.translationStatus, 'idle')
    assert.equal(current.translatedPath, null)
    assert.equal(current.readProgress, original.readProgress)
    assert.deepEqual(readFileSync(current.sourcePath), originals.get(original.id))
  }
  await dailyCard.getByRole('button', { name: '已翻译', exact: true }).click()
  await page.locator('.pdf-page canvas').waitFor()
  await page.keyboard.press('Escape')
  pass(
    'Missing-abstract fallback, arXiv overview, and existing translated-PDF action work independently'
  )

  for (const [width, height, font] of [
    [1100, 700, 18],
    [2048, 1096, 18],
    [1600, 1000, 14]
  ]) {
    unwrap(
      await page.evaluate(
        (theme) => window.workbench.setAppearance(theme),
        width === 2048 ? 'dark' : 'light'
      )
    )
    unwrap(
      await page.evaluate(
        (fontSize) => window.workbench.updateInterfacePreferences({ fontSize }),
        font
      )
    )
    await page.reload()
    await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
    await app.evaluate(
      ({ BrowserWindow }, [width, height]) =>
        BrowserWindow.getAllWindows()[0].setContentSize(width, height),
      [width, height]
    )
    await nav('论文投稿')
    await page.locator('.submission-key-detail').first().waitFor()
    await geometry(`submission-${width}-${font}`)
    await page.getByText('DEMO-2026-0910-001', { exact: true }).scrollIntoViewIfNeeded()
    await screenshot(`submission-${width}-${font}`)
    await nav('文献阅读')
    await page.getByTestId('paper-card').first().waitFor()
    await geometry(`library-${width}-${font}`)
    await page
      .getByTestId('paper-card')
      .first()
      .getByRole('button', { name: '中英摘要', exact: true })
      .scrollIntoViewIfNeeded()
    await screenshot(`library-${width}-${font}`)
    await nav('研究计划')
    await geometry(`capture-${width}-${font}`)
  }
  const beforeRestart = overviewRequests
  await app.close()
  app = null
  await launch()
  await nav('文献阅读')
  await card().getByRole('button', { name: '中英摘要', exact: true }).click()
  await page.getByRole('heading', { name: zh.titleZh, exact: true }).waitFor()
  assert.equal(overviewRequests, beforeRestart)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.bootstrap())).tasks.length, 7)
  pass('18-point fonts and three viewport sizes fit; saved overview and tasks survive restart')
  assert.deepEqual(errors, [])
  writeFileSync(
    join(evidence, 'report.json'),
    JSON.stringify(
      {
        controlledApi: true,
        packaged: !!executablePath,
        checks,
        errors,
        layouts,
        overviewRequests,
        planRequests
      },
      null,
      2
    )
  )
  console.log(`ALL ${checks.length} TASK / OVERVIEW CHECKS PASSED`)
} catch (error) {
  if (page && !page.isClosed()) await screenshot('failure').catch(() => undefined)
  writeFileSync(
    join(evidence, 'failure.json'),
    JSON.stringify({ error: String(error), checks, errors }, null, 2)
  )
  throw error
} finally {
  if (app) await app.close().catch(() => undefined)
  server.closeAllConnections()
  await new Promise((done) => server.close(done))
}
