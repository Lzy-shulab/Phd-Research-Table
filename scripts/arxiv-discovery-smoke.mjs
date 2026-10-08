import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/arxiv-discovery-0.8.18', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const fixture = resolve('tests/fixtures/translation-check.pdf')
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const candidates = [1, 2].map(number => ({
  id: `2610.1000${number}`, arxivId: `2610.1000${number}`, pdfId: `2610.1000${number}v1`,
  title: `Hyperspectral reconstruction candidate ${number}`,
  abstract: `Candidate ${number} presents a complete research abstract. It describes a hyperspectral reconstruction method, evaluates spectral and spatial quality, and reports the scope of the experiment. This fixture checks bilingual screening and does not represent a published scientific claim.`,
  authors: 'Fixture Author', journal: 'arXiv', publishedDate: '2026-10-05', doi: '', matchReason: '匹配：hyperspectral reconstruction', favorite: false, ignored: false
}))
let firstRelease
const firstGate = new Promise(resolve => { firstRelease = resolve })
let failSecond = true
const requests = []
const server = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk
  const input = JSON.parse(raw), source = JSON.parse(input.messages[1].content)
  assert.equal(request.url, '/v1/chat/completions')
  const number = source.title.endsWith('1') ? 1 : 2
  requests.push(number)
  if (requests.length === 1) await firstGate
  if (number === 2 && failSecond) { response.writeHead(503); response.end('fixture unavailable'); return }
  const revision = requests.filter(item => item === number).length
  const translated = { titleZh: `高光谱重建候选 ${number}${revision > 1 ? '（更新译文）' : ''}`, abstractZh: `候选 ${number} 提出一种高光谱图像重建方法，并评估光谱和空间质量。本摘要仅供中英候选筛选、重试及收藏流程验收，不代表已发表的研究结论。` }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(translated) } }] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
