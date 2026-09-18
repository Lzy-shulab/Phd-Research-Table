import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const live = process.env.WORKBENCH_PUBLICATION_LIVE === '1'
const directory = resolve(`test-results/current/publication-${live ? 'live-' : ''}${executablePath ? 'packaged' : 'development'}`)
mkdirSync(directory, { recursive: true })
const dataDirectory = join(directory, `data-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DATA_DIR: dataDirectory, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.WORKBENCH_DISABLE_METADATA_AUTO
const sourceDirectory = 'D:/Desktop/我的文件/Phd Research Move/LiteratureTranslation/source'
const source = join(sourceDirectory, readdirSync(sourceDirectory).find((name) => name.startsWith('Li_Learning_')))
const originalBytes = readFileSync(source)
const expectedTitle = 'Learning without Exact Guidance: Updating Large-Scale High-Resolution Land Cover Maps from Low-Resolution Historical Labels'
const checks = [], errors = []
const record = (name) => { checks.push(name); console.log('PASS', name) }
const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
let app, page
async function launch() {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '科研成果', exact: true }).click()
  await page.getByRole('heading', { name: '科研成果', exact: true }).waitFor()
}
const dialog = () => page.getByRole('dialog')
const snapshot = async () => unwrap(await page.evaluate(() => window.workbench.librarySnapshot()))
const completed = () => page.getByRole('button', { name: '保存成果', exact: true }).waitFor({ timeout: 90_000 })
async function choose() {
  await app.evaluate(({ dialog }, source) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [source] }) }, source)
  await dialog().getByRole('button', { name: '选择 PDF', exact: true }).click()
}
const screenshot = async (name) => page.screenshot({ path: join(directory, name), animations: 'disabled', scale: 'css' })
try {
  await launch()
  if (!live) await app.evaluate(({ session }, expectedTitle) => {
    globalThis.__publicationRequests = []
    globalThis.__publicationDelay = 0
    session.fromPartition('workbench-research').fetch = async (url, init) => {
      globalThis.__publicationRequests.push({ url: String(url), method: init?.method ?? 'GET' })
      if (globalThis.__publicationDelay) await new Promise((resolve) => setTimeout(resolve, globalThis.__publicationDelay))
      const publication = { title: [expectedTitle], DOI: '10.1109/cvpr52733.2024.02618', author: [{ given: 'Zhuohong', family: 'Li' }, { given: 'Wei', family: 'He' }], 'container-title': ['CVPR 2024 · 书目接口验收'], published: { 'date-parts': [[2024]] } }
      return new Response(JSON.stringify({ message: String(url).includes('works?') ? { items: [publication] } : publication }), { headers: { 'Content-Type': 'application/json' } })
    }
  }, expectedTitle)
  else await app.evaluate(({ session }) => {
    globalThis.__publicationRequests = []
    session.fromPartition('workbench-research').webRequest.onBeforeRequest((details, callback) => {
      globalThis.__publicationRequests.push({ url: details.url, method: details.method }); callback({})
    })
  })
  await page.getByRole('button', { name: '添加成果', exact: true }).click()
  await choose()
  await completed()
  assert.match(await dialog().getByLabel('成果标题', { exact: true }).inputValue(), /Learning without Exact Guidance/)
  const authors = await dialog().getByLabel('作者', { exact: true }).inputValue()
  assert.match(authors, /Zhuohong Li/)
  assert.match(await dialog().getByLabel('期刊 / 会议', { exact: true }).inputValue(), /CVPR/)
  assert.equal(await dialog().getByLabel('DOI', { exact: true }).inputValue(), '10.1109/cvpr52733.2024.02618')
  const date = await dialog().getByLabel('发表时间', { exact: true }).inputValue()
  assert.ok(date.startsWith('2024'))
  if (!live) { assert.equal(date, '2024'); assert.equal(await dialog().getByLabel('发表时间精度').inputValue(), 'year') }
  assert.equal((await snapshot()).papers.length, 0)
  await screenshot('recognized-before-save.png')
  record('Selecting a real PDF automatically fills title, authors, journal, DOI and publication time before creating any library record')
  if (!live) {
    // A DOI lookup uses a different URL from the cached title lookup, allowing an in-flight edit check.
    await app.evaluate(() => { globalThis.__publicationDelay = 2500 })
    await dialog().getByLabel('DOI', { exact: true }).fill('https://doi.org/10.1109/cvpr52733.2024.02618')
    await dialog().getByRole('button', { name: '重新识别', exact: true }).click()
    await dialog().getByText('正在联网补全发表信息…', { exact: true }).waitFor()
    await dialog().getByLabel('作者', { exact: true }).fill('手动校正作者')
    await dialog().getByLabel('期刊 / 会议', { exact: true }).fill('')
    await dialog().getByLabel('成果备注').fill('保留作者贡献和分区年份备注')
    await completed()
    assert.equal(await dialog().getByLabel('作者', { exact: true }).inputValue(), '手动校正作者')
    assert.equal(await dialog().getByLabel('期刊 / 会议', { exact: true }).inputValue(), '')
    await dialog().getByLabel('期刊 / 会议', { exact: true }).fill('用户核对的会议')
    await dialog().getByLabel('期刊分区').selectOption('1区')
    await dialog().getByLabel('发表时间', { exact: true }).fill('')
    await dialog().getByLabel('发表时间', { exact: true }).pressSequentially('2024')
    assert.equal(await dialog().getByLabel('发表时间', { exact: true }).getAttribute('type'), 'text')
    assert.equal(await dialog().getByLabel('发表时间', { exact: true }).inputValue(), '2024')
    record('Edits made during lookup, deliberately blank fields, notes and year-only precision are protected')
  }
  await dialog().getByRole('button', { name: '保存成果', exact: true }).click()
  await dialog().waitFor({ state: 'hidden' })
  await page.getByTestId('publication-book').click()
  await page.locator('.book-title-page .pdf-cover img').waitFor()
  await page.getByRole('button', { name: '放回书架', exact: true }).click()
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  const saved = (await snapshot()).papers[0]
  assert.equal(saved.collection, 'publication'); assert.equal(saved.year, '2024')
  assert.equal(saved.publishedDate, date)
  assert.deepEqual(readFileSync(saved.sourcePath), originalBytes)
  assert.equal(saved.doi, '10.1109/cvpr52733.2024.02618')
  await page.getByRole('navigation', { name: '按发表年份筛选' }).getByRole('button', { name: /^2024/ }).click()
  assert.equal(await page.getByTestId('publication-book').count(), 1)
  await screenshot('saved-output-card.png')
  record('Saving creates one publication with the exact PDF bytes, persisted metadata and a working year filter')
  const requests = await app.evaluate(() => globalThis.__publicationRequests)
  assert.ok(requests.length > 0 && requests.every((request) => request.method === 'GET' && request.url.startsWith('https://api.crossref.org/works')))
  if (!live) {
    unwrap(await page.evaluate(() => window.workbench.setMetadataOnline(false)))
    await page.getByRole('button', { name: '添加成果', exact: true }).click()
    await choose(); await completed()
    await dialog().getByText('已按设置仅读取 PDF，未联网补全。', { exact: true }).waitFor()
    assert.deepEqual(await app.evaluate(() => globalThis.__publicationRequests), requests)
    await dialog().getByRole('button', { name: '取消', exact: true }).click()
    assert.equal((await snapshot()).papers.length, 1)
    assert.deepEqual(readFileSync(source), originalBytes)
    record('Offline selection reads PDF only; cancelling leaves no new publication and never changes the original file')
  }
  await app.close(); app = null
  await launch()
  assert.deepEqual((await snapshot()).papers[0], saved)
  await page.getByRole('button', { name: `抽出论文 ${saved.title}`, exact: true }).click()
  await page.getByRole('button', { name: '编辑发表信息', exact: true }).click()
  await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  assert.equal(await dialog().getByLabel('发表时间', { exact: true }).inputValue(), date)
  if (!live) {
    assert.equal(await dialog().getByLabel('作者', { exact: true }).inputValue(), '手动校正作者')
    assert.equal(await dialog().getByLabel('成果备注').inputValue(), '保留作者贡献和分区年份备注')
    await dialog().getByLabel('发表时间精度').selectOption('month')
    await dialog().getByLabel('发表时间', { exact: true }).fill('2024-06')
    await dialog().getByRole('button', { name: '保存成果', exact: true }).click()
    await dialog().waitFor({ state: 'hidden' })
    assert.equal((await snapshot()).papers[0].publishedDate, '2024-06')
    await page.getByRole('button', { name: `抽出论文 ${saved.title}`, exact: true }).click()
    await page.getByRole('button', { name: '编辑发表信息', exact: true }).click()
    await page.getByTestId('publication-detail').waitFor({ state: 'hidden' })
  }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700))
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' })
  await screenshot('dialog-minimum-dark.png')
  assert.equal(await dialog().evaluate((item) => item.scrollWidth > item.clientWidth), false)
  await dialog().getByRole('button', { name: '取消', exact: true }).scrollIntoViewIfNeeded()
  await screenshot('dialog-minimum-dark-bottom.png')
  record('Restart preserves publication data; editing supports month precision and the minimum-size dialog scrolls without horizontal overflow')
  assert.deepEqual(errors, [])
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ checks, errors, live, executablePath: executablePath ?? 'development', dataDirectory, requests, saved, boundary: 'Real PDF parsing and rendering. Native file picker is stubbed. Network response is live only when live=true; otherwise controlled bibliography fixtures are used.' }, null, 2))
  console.log(`ALL ${checks.length} PUBLICATION METADATA CHECKS PASSED`)
} finally { if (app) await app.close() }
