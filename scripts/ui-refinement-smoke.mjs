import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/ui-refinement-0.8.5', executablePath ? 'packaged' : 'development')
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
const errors = []
const checks = []
const app = await electron.launch(executablePath
  ? { executablePath: resolve(executablePath), args: [], env }
  : { args: ['.'], env })

const page = await app.firstWindow()
page.on('pageerror', (error) => errors.push(error.message))
const pass = (name) => { checks.push(name); console.log('PASS', name) }
const screenshot = (name) => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
const navModule = (name) => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()

try {
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 900)
    win.webContents.setBackgroundThrottling(false)
    win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.evaluate(async () => {
    const unwrap = (result) => { if (!result.ok) throw Error(result.error.message); return result.data }
    const active = unwrap(await window.workbench.createProject({ name: '界面修复验收', description: '', colorKey: 'blue' }))
    unwrap(await window.workbench.createProject({ name: '不应显示的空项目', description: '', colorKey: 'sage' }))
    unwrap(await window.workbench.createTask({ title: '检查五项界面修复', projectId: active.id }))
    unwrap(await window.workbench.createPublication(null, { title: 'Hyperspectral Image Fusion for Research Workflows', authors: 'Test Author', journal: 'Remote Sensing Research', publishedDate: '2026-08-15', doi: '', casPartition: '1区', jcrQuartile: 'Q1', honors: [], notes: '' }))
    unwrap(await window.workbench.createPublication(null, { title: 'State Space Models for Spectral Reconstruction', authors: 'Test Author', journal: 'Journal of Imaging', publishedDate: '2025', doi: '', casPartition: '2区', jcrQuartile: 'Q2', honors: [], notes: '' }))
    unwrap(await window.workbench.saveArxivSettings({ enabled: false, daysBack: 14, maxPerDay: 3, directions: ['hyperspectral image'], excludedKeywords: [] }))
  })
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  assert.equal(await page.locator('.today-other-projects').count(), 0)
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await page.getByRole('region', { name: '日期导航' }).waitFor()
  await page.getByRole('group', { name: '任务显示方式' }).getByRole('button', { name: '项目卡片' }).click()
  assert.equal(await page.locator('.plan-note').count(), 1)
  assert.equal(await page.locator('.plan-note-board').getByText('不应显示的空项目', { exact: true }).count(), 0)
  assert.equal(await page.locator('.empty-projects').count(), 0)
  await page.locator('.task-content').filter({ hasText: '检查五项界面修复' }).click()
  const inspector = page.getByRole('complementary', { name: '任务详情' })
  await inspector.waitFor()
  for (const text of ['备注与更多', '更多信息', '添加备注', '添加子任务']) assert.equal(await inspector.getByText(text, { exact: true }).count(), 0)
  await screenshot('01-planner-light')
  pass('All Tasks keeps the calendar, hides empty projects, and shows the simplified task inspector')

  await navModule('文献阅读')
  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /Arxiv Daily/ }).click()
  const abstract = 'This paper studies hyperspectral image fusion with a structured state space model. '.repeat(7)
  const day = new Date().toLocaleDateString('en-CA')
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:opensearch="http://a9.com/-/spec/opensearch/1.1/"><opensearch:totalResults>2</opensearch:totalResults><entry><id>http://arxiv.org/abs/2609.91001v1</id><title>Structured Hyperspectral Image Fusion</title><author><name>UI Test Author</name></author><summary>${abstract}</summary><published>${day}T00:00:00Z</published></entry><entry><id>http://arxiv.org/abs/2609.91002v1</id><title>Efficient Hyperspectral Image Reconstruction</title><author><name>Second Test Author</name></author><summary>${abstract}</summary><published>${day}T00:00:00Z</published></entry></feed>`
  await app.evaluate(({ session }, { source, pdf }) => {
    session.fromPartition('workbench-research').fetch = async (url) => {
      if (String(url).startsWith('https://export.arxiv.org/api/query?')) return new Response(source)
      if (String(url).startsWith('https://arxiv.org/pdf/')) return new Response(Buffer.from(pdf, 'base64'), { headers: { 'Content-Type': 'application/pdf' } })
      throw Error(`Unexpected source: ${url}`)
    }
  }, { source: xml, pdf: readFileSync(resolve('tests/fixtures/translation-check.pdf')).toString('base64') })
  await page.getByRole('button', { name: '立即检索', exact: true }).click()
  await waitForAsync(page, async () => {
    const result = await window.workbench.librarySnapshot()
    return result.ok && !result.data.arxiv.running && result.data.arxiv.candidates.length === 2
  }, null, 45_000)
  const candidates = page.locator('.arxiv-candidate-list > article')
  assert.equal(await candidates.count(), 2)
  assert.equal(await candidates.first().locator('.arxiv-candidate-number').innerText(), '01')
  assert.equal(await candidates.first().getByRole('button', { name: '展开摘要', exact: true }).getAttribute('aria-expanded'), 'false')
  await candidates.first().getByRole('button', { name: '展开摘要', exact: true }).click()
  assert.equal(await candidates.first().getByRole('button', { name: '收起摘要', exact: true }).getAttribute('aria-expanded'), 'true')
  assert.equal(await candidates.first().locator('.arxiv-candidate-actions .button').count(), 2)
  assert.equal(await candidates.first().getByRole('button', { name: /下载 PDF/ }).count(), 0)
  await candidates.first().getByRole('button', { name: '收藏', exact: true }).click()
  await waitForAsync(page, async () => {
    const result = await window.workbench.librarySnapshot()
    return result.ok && result.data.arxiv.candidates.length === 1 && result.data.papers.some((paper) => paper.arxivFavorite)
  })
  await page.locator('.library-scroll').evaluate((element) => { element.scrollTop = 0 })
  await screenshot('02-arxiv-candidates-light')
  await candidates.first().getByRole('button', { name: '忽略', exact: true }).click()
  await candidates.first().waitFor({ state: 'detached' })
  pass('arXiv candidates expose only favorite and ignore; favorite downloads the PDF automatically')

  await navModule('科研成果')
  await page.getByTestId('publication-book').nth(1).waitFor()
  assert.equal(await page.getByRole('group', { name: '成果显示方式' }).count(), 0)
  const table = page.getByRole('table', { name: '科研成果列表' })
  assert.deepEqual(await table.getByRole('columnheader').allTextContents(), ['序号', '论文名称', '期刊等级', '发表年份'])
  assert.equal(await page.getByTestId('publication-list-row').count(), 2)
  assert.equal(await page.getByTestId('publication-list-row').first().locator('.publication-list-index').innerText(), '01')
  assert.match(await table.innerText(), /1区 · Q1/)
  assert.match(await table.innerText(), /2026/)
  await page.locator('.publication-list').scrollIntoViewIfNeeded()
  await screenshot('03-publication-index-light')
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await screenshot('04-publication-index-dark')
  pass('The publication shelf and four-column index are visible together in light and dark themes')

  const geometry = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth }))
  assert.ok(geometry.document <= geometry.viewport + 1, JSON.stringify(geometry))
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ checks, errors, geometry, dataDirectory: profile, executablePath: executablePath ? resolve(executablePath) : 'development' }, null, 2))
  console.log('PASS UI refinement smoke', evidence)
} finally {
  await app.close()
}
