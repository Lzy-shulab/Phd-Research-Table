import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

// Synthetic fixtures only. Never open the production profile in this test.
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/paper-studio', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `profile-${Date.now()}`)
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
  errors = []
const pass = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
const unwrap = (result) => {
  assert.equal(result.ok, true, JSON.stringify(result))
  return result.data
}
const localDay = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const today = localDay(new Date()),
  next = new Date()
next.setDate(next.getDate() + 1)
const tomorrow = localDay(next)
let app, page
function makePdf(path, title) {
  const lines = [
    title,
    'A synthetic publication for interface verification',
    'Lin Researcher, Chen Researcher',
    'Journal of Research Methods / 2026',
    '',
    'Abstract',
    'This document is a local interface fixture.',
    'It contains no private data and makes no research claims.',
    '',
    '1. Introduction',
    ...Array.from(
      { length: 12 },
      () => 'The original PDF first page remains readable in the collection.'
    )
  ]
  const stream =
    'BT /F1 12 Tf 48 780 Td 24 TL ' +
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
const view = (name) =>
  page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: new RegExp(`^${name}`) })
    .click()
async function settle() {
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
  )
  await page.waitForFunction(() => {
    const detail = document.querySelector('.book-detail')
    if (!detail) return true
    const matrix = new DOMMatrixReadOnly(getComputedStyle(detail).transform)
    return (
      Math.abs(matrix.a - 1) < 0.001 &&
      Math.abs(matrix.d - 1) < 0.001 &&
      Math.abs(matrix.m41) < 0.1 &&
      Math.abs(matrix.m42) < 0.1
    )
  })
  await page.waitForFunction(() => {
    const cover = document.querySelector('.book-opening-cover')
    return !cover || Number(getComputedStyle(cover).opacity) === 0
  })
}
async function capture(name) {
  await settle()
  await page.screenshot({
    path: join(evidence, `${name}.png`),
    animations: 'disabled',
    scale: 'css'
  })
}
async function geometry(name) {
  await settle()
  const result = await page.evaluate(() => ({
    width: innerWidth,
    document: document.documentElement.scrollWidth,
    items: [
      ...document.querySelectorAll(
        '.plan-note, .book-detail, .book-detail-information, .book-detail-actions, .book-shelf-books'
      )
    ].map((e) => ({ name: e.className, width: e.clientWidth, scroll: e.scrollWidth }))
  }))
  assert.ok(result.document <= result.width + 1, `${name}: document overflow`)
  for (const item of result.items)
    assert.ok(item.scroll <= item.width + 2, `${name}: ${JSON.stringify(item)}`)
}
try {
  await launch()
  await page.getByRole('button', { name: '浅色模式' }).click()
  await capture('00-empty-planner')
  const seed = await page.evaluate(
    async ({ today, tomorrow }) => {
      const get = (r) => {
        if (!r.ok) throw Error(r.error.message)
        return r.data
      }
      const names = [
        '论文写作',
        '光谱融合',
        '文献阅读',
        '实验与复现',
        '组会交流',
        '研究灵感',
        '数据整理',
        '学位进展'
      ]
      const titles = [
        ['梳理方法章节的两阶段接口', '补充消融实验的分析', '核对图表与正文引用'],
        ['整理跨尺度融合实验', '记录不同数据集的误差'],
        ['读完三篇相关工作', '归纳训练策略与评价指标'],
        ['检查数据加载与划分', '复现实验并整理日志'],
        ['准备本周组会提纲', '汇总待讨论的问题'],
        ['记下新的研究思路', '绘制下一轮实验草图'],
        ['核对训练集版本', '归档实验配置'],
        ['更新阶段总结', '整理答辩问题']
      ]
      const projects = [],
        tasks = []
      for (let i = 0; i < names.length; i++) {
        const project = get(
          await window.workbench.createProject({
            name: names[i],
            description: '隔离界面验证项目',
            colorKey: 'blue'
          })
        )
        projects.push(project)
        for (let j = 0; j < titles[i].length; j++) {
          const task = get(
            await window.workbench.createTask({
              title: titles[i][j],
              projectId: project.id,
              scheduledDate: today,
              ...(i === 4 && j === 0 ? { startTime: '15:10', endTime: '16:20' } : {})
            })
          )
          tasks.push(task)
          if (j === 1 && [0, 2, 4].includes(i))
            get(await window.workbench.completeTask(task.id, true))
        }
      }
      get(
        await window.workbench.createTask({
          title: '明天才开始的任务',
          projectId: projects[0].id,
          scheduledDate: tomorrow
        })
      )
      get(await window.workbench.setAssistantRecognitionEnabled(false))
      return { projects, tasks }
    },
    { today, tomorrow }
  )
  await page.reload()
  await page.locator('.plan-note').nth(7).waitFor()
  assert.equal(await page.locator('.plan-note').count(), 8)
  assert.equal(await page.getByRole('button', { name: '全部项目', exact: true }).count(), 0)
  assert.equal(await page.locator('.project-nav').count(), 0)
  const noteColors = await page
    .locator('.plan-note')
    .evaluateAll((notes) => notes.map((note) => getComputedStyle(note).backgroundColor))
  assert.equal(new Set(noteColors).size, noteColors.length, JSON.stringify(noteColors))
  assert.equal(await page.getByRole('button', { name: '新建项目', exact: true }).count(), 1)
  assert.equal(await page.getByTestId('task-row').count(), seed.tasks.length)
  assert.equal(await page.getByText('明天才开始的任务', { exact: true }).count(), 0)
  await geometry('notes-light')
  await capture('01-notes-light')
  await page.getByRole('checkbox', { name: `完成 ${seed.tasks[0].title}`, exact: true }).click()
  await page.getByRole('checkbox', { name: `恢复 ${seed.tasks[0].title}`, exact: true }).waitFor()
  assert.equal(
    await page
      .locator('.plan-note')
      .filter({ hasText: '论文写作' })
      .locator('.plan-note-count')
      .innerText(),
    '2 / 3'
  )
  await page.getByRole('checkbox', { name: `恢复 ${seed.tasks[0].title}`, exact: true }).click()
  await page.getByRole('button', { name: '添加任务到 光谱融合', exact: true }).click()
  assert.equal(
    await page.getByLabel('新计划所属项目', { exact: true }).inputValue(),
    seed.projects[1].id
  )
  assert.equal(
    await page.getByLabel('添加一个研究任务').evaluate((e) => e === document.activeElement),
    true
  )
  await page.getByLabel('添加一个研究任务').fill('便签加号创建的任务')
  await page.getByRole('button', { name: '直接添加任务', exact: true }).click()
  await page
    .locator('.plan-note')
    .filter({ hasText: '光谱融合' })
    .getByText('便签加号创建的任务', { exact: true })
    .waitFor()
  const stored = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  const newTask = stored.tasks.find((t) => t.title === '便签加号创建的任务')
  assert.equal(newTask.projectId, seed.projects[1].id)
  assert.equal(newTask.scheduledDate, today)
  await page.getByRole('button', { name: '新建项目', exact: true }).click()
  await page.getByRole('dialog').getByLabel('项目名称', { exact: true }).fill('新建课题')
  await page.getByRole('dialog').getByRole('button', { name: '创建项目', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const createdProjectId = await page.getByLabel('新计划所属项目', { exact: true }).inputValue()
  assert.ok(createdProjectId)
  await page.getByLabel('添加一个研究任务').fill('新项目的第一项任务')
  await page.getByRole('button', { name: '直接添加任务', exact: true }).click()
  await page
    .locator('.plan-note')
    .filter({ hasText: '新建课题' })
    .getByText('新项目的第一项任务', { exact: true })
    .waitFor()
  await page.locator('.task-content').filter({ hasText: seed.tasks[0].title }).click()
  await page.locator('.task-inspector').waitFor()
  await geometry('notes-with-inspector')
  await page.keyboard.press('Escape')
  await page.getByLabel('筛选任务', { exact: true }).fill('光谱不存在')
  assert.equal(await page.locator('.plan-note').count(), 0)
  await page.getByLabel('筛选任务', { exact: true }).fill('')
  await page.getByRole('button', { name: '时间安排', exact: true }).click()
  await page.getByTestId('schedule-block').filter({ hasText: '准备本周组会提纲' }).waitFor()
  await page.getByRole('button', { name: '便签', exact: true }).click()
  await view('全部任务')
  await page.getByText('明天才开始的任务', { exact: true }).waitFor()
  await page.getByLabel('任务完成状态', { exact: true }).selectOption('completed')
  assert.equal(await page.getByTestId('task-row').count(), 3)
  await page.getByLabel('任务完成状态', { exact: true }).selectOption('all')
  // The existing keyboard sorting must reorder within one project without losing other tasks.
  const a = page.getByRole('button', { name: `调整顺序 ${seed.tasks[0].title}`, exact: true })
  await a.focus()
  await page.keyboard.press('Space')
  await page.locator('.task-row.dragging').waitFor()
  await page.keyboard.press('ArrowDown')
  await page.waitForFunction(() => document.body.textContent.includes('移动到第2项。'))
  await page.keyboard.press('Space')
  await waitForAsync(
    page,
    async ({ first, second }) => {
      const r = await window.workbench.bootstrap()
      return (
        r.ok &&
        r.data.tasks.find((t) => t.id === first).order >
          r.data.tasks.find((t) => t.id === second).order
      )
    },
    { first: seed.tasks[0].id, second: seed.tasks[1].id }
  )
  pass(
    'Project notes: correct date scope, completion/restore, project-targeted input, inspector, search, status filter, keyboard reorder and original schedule'
  )
  await view('Today Plan')
  await page.getByRole('button', { name: '深色模式' }).click()
  await capture('02-notes-dark')
  const noteSurface = await page.locator('.plan-note').first().evaluate((element) => ({ image: getComputedStyle(element).backgroundImage, before: getComputedStyle(element, '::before').content }))
  assert.equal(noteSurface.image, 'none')
  assert.equal(noteSurface.before, 'none')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1100, 700)
  )
  await geometry('notes-minimum')
  await capture('03-notes-minimum')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000)
  )

  const paperTitles = [
    'Cross-scale Spectral Fusion for Remote Sensing',
    '高光谱图像重建中的结构与光谱先验',
    'Learning to Reconstruct Fine Spatial Details',
    'State Space Models for Spectral Representation',
    'From Observation to Reconstruction',
    '可解释的多尺度特征融合方法',
    'A Study of Robust Research Workflows',
    'Deep Priors for Hyperspectral Imaging',
    'Spatial and Spectral Interactions',
    '面向复杂场景的遥感图像理解',
    'Progressive Image Restoration',
    'Research Notes on Generalization',
    'Efficient Learning with Limited Observations',
    '新的观察与跨域建模：高光谱与多光谱图像融合的一个包含较长标题的界面验证样例'
  ]
  const publications = []
  for (let index = 0; index < paperTitles.length; index++) {
    const source = join(evidence, `fixture-${index}.pdf`)
    makePdf(source, `Publication ${index + 1}: Interface Verification`)
    publications.push(
      unwrap(
        await page.evaluate(
          ({ source, index, title }) =>
            window.workbench.createPublication(source, {
              title,
              authors: 'Lin Researcher, Chen Researcher, Wang Researcher',
              journal: index % 2 ? 'Journal of Research Methods' : 'Remote Sensing Research',
              publishedDate: `${2026 - (index % 3)}-06-15`,
              casPartition: index % 2 ? '2区' : '1区',
              jcrQuartile: 'Q1',
              doi: `10.1234/studio-fixture.${index}`,
              honors: index === 0 ? ['esi-highly-cited', 'best-paper'] : [],
              notes: index === 0 ? '隔离界面验证资料。分区与荣誉仅为测试数据。' : ''
            }),
          { source, index, title: paperTitles[index] }
        )
      )
    )
  }
  await nav('科研成果')
  await page.getByTestId('publication-book').nth(13).waitFor()
  assert.equal(await page.getByTestId('publication-list-row').count(), 14)
  assert.equal(
    await page.getByRole('table', { name: '科研成果列表' }).getByRole('checkbox').count(),
    0
  )
  await page.getByRole('button', { name: '浅色模式' }).click()
  await geometry('shelf-light')
  await capture('04-bookshelf-light')
  await page.locator('.publication-list').scrollIntoViewIfNeeded()
  await capture('04b-publication-list-light')
  await page.locator('.bookcase-heading').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '深色模式' }).click()
  await capture('05-bookshelf-dark')
  const firstBook = page.getByRole('button', { name: `抽出论文 ${paperTitles[0]}`, exact: true })
  await firstBook.focus()
  await page.keyboard.press('Enter')
  await page.getByTestId('publication-detail').waitFor()
  await page.locator('.book-title-page .pdf-cover img').waitFor()
  await page.getByRole('heading', { name: paperTitles[0], exact: true }).waitFor()
  assert.equal(await page.locator('.book-detail-honors .publication-honor-badge').count(), 2)
  assert.match(await page.locator('.book-detail-metadata').innerText(), /10.1234\/studio-fixture.0/)
  await geometry('detail-dark')
  await capture('06-book-detail-dark')
  await page.keyboard.press('Escape')
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  assert.equal(await firstBook.evaluate((e) => e === document.activeElement), true)
  await page.waitForFunction(() => {
    const book = document.activeElement
    return book?.matches('.publication-book') && getComputedStyle(book).transform === 'none'
  })
  await page.getByRole('button', { name: '浅色模式' }).click()
  await firstBook.click()
  await page.locator('.book-title-page .pdf-cover img').waitFor()
  await page.waitForFunction(() => Number(getComputedStyle(document.querySelector('.book-opening-cover')).opacity) === 0)
  const spread = await page.locator('.book-detail').evaluate((element) => {
    const left = element.querySelector('.book-detail-preview').getBoundingClientRect()
    const right = element.querySelector('.book-detail-information').getBoundingClientRect()
    const image = element.querySelector('.book-title-page img').getBoundingClientRect()
    const caption = element.querySelector('.book-detail-preview-caption').getBoundingClientRect()
    return { left: left.width, right: right.width, aligned: Math.abs(left.top - right.top) < 1, imageBottom: image.bottom, captionTop: caption.top }
  })
  assert.ok(Math.abs(spread.left - spread.right) < 2 && spread.aligned, JSON.stringify(spread))
  assert.ok(spread.imageBottom <= spread.captionTop, JSON.stringify(spread))
  await capture('07-book-detail-light')
  await page.getByRole('button', { name: '阅读论文', exact: true }).click()
  await page.locator('.pdf-page .textLayer span').first().waitFor()
  await page.getByRole('button', { name: '返回科研成果', exact: true }).click()
  await firstBook.click()
  await page.getByRole('button', { name: '编辑发表信息', exact: true }).click()
  await page.getByLabel('成果备注', { exact: true }).fill('通过书架详情编辑并持久保存。')
  await page.getByRole('button', { name: '保存成果', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const edited = unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers.find(
    (p) => p.id === publications[0].id
  )
  assert.equal(edited.notes, '通过书架详情编辑并持久保存。')
  assert.deepEqual(edited.honors, ['esi-highly-cited', 'best-paper'])
  pass(
    'Books: real PDF first page, all publication fields and honors, keyboard opening/close/focus restoration, reader and persistent metadata editing'
  )
  await page.getByLabel('搜索科研成果', { exact: true }).fill('studio-fixture.13')
  assert.equal(await page.getByTestId('publication-book').count(), 1)
  assert.equal(await page.getByTestId('publication-list-row').count(), 1)
  await page.getByLabel('搜索科研成果', { exact: true }).fill('no-such-publication')
  assert.equal(await page.getByTestId('publication-book').count(), 0)
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  await page
    .getByRole('navigation', { name: '按发表年份筛选' })
    .getByRole('button', { name: /2025/ })
    .click()
  assert.equal(await page.getByTestId('publication-book').count(), 5)
  await page
    .locator('.output-filter-summary')
    .getByRole('button', { name: '清除筛选', exact: true })
    .click()
  await page.getByLabel('科研成果排序', { exact: true }).selectOption('title')
  const labels = await page
    .getByTestId('publication-book')
    .locator('.book-spine-title')
    .allTextContents()
  assert.deepEqual(
    labels,
    [...labels].sort((a, b) => a.localeCompare(b))
  )
  assert.equal(await page.getByTestId('publication-book').count(), 14)
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setContentSize(1100, 700)
  )
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
  await page.reload()
  await nav('科研成果')
  await page.getByTestId('publication-book').nth(13).waitFor()
  assert.equal(
    await page.evaluate(() => getComputedStyle(document.documentElement).fontSize),
    '18px'
  )
  await geometry('shelf-minimum-large-type')
  await capture('08-bookshelf-minimum')
  await firstBook.click()
  await page.locator('.book-title-page .pdf-cover img').waitFor()
  await geometry('detail-minimum-large-type')
  await capture('09-book-detail-minimum')
  // Focus cannot escape the modal even with a long metadata pane.
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]')),
    true
  )
  await page.getByRole('button', { name: '放回书架', exact: true }).click()
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' })
  await firstBook.click()
  await page.getByTestId('publication-detail').waitFor()
  await capture('10-book-detail-reduced-motion')
  assert.equal(
    await page.getByTestId('publication-detail').evaluate((e) => getComputedStyle(e).transform),
    'none'
  )
  await page.mouse.click(8, 8)
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  pass(
    'Shelf search, empty results, year filter, sorting, minimum window, large type, modal focus trap, reduced motion and backdrop dismissal'
  )
  await app.close()
  app = null
  await launch()
  const reopened = unwrap(await page.evaluate(() => window.workbench.librarySnapshot()))
  assert.equal(reopened.papers.filter((p) => p.collection === 'publication').length, 14)
  assert.equal(
    reopened.papers.find((p) => p.id === publications[0].id).notes,
    '通过书架详情编辑并持久保存。'
  )
  assert.deepEqual(errors, [])
  pass('Restart persistence and zero renderer errors')
} catch (error) {
  if (page) {
    await capture('failure').catch(() => undefined)
    writeFileSync(
      join(evidence, 'failure-dom.txt'),
      await page
        .locator('body')
        .innerText()
        .catch(() => '')
    )
  }
  throw error
} finally {
  if (app) await app.close()
  writeFileSync(
    join(evidence, 'report.json'),
    JSON.stringify(
      { checks, errors, profile, executablePath: executablePath ?? 'development' },
      null,
      2
    )
  )
}