let app, page
const errors = [], checks = []
const pass = name => { checks.push(name); console.log('PASS', name) }
const unwrap = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.data }
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const snapshot = async () => unwrap(await page.evaluate(() => window.workbench.librarySnapshot()))
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function launch() {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 950); win.webContents.setBackgroundThrottling(false); win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
}
try {
  await launch()
  unwrap(await page.evaluate(baseUrl => window.workbench.saveAssistantSettings({ provider: 'custom', model: 'arxiv-fixture', baseUrl }), baseUrl))
  const imported = unwrap(await page.evaluate(fixture => window.workbench.importPapers([fixture], null, false), fixture))
  assert.equal(imported.added, 1)
  const original = (await snapshot()).papers[0]
  const databasePath = unwrap(await page.evaluate(() => window.workbench.bootstrap())).databasePath
  await app.close()
  const db = new DatabaseSync(databasePath)
  db.prepare('UPDATE papers SET collection = ?, arxiv_id = ?, title = ?, abstract = ?, collected_date = ? WHERE id = ?').run('arxiv', '2610.09999', 'Existing arXiv reading fixture', 'Previously collected original abstract.', '2026-10-04', original.id)
  db.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run('arxiv.candidates.v1', JSON.stringify(candidates))
  db.close()
  await launch()
  await nav('文献阅读')
  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /Arxiv Daily/ }).click()
  await page.getByRole('region', { name: '候选摘要翻译' }).waitFor()
  assert.equal(await page.locator('.arxiv-candidate-list article').count(), 0)
  assert.equal(await page.getByTestId('paper-card').count(), 0)
  assert.equal(await page.locator('.library-toolbar').count(), 0)
  await shot('01-preparing')
  firstRelease()
  await waitForAsync(page, async () => { const value = await window.workbench.librarySnapshot(); return value.ok && !value.data.arxiv.running && value.data.arxiv.preparation.failed === 1 })
  await page.getByRole('button', { name: '重试未完成翻译', exact: true }).waitFor()
  assert.equal(await page.locator('.arxiv-candidate-list article').count(), 1)
  assert.match(await page.locator('.arxiv-preparation').innerText(), /HTTP 503/)
  pass('Persisted candidates stay hidden until bilingual titles and abstracts finish; failed candidates remain retryable')
  failSecond = false
  await page.getByRole('button', { name: '重试未完成翻译', exact: true }).click()
  await waitForAsync(page, async () => { const value = await window.workbench.librarySnapshot(); return value.ok && !value.data.arxiv.running && value.data.arxiv.candidates.length === 2 })
  await page.locator('.arxiv-candidate-list article').nth(1).waitFor()
  assert.deepEqual(requests, [1, 2, 2])
  const first = page.locator('.arxiv-candidate-list article').first()
  assert.match(await first.innerText(), /高光谱重建候选 1/)
  assert.match(await first.innerText(), /Hyperspectral reconstruction candidate 1/)
  assert.match(await first.innerText(), /Candidate 1 presents a complete research abstract/)
  assert.match(await first.innerText(), /候选 1 提出一种高光谱图像重建方法/)
  await first.getByRole('button', { name: '展开摘要', exact: true }).click()
  await shot('02-bilingual-ready')
  pass('Retry translates only unfinished work; the candidate card includes both original and Chinese titles and full expandable abstracts')
  await first.getByRole('button', { name: /^预览中英摘要/ }).click()
  const overview = page.getByRole('dialog', { name: '中英摘要' })
  await overview.getByRole('button', { name: '重新翻译', exact: true }).waitFor()
  await overview.getByRole('button', { name: '重新翻译', exact: true }).click()
  await overview.getByRole('heading', { name: '高光谱重建候选 1（更新译文）', exact: true }).waitFor()
  await overview.getByRole('button', { name: '关闭预览', exact: true }).click()
  assert.match(await first.innerText(), /高光谱重建候选 1（更新译文）/)
  await first.getByRole('button', { name: /^预览中英摘要/ }).click()
  await overview.getByRole('heading', { name: '高光谱重建候选 1（更新译文）', exact: true }).waitFor()
  await overview.getByRole('button', { name: '关闭预览', exact: true }).click()
  assert.deepEqual(requests, [1, 2, 2, 1])
  pass('Explicit retranslation persists back to the candidate card and survives reopening without another AI request')
  await app.evaluate(({ session }, bytes) => {
    const network = session.fromPartition('workbench-research')
    network.fetch = async url => {
      if (!String(url).startsWith('https://arxiv.org/pdf/')) throw Error('Unexpected fixture network request')
      return new Response(new Uint8Array(bytes), { headers: { 'Content-Type': 'application/pdf' } })
    }
  }, [...Buffer.concat([readFileSync(fixture), Buffer.from('\n% isolated arxiv favorite fixture\n')])])
  await first.getByRole('button', { name: '收藏', exact: true }).click()
  await waitForAsync(page, async () => { const value = await window.workbench.librarySnapshot(); return value.ok && value.data.papers.some(paper => paper.arxivId === '2610.10001') })
  await page.locator('.folder-name').filter({ hasText: /^Arvix/ }).click()
  await page.getByRole('heading', { name: 'Arvix', exact: true }).waitFor()
  assert.equal(await page.getByTestId('paper-card').count(), 2)
  assert.equal(await page.locator('.arxiv-candidates').count(), 0)
  const state = await snapshot()
  assert.equal(state.papers.find(paper => paper.id === original.id).sourcePath, original.sourcePath)
  await shot('03-arvix-reading')
  await page.getByTestId('paper-card').filter({ hasText: 'Existing arXiv reading fixture' }).getByRole('button', { name: 'Existing arXiv reading fixture', exact: true }).click()
  await page.locator('.reader-dialog').waitFor()
  assert.equal(await page.getByRole('dialog', { name: '中英摘要' }).count(), 0)
  await page.keyboard.press('Escape')
  await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /^全部文献/ }).click()
  await page.getByRole('heading', { name: '文献库', exact: true }).waitFor()
  assert.equal(await page.getByTestId('paper-card').count(), 2)
  pass('Existing and newly collected arXiv papers share the Arvix folder, open the PDF directly and appear in All Literature without changing the existing PDF path')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, requests, profile }, null, 2))
  console.log(`ALL ${checks.length} ARXIV DISCOVERY CHECKS PASSED. Evidence: ${evidence}`)
} finally {
  firstRelease()
  await app?.close().catch(() => undefined)
  server.closeAllConnections()
  await new Promise(resolve => server.close(resolve))
}
