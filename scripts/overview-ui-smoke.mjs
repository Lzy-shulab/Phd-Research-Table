import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve(`test-results/ui-redesign-${version}/overview`, executablePath ? 'packaged' : 'development')
const profile = join(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
let releaseFirst
const firstGate = new Promise(resolve => { releaseFirst = resolve })
let mode = 'fail', requests = 0
const abstract = Array.from({ length: 5 }, () => 'This study examines spatial and spectral reconstruction of hyperspectral images. The method retains the measured spectral response and compares the reconstructed data with registered observations. Experiments report spatial detail, spectral accuracy, and the limits of the evaluated scenes.').join('\n\n')
const translated = { titleZh: '高光谱图像的空间与光谱重建研究', abstractZh: Array.from({ length: 5 }, () => '本研究考察高光谱图像的空间与光谱重建。所用方法保留测得的光谱响应，并将重建数据与配准观测进行比较。实验报告了空间细节、光谱精度和所评估场景的适用范围。这段文字仅用于隔离测试中的中英对照展示。').join('\n\n') }
const server = createServer(async (request, response) => {
  let raw = ''; for await (const chunk of request) raw += chunk
  const input = JSON.parse(raw)
  assert.equal(request.url, '/v1/chat/completions')
  assert.equal(input.stream, false)
  requests++
  if (requests === 1) await firstGate
  if (mode === 'fail') { response.writeHead(503); response.end('fixture unavailable'); return }
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(translated) } }] }))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const app = await electron.launch({ ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['.'] }), env })
const errors = [], checks = [], geometry = []
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 950); win.webContents.setBackgroundThrottling(false); win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  unwrap(await page.evaluate(baseUrl => window.workbench.saveAssistantSettings({ provider: 'custom', model: 'overview-fixture', baseUrl }), `http://127.0.0.1:${server.address().port}/v1`))
  unwrap(await page.evaluate(path => window.workbench.importPapers([path], null, false), resolve('tests/fixtures/translation-check.pdf')))
  const paper = unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers[0]
  unwrap(await page.evaluate(id => window.workbench.updatePaper(id, { title: 'Spatial and Spectral Reconstruction of Hyperspectral Images', authors: 'Research Group', journal: 'Imaging Research', year: '2026' }), paper.id))
  const databasePath = unwrap(await page.evaluate(() => window.workbench.bootstrap())).databasePath
  const db = new DatabaseSync(databasePath)
  db.prepare('UPDATE papers SET abstract = ? WHERE id = ?').run(abstract, paper.id)
  db.close()
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ background: 'sage', fontSize: 14 })))
  unwrap(await page.evaluate(() => window.workbench.setAppearance('light')))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
  const open = async () => { await nav('文献阅读'); await page.getByTestId('paper-card').getByRole('button', { name: '中英摘要', exact: true }).click() }
  const dialog = page.getByRole('dialog', { name: '中英摘要' })
  const shot = async name => {
    await page.waitForTimeout(450)
    const measure = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect(), footer = element.querySelector('.paper-overview-footer').getBoundingClientRect()
      const status = element.querySelector('.paper-overview-feedback').getBoundingClientRect()
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, viewportWidth: innerWidth, viewportHeight: innerHeight,
        footerVisible: footer.top >= box.top && footer.bottom <= box.bottom, statusVisible: status.top >= box.top && status.bottom <= box.bottom,
        scrollableText: element.querySelector('.paper-overview-scroll').scrollHeight > element.querySelector('.paper-overview-scroll').clientHeight + 1 }
    })
    assert.ok(measure.top >= 0 && measure.bottom <= measure.viewportHeight && measure.left >= 0 && measure.right <= measure.viewportWidth, `${name}: dialog containment`)
    assert.ok(measure.footerVisible && measure.statusVisible, `${name}: actions and status stay visible`)
    geometry.push({ name, ...measure })
    await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
  }
  await open()
  await dialog.getByRole('status').filter({ hasText: '正在翻译标题与摘要' }).waitFor()
  await shot('01-loading')
  releaseFirst()
  await dialog.getByRole('alert').filter({ hasText: 'HTTP 503' }).waitFor()
  await shot('02-provider-error')
  checks.push('Loading names the current stage; provider errors and retry remain visible above long abstracts')
  mode = 'success'
  await dialog.getByRole('button', { name: '重试', exact: true }).click()
  await dialog.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  await shot('03-bilingual-ready')
  assert.equal(requests, 2)
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await open()
  await dialog.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  assert.equal(requests, 2)
  checks.push('Retry generates the complete bilingual view and reopening reuses the saved translation')
  mode = 'fail'
  await dialog.getByRole('button', { name: '重新翻译', exact: true }).click()
  await dialog.getByRole('alert').filter({ hasText: '当前译文仍可阅读' }).waitFor()
  assert.equal(await dialog.getByRole('heading', { name: translated.titleZh, exact: true }).count(), 1)
  await shot('04-retranslation-error')
  await dialog.getByRole('button', { name: 'AI 设置', exact: true }).click()
  await page.locator('#assistant-settings').waitFor()
  assert.ok(await page.locator('#assistant-settings').evaluate(element => element.getBoundingClientRect().top >= 0 && element.getBoundingClientRect().top < innerHeight / 2))
  checks.push('Failed retranslation retains the existing text, and AI settings opens at the relevant section')
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ background: 'midnight', fontSize: 18 })))
  unwrap(await page.evaluate(() => window.workbench.setAppearance('dark')))
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720))
  await open(); await dialog.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  await shot('05-dark-large-text')
  const scroll = dialog.locator('.paper-overview-scroll')
  await scroll.evaluate(element => { element.scrollTop = element.scrollHeight })
  await shot('06-dark-scrolled')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await open(); await dialog.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  await shot('07-reduced-motion')
  checks.push('At 1100 × 720 and 18px text, paired content scrolls while status and actions stay accessible; reduced motion works')
  await dialog.getByRole('button', { name: '关闭对话框', exact: true }).click()
  unwrap(await page.evaluate(() => window.workbench.saveAssistantSettings({ provider: 'custom', model: 'Qwen/Qwen3-8B', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: 'isolated-fixture-key' })))
  await app.evaluate((_electron, translated) => {
    globalThis.overviewFixtureRequests = []
    globalThis.fetch = async (url, init) => {
      if (String(url) !== 'https://api.siliconflow.cn/v1/chat/completions') throw Error('Unexpected fixture endpoint')
      globalThis.overviewFixtureRequests.push(JSON.parse(init.body))
      return new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(translated) } }] }), { headers: { 'Content-Type': 'application/json' } })
    }
  }, translated)
  unwrap(await page.evaluate(id => window.workbench.generatePaperOverview({ id, regenerate: true }), paper.id))
  const requestShape = await app.evaluate(() => {
    const request = globalThis.overviewFixtureRequests[0]
    return { thinking: request.enable_thinking, responseFormat: request.response_format, maxTokens: request.max_tokens }
  })
  assert.deepEqual(requestShape, { thinking: false, responseFormat: { type: 'json_object' }, maxTokens: 6000 })
  checks.push('Qwen3 on the SiliconFlow endpoint requests non-thinking JSON output for title and abstract translation')
  const extractionDb = new DatabaseSync(databasePath)
  extractionDb.prepare('UPDATE papers SET abstract = ? WHERE id = ?').run('', paper.id)
  extractionDb.close()
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await open(); await dialog.getByRole('status').filter({ hasText: '需要原文摘要' }).waitFor()
  assert.equal(await dialog.getByRole('button', { name: '翻译摘要', exact: true }).isDisabled(), true)
  await shot('08-original-input')
  const manualAbstract = 'This document is generated solely to verify a local research workbench. It contains no private data and makes no scientific claims. The translation workflow should preserve the English source and produce a Chinese translation on the right side of the same page.'
  await dialog.getByLabel('粘贴原文摘要', { exact: true }).fill(manualAbstract)
  await dialog.getByRole('button', { name: '翻译摘要', exact: true }).click()
  await dialog.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  assert.match(await dialog.locator('.paper-summary-original p').innerText(), /This document is generated solely/)
  const extractedInput = await app.evaluate(() => JSON.parse(globalThis.overviewFixtureRequests.at(-1).messages[1].content).abstract)
  assert.match(extractedInput, /This document is generated solely/)
  checks.push('When the PDF does not provide a bounded abstract, the visible original input accepts pasted text and enables translation')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ checks, geometry, errors, requests }, null, 2))
  console.log(JSON.stringify({ checks, errors, requests, evidence }, null, 2))
} finally { releaseFirst(); await app.close(); await new Promise(resolve => server.close(resolve)) }
