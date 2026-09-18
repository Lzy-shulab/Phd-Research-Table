import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const directory = resolve(`test-results/current/metadata-live-${executablePath ? 'packaged' : 'development'}`)
mkdirSync(directory, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(directory, `data-${Date.now()}`), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE; delete env.WORKBENCH_DISABLE_METADATA_AUTO
const sourceDirectory = 'D:/Desktop/我的文件/Phd Research Move/LiteratureTranslation/source'
const source = join(sourceDirectory, readdirSync(sourceDirectory).find((name) => name.startsWith('Li_Learning_')))
const app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
const result = { completed: false, errors: [], executablePath: executablePath ?? 'development', source }
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => result.errors.push(error.message))
  await page.locator('.planner-workspace h1').waitFor()
  // Observe outbound URLs without replacing either the transport or response.
  await app.evaluate(({ session }) => {
    globalThis.__liveRequests = []
    session.fromPartition('workbench-research').webRequest.onBeforeRequest((details, callback) => {
      globalThis.__liveRequests.push({ method: details.method, url: details.url }); callback({})
    })
  })
  const imported = await page.evaluate((path) => window.workbench.importPapers([path], null, false), source)
  assert.equal(imported.ok, true)
  await waitForAsync(page, async () => { const snapshot = await window.workbench.librarySnapshot(); return snapshot.ok && snapshot.data.papers[0]?.metadataCheckedAt }, null, 90_000)
  const snapshot = await page.evaluate(() => window.workbench.librarySnapshot())
  result.paper = snapshot.data.papers[0]
  result.requests = await app.evaluate(() => globalThis.__liveRequests)
  assert.ok(result.requests.length > 0)
  assert.ok(result.requests.every((request) => request.method === 'GET' && request.url.startsWith('https://api.crossref.org/works')))
  assert.equal(result.paper.metadataStatus, 'ready', result.paper.metadataMessage)
  assert.match(result.paper.metadataSource, /^Crossref/)
  assert.ok(result.paper.authors && result.paper.journal && result.paper.year && result.paper.doi)
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  await page.locator('.pdf-cover img').waitFor()
  await page.screenshot({ path: join(directory, 'live-metadata-card.png'), animations: 'disabled' })
  assert.deepEqual(result.errors, [])
  result.completed = true
  console.log(JSON.stringify({ completed: true, title: result.paper.title, authors: result.paper.authors, journal: result.paper.journal, year: result.paper.year, doi: result.paper.doi, requests: result.requests }, null, 2))
} finally { await app.close(); writeFileSync(join(directory, 'report.json'), JSON.stringify(result, null, 2)) }
