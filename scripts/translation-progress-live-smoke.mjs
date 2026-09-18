import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

const evidence = resolve('验收记录/界面与翻译升级/live-translation', process.env.WORKBENCH_TEST_EXECUTABLE ? 'packaged' : 'development')
mkdirSync(evidence, { recursive: true })
const root = realpathSync(tmpdir()), profile = mkdtempSync(join(root, 'workbench-progress-live-'))
const source = resolve('tests/fixtures/translation-check.pdf')
const template = 'D:/Python/zotero-pdf2zh/server/config/config.toml.example'
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
const originalHash = hash(source), templateHash = hash(template)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(process.env.WORKBENCH_TEST_EXECUTABLE ? { executablePath: process.env.WORKBENCH_TEST_EXECUTABLE, args: [] } : { args: ['.'] }), env })
let page
const errors = []
try {
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide(); BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 950 }) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.evaluate(() => { window.__progressEvents = []; window.workbench.onTranslationProgress((progress) => { if (progress) window.__progressEvents.push(progress) }) })
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  const imported = await page.evaluate((source) => window.workbench.importPapers([source], null, true), source)
  assert.equal(imported.ok, true); assert.equal(imported.data.added, 1)
  let paper, lastStage = '', lastPercent = -10, captured = false
  const deadline = Date.now() + 8 * 60_000
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => window.workbench.librarySnapshot())
    assert.equal(snapshot.ok, true)
    paper = snapshot.data.papers[0]
    const progress = snapshot.data.translationProgress
    if (progress && (progress.stage !== lastStage || (progress.percent !== null && progress.percent - lastPercent >= 10))) {
      lastStage = progress.stage; if (progress.percent !== null) lastPercent = progress.percent
      console.log('ENGINE', progress.stage, progress.percent === null ? 'indeterminate' : `${progress.percent}%`)
    }
    if (progress?.percent > 0 && progress.percent < 99 && !captured) {
      await page.getByTestId('translation-queue').waitFor()
      await page.waitForFunction(() => Number(document.querySelector('.translation-progress-track')?.getAttribute('aria-valuenow')) > 0)
      await page.screenshot({ path: join(evidence, 'real-progress.png'), animations: 'disabled', scale: 'css' })
      captured = true
    }
    if (['ready', 'failed', 'interrupted'].includes(paper.translationStatus)) break
    await delay(1000)
  }
  const events = await page.evaluate(() => window.__progressEvents)
  writeFileSync(join(evidence, 'events.json'), JSON.stringify({ events, finalStatus: paper?.translationStatus, error: paper?.translationError, errors }, null, 2))
  assert.equal(paper?.translationStatus, 'ready', paper?.translationError || 'Translation did not finish in time')
  assert.ok(events.some((event) => event.percent > 0 && event.percent < 99), 'Received numeric progress from the real installed engine')
  assert.ok(new Set(events.map((event) => event.stage)).size >= 3, 'Received multiple real translation phases')
  const values = events.filter((event) => event.percent !== null).map((event) => event.percent)
  assert.ok(values.every((value, i) => i === 0 || value >= values[i - 1]))
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  await page.waitForFunction(() => /[\u4e00-\u9fff]/.test(document.querySelector('.textLayer')?.textContent ?? ''))
  await page.screenshot({ path: join(evidence, 'bilingual-result.png'), animations: 'disabled', scale: 'css' })
  assert.equal(hash(source), originalHash); assert.equal(hash(template), templateHash)
  assert.deepEqual(errors, [])
  console.log('PASS Real engine progress, bilingual output, original source and external configuration preserved')
} finally {
  await app.close()
  const target = realpathSync(profile)
  if (dirname(target) === root && basename(target).startsWith('workbench-progress-live-')) rmSync(target, { recursive: true, force: true })
}
