import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const resultDir = resolve('test-results/current/live')
mkdirSync(resultDir, { recursive: true })
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: resolve(resultDir, `data-${Date.now()}`) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
const errors = [], checks = []
const record = (name) => { checks.push(name); console.log('PASS', name) }
let page
try {
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (msg) => { if (msg.type() === 'error') console.log('CONSOLE', msg.text().slice(0, 400)) })
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.getByRole('button', { name: '浅色模式' }).click()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读' }).click()
  await page.getByRole('heading', { name: '文献库', exact: true }).waitFor()
  await page.screenshot({ path: resolve(resultDir, 'library-empty.png') })
  record('Real Electron literature workspace opens')
  const result = await page.evaluate(async (path) => {
    const folder = await window.workbench.createFolder({ name: '翻译验收样例', parentId: null })
    if (!folder.ok) throw Error(folder.error.message)
    const imported = await window.workbench.importPapers([path], folder.data.id, true)
    return { imported, health: await window.workbench.translationHealth() }
  }, resolve('tests/fixtures/translation-check.pdf'))
  console.log(JSON.stringify(result))
  assert.equal(result.imported.ok, true)
  assert.equal(result.imported.data.added, 1)
  await page.waitForFunction(() => document.querySelector('.pdf-cover img')?.complete, { timeout: 30_000 })
  record('Real PDF imported, first-page cover rendered, translation queued')
  await page.getByRole('button', { name: '原文', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.textLayer')?.textContent?.includes('Research'))
  await page.screenshot({ path: resolve(resultDir, 'reader-source.png') })
  record('PDF source renders selectable English text')
  await page.getByRole('button', { name: '返回文献库', exact: true }).click()
  const deadline = Date.now() + 10 * 60_000
  while (Date.now() < deadline) {
    const ready = await page.evaluate(async () => {
      const result = await window.workbench.librarySnapshot()
      return result.ok && result.data.papers.some((p) => ['ready', 'failed'].includes(p.translationStatus))
    })
    if (ready) break
    await delay(1500)
  }
  const snapshot = await page.evaluate(() => window.workbench.librarySnapshot())
  writeFileSync(resolve(resultDir, 'live-result.json'), JSON.stringify({ snapshot, checks, errors }, null, 2))
  assert.equal(snapshot.ok, true)
  const paper = snapshot.data.papers[0]
  console.log('TRANSLATION', paper.translationStatus, paper.translationError, paper.translatedPath)
  assert.equal(paper.translationStatus, 'ready', paper.translationError)
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  await page.waitForFunction(() => /[\u4e00-\u9fff]/.test(document.querySelector('.textLayer')?.textContent ?? ''))
  const dimensions = await page.locator('.pdf-page canvas').evaluate((canvas) => ({ width: canvas.width, height: canvas.height }))
  assert.ok(dimensions.width > dimensions.height, 'Real bilingual PDF is landscape with English and Chinese side by side')
  await page.screenshot({ path: resolve(resultDir, 'reader-bilingual.png') })
  record('Live installed PDF2zh output auto-attached; English and Chinese text rendered in landscape PDF')
  assert.deepEqual(errors, [])
  writeFileSync(resolve(resultDir, 'live-result.json'), JSON.stringify({ snapshot, checks, dimensions, errors }, null, 2))
} catch (error) {
  await page?.screenshot({ path: resolve(resultDir, 'failure.png') }).catch(() => {})
  console.error(error)
  process.exitCode = 1
} finally { await app.close() }
