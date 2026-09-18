import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const directory = resolve(`test-results/current/arxiv-live-${executablePath ? 'packaged' : 'development'}`)
mkdirSync(directory, { recursive: true })
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', WORKBENCH_DATA_DIR: join(directory, `data-${Date.now()}`) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
const result = { completed: false, errors: [], dataDirectory: env.WORKBENCH_DATA_DIR }
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => result.errors.push(error.message))
  await page.locator('.planner-workspace h1').waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读' }).click()
  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /Arxiv Daily/ }).click()
  const configured = await page.evaluate(() => window.workbench.saveArxivSettings({ enabled: false, daysBack: 14, maxPerDay: 1, directions: ['hyperspectral image'] }))
  assert.equal(configured.ok, true)
  await page.getByRole('button', { name: '立即检索', exact: true }).click()
  await waitForAsync(page, async () => { const snapshot = await window.workbench.librarySnapshot(); return snapshot.ok && snapshot.data.arxiv.runs.length > 0 && !snapshot.data.arxiv.running }, null, 255_000)
  const snapshot = await page.evaluate(() => window.workbench.librarySnapshot())
  assert.equal(snapshot.ok, true)
  result.run = snapshot.data.arxiv.runs[0]
  result.papers = snapshot.data.papers
  if (result.papers.length) {
    const paper = result.papers[0]
    assert.equal(paper.collection, 'arxiv'); assert.equal(paper.translationStatus, 'idle')
    assert.ok(readFileSync(paper.sourcePath).subarray(0, 1024).includes(Buffer.from('%PDF-')))
    await page.locator('.paper-card .pdf-cover img').first().waitFor({ timeout: 45_000 })
    await page.getByRole('button', { name: '原文', exact: true }).click()
    await page.locator('.pdf-page .textLayer span').first().waitFor({ timeout: 45_000 })
    await page.screenshot({ path: join(directory, 'downloaded-pdf-reader.png'), animations: 'disabled' })
    result.completed = true
  } else {
    await page.screenshot({ path: join(directory, 'live-status.png'), animations: 'disabled' })
  }
  console.log(JSON.stringify({ completed: result.completed, run: result.run, papers: result.papers.map((p) => ({ title: p.title, arxivId: p.arxivId, publishedDate: p.publishedDate })) }, null, 2))
} finally {
  await app.close()
  writeFileSync(join(directory, 'report.json'), JSON.stringify(result, null, 2))
}
