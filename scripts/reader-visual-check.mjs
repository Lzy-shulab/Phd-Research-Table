import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

// Reopen the already translated synthetic fixture; this does not initiate another network translation.
const resultDir = resolve('test-results/current/live')
const live = JSON.parse(readFileSync(resolve(resultDir, 'live-result.json'), 'utf8'))
const source = live.snapshot.data.papers[0].sourcePath
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: dirname(dirname(dirname(source))) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('release/win-unpacked/PhD 科研工作台.exe'), env, args: [] })
try {
  const page = await app.firstWindow()
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读' }).click()
  await page.getByRole('button', { name: '翻译', exact: true }).click()
  await page.waitForFunction(() => /[\u4e00-\u9fff]/.test(document.querySelector('.textLayer')?.textContent ?? ''))
  const geometry = await page.locator('.pdf-page').evaluate((host) => {
    const bounds = host.getBoundingClientRect()
    const texts = Array.from(host.querySelectorAll('.textLayer span')).filter(span => span.textContent.trim())
    return { width: bounds.width, height: bounds.height,
      english: texts.some(span => /Research/.test(span.textContent)), chinese: texts.some(span => /[\u4e00-\u9fff]/.test(span.textContent)),
      allTextInPage: texts.every(span => { const b = span.getBoundingClientRect(); return b.left >= bounds.left - 2 && b.right <= bounds.right + 2 && b.top >= bounds.top - 2 && b.bottom <= bounds.bottom + 2 }) }
  })
  assert.ok(geometry.width > geometry.height)
  assert.ok(geometry.english && geometry.chinese && geometry.allTextInPage)
  await page.screenshot({ path: resolve(resultDir, 'reader-bilingual.png'), animations: 'disabled', scale: 'css' })
  // Make selection visible for inspection of actual text-layer alignment with the PDF canvas.
  await page.locator('.textLayer').evaluate(layer => {
    const span = Array.from(layer.querySelectorAll('span')).find(node => /[\u4e00-\u9fff]/.test(node.textContent))
    const range = document.createRange(); range.selectNodeContents(span)
    window.getSelection().removeAllRanges(); window.getSelection().addRange(range)
  })
  await page.screenshot({ path: resolve(resultDir, 'reader-text-selection.png'), animations: 'disabled', scale: 'css' })
  assert.deepEqual(errors, [])
  writeFileSync(resolve(resultDir, 'packaged-reader-report.json'), JSON.stringify({ geometry, errors, networkTranslation: false }, null, 2))
  console.log('PASS Existing live bilingual PDF opens in packaged app with English/Chinese text layer in page bounds')
} finally { await app.close() }
