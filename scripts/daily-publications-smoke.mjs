import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const packaged = process.env.WORKBENCH_TEST_PACKAGED === '1' || Boolean(executablePath)
const directory = resolve(`test-results/current/${packaged ? 'packaged-research' : 'research'}`)
mkdirSync(directory, { recursive: true })
const dataDirectory = join(directory, `data-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', WORKBENCH_DATA_DIR: dataDirectory }
delete env.ELECTRON_RUN_AS_NODE
const sourceDirectory = 'D:/Desktop/我的文件/Phd Research Move/LiteratureTranslation/source'
const sources = readdirSync(sourceDirectory).filter((name) => /\.pdf$/i.test(name) && !/reviewer/i.test(name)).map((name) => join(sourceDirectory, name))
assert.ok(sources.length >= 2)
const originalLengths = sources.map((path) => readFileSync(path).length)
const checks = [], errors = []
const record = (name) => { checks.push(name); console.log('PASS', name) }
let app, page
async function launch() {
  app = await electron.launch(packaged ? { executablePath: resolve(executablePath || 'release/win-unpacked/PhD 科研工作台.exe'), args: executablePath ? ['--seed-demo'] : [], env } : { args: ['.', '--seed-demo'], env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  await page.locator('.planner-workspace h1').waitFor()
}
const snap = async () => { const result = await page.evaluate(() => window.workbench.librarySnapshot()); assert.equal(result.ok, true); return result.data }
const capture = async (name) => {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nav-selection, .dock-selection')).every((selection) => {
    const a = selection.getBoundingClientRect(), b = selection.parentElement.getBoundingClientRect()
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
  }))
  await page.screenshot({ path: join(directory, name), animations: 'disabled', scale: 'css' })
}
try {
  await launch()
  await page.getByRole('button', { name: '浅色模式' }).click()
  const plannerFixtures = await page.evaluate(async () => {
    const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const today = day(new Date()), previous = new Date(), next = new Date()
    previous.setDate(previous.getDate() - 3); next.setDate(next.getDate() + 2)
    const snapshot = await window.workbench.bootstrap()
    const projectId = snapshot.data.projects[0]?.id ?? (await window.workbench.createProject({ name: '独立验收项目', description: '', colorKey: 'blue' })).data.id
    const past = await window.workbench.createTask({ title: '验收：逾期任务', projectId, scheduledDate: day(previous), startTime: '09:17', endTime: '10:43' })
    await window.workbench.createTask({ title: '验收：未来任务', projectId, scheduledDate: day(next) })
    const completed = await window.workbench.createTask({ title: '验收：已完成任务', projectId, scheduledDate: today })
    await window.workbench.completeTask(completed.data.id, true)
    const due = await window.workbench.createTask({ title: '验收：今日截止', projectId })
    await window.workbench.updateTask(due.data.id, { dueDate: today })
    return { past: past.data, completed: completed.data }
  })
  await page.reload(); await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  assert.equal(await page.locator('.task-content').filter({ hasText: '验收：逾期任务' }).count(), 0)
  assert.equal(await page.locator('.task-content').filter({ hasText: '验收：今日截止' }).count(), 1)
  assert.equal(await page.getByTestId('schedule-block').filter({ hasText: '验收：逾期任务' }).count(), 0)
  assert.equal(await page.locator('.task-content').filter({ hasText: '验收：未来任务' }).count(), 0)
  await capture('today-plan-light.png')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  assert.equal(await page.getByRole('checkbox', { name: '恢复 验收：已完成任务', exact: true }).count(), 1)
  assert.equal(await page.locator('.task-content').filter({ hasText: '验收：未来任务' }).count(), 1)
  await page.getByLabel('任务完成状态', { exact: true }).selectOption('completed')
  assert.equal(await page.locator('.task-content').filter({ hasText: '验收：未来任务' }).count(), 0)
  await page.getByLabel('任务完成状态', { exact: true }).selectOption('all')
  await capture('all-tasks-light.png')
  const storedPast = await page.evaluate(async (id) => { const snapshot = await window.workbench.bootstrap(); return snapshot.data.tasks.find((t) => t.id === id) }, plannerFixtures.past.id)
  assert.deepEqual(storedPast, plannerFixtures.past)
  record('Today Plan includes only today; All Tasks retains past, future and completed tasks without changing dates')
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读' }).click()
  await page.getByRole('heading', { name: '文献库', exact: true }).waitFor()
  const navLabels = await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button').allTextContents()
  assert.deepEqual(navLabels.map((text) => text.replace(/\d+$/, '')), ['全部文献', '未分类', 'Arxiv Daily'])
  const imported = await page.evaluate((paths) => window.workbench.importPapers(paths, null, false), sources)
  assert.equal(imported.data.added, sources.length)
  await page.waitForFunction((count) => document.querySelectorAll('.pdf-cover img').length === count, sources.length)
  const material = await page.locator('.paper-card').first().evaluate((element) => ({ background: getComputedStyle(element).backgroundColor, filter: getComputedStyle(element).backdropFilter }))
  assert.match(material.background, /(?:rgba|color\(srgb)/)
  assert.notEqual(material.background, 'rgb(252, 252, 253)')
  const parentFilter = await page.locator('.main-region').evaluate((element) => getComputedStyle(element).backdropFilter)
  assert.match(parentFilter, /blur/)
  await capture('library-glass-light.png')
  record('Independent sidebar order and translucent cards with real PDF covers')

  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /Arxiv Daily/ }).click()
  assert.equal(await page.getByTestId('paper-card').count(), 0)
  await page.getByRole('button', { name: '检索设置', exact: true }).click()
  await page.getByLabel('研究关键词', { exact: true }).fill('hyperspectral image')
  await page.getByLabel('每日下载上限', { exact: true }).fill('2')
  await page.getByRole('button', { name: '保存检索设置' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const day = new Date().toLocaleDateString('en-CA')
  const fixtureIds = ['2609.90001v1', '2609.90002v2']
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>2</opensearch:totalResults>${fixtureIds.map((id) => `<entry><id>http://arxiv.org/abs/${id}</id><title>Hyperspectral Image Research — UI Test ${id}</title><author><name>UI Test Author</name></author><summary>Hyperspectral image reconstruction and classification fixture.</summary><published>${day}T00:00:00Z</published></entry>`).join('')}</feed>`
  await app.evaluate(({ session }, { xml, contents }) => {
    let pdfIndex = 0
    session.fromPartition('workbench-research').fetch = async (url) => {
      if (String(url).startsWith('https://export.arxiv.org/api/query?')) return new Response(xml)
      if (String(url).startsWith('https://arxiv.org/pdf/')) return new Response(new Uint8Array(Buffer.from(contents[pdfIndex++], 'base64')))
      throw Error('Unexpected source: ' + url)
    }
  }, { xml, contents: sources.slice(0, 2).map((path) => readFileSync(path).toString('base64')) })
  await page.getByRole('button', { name: '立即检索', exact: true }).click()
  await waitForAsync(page, async () => { const result = await window.workbench.librarySnapshot(); return result.ok && !result.data.arxiv.running && result.data.arxiv.runs[0]?.status === 'success' }, null, 45_000)
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="paper-card"] .pdf-cover img').length === 2)
  const daily = (await snap()).papers.filter((paper) => paper.collection === 'arxiv')
  assert.equal(daily.length, 2)
  assert.ok(daily.every((paper) => paper.translationStatus === 'idle' && !paper.translatedPath && paper.sourcePath.includes(`Arxiv Daily\\${day}\\`)))
  assert.ok(daily.every((paper) => readFileSync(paper.sourcePath).subarray(0, 1024).includes(Buffer.from('%PDF-'))))
  assert.equal(await page.getByRole('button', { name: '翻译', exact: true }).count(), 2)
  await capture('arxiv-daily-light.png')
  await page.getByRole('button', { name: '立即检索', exact: true }).click()
  await waitForAsync(page, async () => { const result = await window.workbench.librarySnapshot(); return result.ok && !result.data.arxiv.running && result.data.arxiv.runs[0]?.message.includes('上限') })
  assert.equal((await snap()).papers.filter((paper) => paper.collection === 'arxiv').length, 2)
  record('Mocked arXiv endpoint delivers real PDFs into dated folders; manual-only translation and daily cap hold')
  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /全部文献/ }).click()
  assert.equal(await page.getByTestId('paper-card').count(), sources.length)
  assert.equal(await page.getByText('Hyperspectral Image Research', { exact: false }).count(), 0)
  record('Arxiv Daily documents stay out of All Literature and Unfiled')

  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '科研成果' }).click()
  await page.getByRole('heading', { name: '科研成果', exact: true }).waitFor()
  await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, sources[0])
  await page.getByRole('button', { name: '添加成果', exact: true }).click()
  await page.getByRole('button', { name: '选择 PDF', exact: true }).click()
  await page.getByLabel('成果标题', { exact: true }).fill('科研成果验收示例：高光谱图像融合与重建方法')
  await page.getByLabel('作者', { exact: true }).fill('验收作者 A, 验收作者 B')
  await page.getByLabel('期刊 / 会议', { exact: true }).fill('验收期刊 · Hyperspectral Imaging')
  await page.getByLabel('发表时间', { exact: true }).fill('2026-08-15')
  await page.getByLabel('期刊分区', { exact: true }).selectOption('1区')
  await page.getByLabel('JCR 分区', { exact: true }).selectOption('Q1')
  await page.getByRole('button', { name: 'ESI 高被引论文', exact: true }).click()
  await page.getByRole('button', { name: 'ESI 热点论文', exact: true }).click()
  await page.getByLabel('DOI', { exact: true }).fill('https://doi.org/10.1234/ui-test')
  await page.getByLabel('成果备注', { exact: true }).fill('隔离验收示例，期刊与分区均为测试字段，不是正式成果。')
  await capture('publication-form-light.png')
  await page.getByRole('button', { name: '保存成果', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByTestId('publication-book').click()
  await page.locator('.book-title-page .pdf-cover img').waitFor()
  let publication = (await snap()).papers.find((paper) => paper.collection === 'publication')
  assert.ok(publication)
  assert.equal(publication.doi, '10.1234/ui-test')
  assert.deepEqual(publication.honors, ['esi-highly-cited', 'esi-hot'])
  assert.equal(publication.translationStatus, 'idle')
  assert.equal(await page.locator('.publication-honor-badge[data-honor="esi-highly-cited"]').count(), 1)
  assert.equal(await page.locator('.publication-honor-badge[data-honor="esi-hot"]').count(), 1)
  await capture('publications-light.png')
  await page.getByRole('button', { name: '放回书架', exact: true }).click()
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  await page.getByRole('navigation', { name: '按发表年份筛选' }).getByRole('button', { name: /2026/ }).click()
  assert.equal(await page.getByTestId('publication-book').count(), 1)
  await page.getByTestId('publication-book').click()
  await page.getByRole('button', { name: '阅读论文', exact: true }).click()
  await page.locator('.pdf-page .textLayer span').first().waitFor()
  await capture('publication-reader.png')
  await page.getByRole('button', { name: '返回科研成果', exact: true }).click()
  record('Publication upload, DOI normalization, partitions, year filter and real PDF reading pass')

  await page.getByRole('button', { name: /抽出论文 科研成果验收示例/ }).click()
  await page.getByRole('button', { name: '编辑发表信息', exact: true }).click()
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  await page.getByLabel('发表时间', { exact: true }).fill('2025-12-20')
  await page.getByRole('button', { name: '保存成果', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('navigation', { name: '成果范围' }).getByRole('button', { name: /全部成果/ }).click()
  publication = (await snap()).papers.find((paper) => paper.collection === 'publication')
  assert.equal(publication.year, '2025')
  await page.getByRole('button', { name: '深色模式' }).click()
  await capture('publications-dark.png')
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setSize(1100, 700) })
  await capture('publications-minimum-dark.png')
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  assert.equal(overflow, false)
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读' }).click()
  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /Arxiv Daily/ }).click()
  await page.locator('.paper-card .pdf-cover img').first().waitFor()
  await capture('arxiv-minimum-dark.png')
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' })
  assert.equal(await page.locator('.paper-card').first().evaluate((element) => getComputedStyle(element).backdropFilter), 'none')
  await capture('arxiv-high-contrast.png')
  await page.emulateMedia({ reducedMotion: 'no-preference', contrast: 'no-preference' })
  record('Metadata edits and year indexing persist; minimum-size dark layouts have no document overflow')
  await app.close(); app = null
  await launch()
  const reopened = await snap()
  assert.equal(reopened.papers.filter((paper) => paper.collection === 'arxiv').length, 2)
  assert.equal(reopened.papers.find((paper) => paper.collection === 'publication').publishedDate, '2025-12-20')
  assert.deepEqual(reopened.papers.find((paper) => paper.collection === 'publication').honors, ['esi-highly-cited', 'esi-hot'])
  assert.equal(reopened.arxiv.settings.maxPerDay, 2)
  assert.deepEqual(sources.map((path) => readFileSync(path).length), originalLengths)
  assert.deepEqual(errors, [])
  record('Restart preserves collection isolation, publication metadata and daily settings; original files unchanged')
} catch (error) {
  if (page) {
    await capture('failure.png').catch(() => undefined)
    writeFileSync(join(directory, 'failure-dom.txt'), await page.locator('body').innerText().catch(() => ''))
    console.log(await page.locator('label').allTextContents())
  }
  throw error
} finally {
  if (app) await app.close()
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ checks, errors, packaged, dataDirectory, mocked: ['OS file picker', 'arXiv search and download responses'], real: ['source PDFs', 'SQLite', 'managed file writes', 'PDF.js rendering'] }, null, 2))
}
