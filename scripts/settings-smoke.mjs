import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join, dirname } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const directory = resolve(`test-results/current/settings-${executablePath ? 'packaged' : 'development'}`)
mkdirSync(directory, { recursive: true })
const dataDirectory = join(directory, `data-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', WORKBENCH_DATA_DIR: dataDirectory }
delete env.ELECTRON_RUN_AS_NODE
const sourceDirectory = 'D:/Desktop/我的文件/Phd Research Move/LiteratureTranslation/source'
const sources = readdirSync(sourceDirectory).filter((name) => /\.pdf$/i.test(name) && !/reviewer/i.test(name)).slice(0, 2).map((name) => join(sourceDirectory, name))
assert.equal(sources.length, 2)
const checks = [], errors = []
const record = (name) => { checks.push(name); console.log('PASS', name) }
let app, page
async function launch() {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const snapshot = async () => unwrap(await page.evaluate(() => window.workbench.librarySnapshot()))
const storage = async () => unwrap(await page.evaluate(() => window.workbench.storageSnapshot()))
const pick = async (path) => app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: !path, filePaths: path ? [path] : [] }) }, path)
const settings = async () => { await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '设置', exact: true }).click(); await page.getByRole('heading', { name: '保存位置' }).waitFor() }
const capture = async (name) => {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.dock-selection')).every((selection) => {
    const a = selection.getBoundingClientRect(), b = selection.parentElement.getBoundingClientRect()
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
  }))
  await page.screenshot({ path: join(directory, name), animations: 'disabled', scale: 'css' })
}
try {
  await launch()
  const originalPaths = (await storage()).directories
  unwrap(await page.evaluate((paths) => window.workbench.importPapers(paths, null, false), [sources[0]]))
  const oldPaper = (await snapshot()).papers[0]
  await settings()
  assert.deepEqual(await page.locator('.dock-item').allTextContents(), ['研究计划', '文献阅读', '科研成果', '论文投稿', '设置'])
  const targets = { library: join(dataDirectory, '文献资料', '高光谱成像与多模态遥感研究', '阅读中的论文与长期归档资料'), publication: join(dataDirectory, '成果 PDF'), arxiv: join(dataDirectory, '每日文献') }
  for (const [kind, label] of [['library', '文献 PDF'], ['publication', '科研成果 PDF'], ['arxiv', 'Arxiv Daily']]) {
    mkdirSync(targets[kind], { recursive: true }); await pick(targets[kind])
    await page.getByRole('button', { name: `更改${label}保存位置`, exact: true }).click()
    await page.getByText(`${label}保存位置已更新，新文件将保存到此处。`, { exact: true }).waitFor()
    assert.equal((await storage()).directories[kind], targets[kind])
  }
  assert.equal((await snapshot()).arxiv.directory, targets.arxiv)
  record('Settings follows Research Outputs in the dock; all three paths update through typed IPC and the native picker boundary')
  await pick(null)
  await page.getByRole('button', { name: '更改文献 PDF保存位置', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="storage-library"] button').disabled)
  assert.deepEqual((await storage()).directories, targets)
  await pick(sources[0])
  await page.getByRole('button', { name: '更改文献 PDF保存位置', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '原设置已保留' }).waitFor()
  assert.deepEqual((await storage()).directories, targets)
  await app.evaluate(({ shell }) => { shell.openPath = async (path) => { globalThis.__settingsOpenedPath = path; return '' } })
  await page.getByRole('button', { name: '打开Arxiv Daily文件夹', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('[data-testid="storage-arxiv"] button').disabled)
  assert.equal(await app.evaluate(() => globalThis.__settingsOpenedPath), targets.arxiv)
  record('Cancelled and invalid selections preserve saved paths; Open sends the configured directory to the OS shell')
  unwrap(await page.evaluate((paths) => window.workbench.importPapers(paths, null, false), [sources[1]]))
  const added = (await snapshot()).papers.find((paper) => paper.id !== oldPaper.id)
  assert.equal(dirname(dirname(added.sourcePath)), targets.library)
  const publication = unwrap(await page.evaluate((path) => window.workbench.createPublication(path, {
    title: '保存目录验收论文', authors: '测试作者', journal: '测试期刊', publishedDate: '2026-09-08', doi: '', casPartition: '', jcrQuartile: '', notes: ''
  }), sources[0]))
  assert.equal(dirname(dirname(publication.sourcePath)), targets.publication)
  await app.evaluate(({ session }, pdf) => {
    session.fromPartition('workbench-research').fetch = async (url) => String(url).includes('/api/')
      ? new Response(`<feed><entry><id>https://arxiv.org/abs/2609.12345v1</id><title>Hyperspectral settings fixture</title><published>2026-09-08T00:00:00Z</published></entry></feed>`)
      : new Response(new Uint8Array(Buffer.from(pdf, 'base64')))
  }, readFileSync(sources[0]).toString('base64'))
  unwrap(await page.evaluate(() => window.workbench.saveArxivSettings({ enabled: false, daysBack: 14, maxPerDay: 1, directions: ['hyperspectral'] })))
  unwrap(await page.evaluate(() => window.workbench.runArxivDaily()))
  await waitForAsync(page, async () => { const r = await window.workbench.librarySnapshot(); return r.ok && !r.data.arxiv.running && r.data.arxiv.runs[0]?.status === 'success' }, null, 20_000)
  const daily = (await snapshot()).papers.find((paper) => paper.collection === 'arxiv')
  assert.equal(daily.sourcePath, join(targets.arxiv, daily.collectedDate, daily.id, 'source.pdf'))
  const exported = join(dataDirectory, 'export-old.pdf')
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }) }, exported)
  assert.equal(unwrap(await page.evaluate((id) => window.workbench.exportPaper(id, 'source'), oldPaper.id)), true)
  assert.deepEqual(readFileSync(exported), readFileSync(sources[0]))
  assert.equal((await snapshot()).papers.find((paper) => paper.id === oldPaper.id).sourcePath, oldPaper.sourcePath)
  for (const paper of [oldPaper, added, publication, daily]) assert.ok(unwrap(await page.evaluate((id) => window.workbench.readPaper(id, 'source'), paper.id)))
  record('Real PDFs save in the three new locations; existing PDF paths and byte-identical export remain intact')
  await page.getByRole('button', { name: '浅色模式' }).click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 1000))
  await capture('settings-light.png')
  await page.getByRole('button', { name: '深色模式' }).click()
  await capture('settings-dark.png')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 700))
  await capture('settings-minimum-dark.png')
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  assert.equal(await page.locator('.settings-workspace').evaluate((element) => element.scrollWidth > element.clientWidth), false)
  for (const button of await page.locator('.storage-actions .button').all()) {
    const bounds = await button.boundingBox(); assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 1100)
  }
  await page.emulateMedia({ reducedMotion: 'reduce', contrast: 'more' })
  await capture('settings-high-contrast.png')
  record('Light, dark, long paths, minimum-size layout and increased contrast render without horizontal overflow')
  await app.close(); app = null
  await launch()
  assert.deepEqual((await storage()).directories, targets)
  assert.equal((await storage()).databasePath, join(dataDirectory, 'workbench.sqlite'))
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  await page.locator('.paper-card .pdf-cover img').first().waitFor()
  assert.equal(await page.locator('.paper-card .pdf-cover img').count(), 2)
  for (const paper of [oldPaper, added]) assert.ok(unwrap(await page.evaluate((id) => window.workbench.readPaper(id, 'source'), paper.id)))
  await settings()
  await page.getByLabel('文献 PDF保存地址', { exact: true }).filter({ hasText: targets.library }).waitFor()
  record('Restart preserves all selected locations and renders both old and new PDF covers')
  assert.deepEqual(errors, [])
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ checks, errors, dataDirectory, originalPaths, targets, executablePath: executablePath ?? 'development', boundary: 'OS picker and shell are stubbed; arXiv responses are stubbed with real PDF bytes. No live network or translation claim.' }, null, 2))
  console.log(`ALL ${checks.length} SETTINGS CHECKS PASSED`)
} finally { if (app) await app.close() }
