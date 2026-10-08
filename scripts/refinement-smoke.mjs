import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { join, resolve } from 'node:path'

// Every fixture, cache and request in this regression uses an isolated workspace.
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/refinement-0.8.8', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], palettes = [], layouts = []
const pass = name => { checks.push(name); console.log('PASS', name) }
const candidate = { id: '2609.10001', arxivId: '2609.10001', pdfId: '2609.10001v1', title: 'Hyperspectral image classification with spectral and spatial evidence', authors: 'Fixture Author', abstract: 'Hyperspectral images contain rich spectral information. This synthetic abstract verifies a candidate preview before collection. It contains no private data and makes no scientific claims. The original title and complete abstract should remain readable while a Chinese translation is being requested.', journal: '', doi: '', publishedDate: '2026-09-27', matchReason: 'hyperspectral image', favorite: false, ignored: false }
const translated = { titleZh: '基于光谱与空间信息的高光谱图像分类', abstractZh: '高光谱图像包含丰富的光谱信息。此摘要仅用于验证收藏前的候选预览，不含私人数据，也不提出科研结论。请求中文翻译时，原始标题和完整摘要应保持可读。' }
let requests = 0
const server = createServer(async (req, res) => {
  let raw = ''; for await (const chunk of req) raw += chunk
  const body = JSON.parse(raw), content = JSON.parse(body.messages[1].content)
  assert.deepEqual(content, { title: candidate.title, abstract: candidate.abstract })
  requests++
  await new Promise(done => setTimeout(done, 700))
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(translated) } }] }))
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
let app, page
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  page.on('console', message => { if (message.type() === 'error' && /Workspace rendering error|Maximum update|snapshot/i.test(message.text())) errors.push(message.text()) })
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 1000); win.webContents.setBackgroundThrottling(false); win.showInactive()
    const original = win.setTitleBarOverlay.bind(win)
    win.setTitleBarOverlay = options => { globalThis.__fixturePalette = options; original(options) }
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
}
const unwrap = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.data }
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function preferences(background, appearance = 'dark', fontSize = 14) {
  await page.evaluate(async ({ background, appearance, fontSize }) => {
    for (const result of [await window.workbench.setAppearance(appearance), await window.workbench.updateInterfacePreferences({ background, fontSize })])
      if (!result.ok) throw Error(result.error.message)
  }, { background, appearance, fontSize })
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.waitForFunction(({ background, appearance }) => document.documentElement.dataset.background === background && document.documentElement.dataset.theme === appearance, { background, appearance })
}
async function geometry(name) {
  const value = await page.evaluate(() => {
    const quote = document.querySelector('.daily-encouragement'), context = document.querySelector('.titlebar-context')
    const rect = quote.getBoundingClientRect(), right = context.getBoundingClientRect()
    return { width: innerWidth, scroll: document.documentElement.scrollWidth, quoteWidth: rect.width, quoteRight: rect.right, contextLeft: right.left, maxWidth: getComputedStyle(quote).maxWidth }
  })
  assert.ok(value.scroll <= value.width + 1, JSON.stringify(value))
  assert.ok(value.quoteRight <= value.contextLeft + 1, JSON.stringify(value))
  assert.equal(value.maxWidth, '870px')
  assert.ok(value.quoteWidth <= 871 && value.quoteWidth > 150, JSON.stringify(value))
  layouts.push({ name, ...value })
}
function enterFallback() {
  const element = document.querySelector('.workspace') ?? document.querySelector('.titlebar')
  let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))]
  while (fiber) {
    const instance = fiber.stateNode
    if (instance && typeof instance.setState === 'function' && typeof instance.state?.failed === 'boolean') {
      instance.setState({ failed: true }); return
    }
    fiber = fiber.return
  }
  throw Error('ErrorBoundary instance not found')
}
try {
  await launch()
  const submission = unwrap(await page.evaluate(() => window.workbench.createSubmission({ title: 'Submission regression fixture', journal: 'Fixture Journal', manuscriptId: 'TEST-001', stages: [{ name: 'With editor', occurredOn: '2026-09-10' }], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '' })))
  unwrap(await page.evaluate(baseUrl => window.workbench.saveAssistantSettings({ provider: 'custom', model: 'controlled-fixture', baseUrl }), `http://127.0.0.1:${server.address().port}/v1`))
  const snapshot = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  const databasePath = snapshot.databasePath
  await app.close()
  const database = new DatabaseSync(databasePath)
  database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('arxiv.candidates.v1', JSON.stringify([candidate]))
  database.close()
  await launch()
  await nav('论文投稿')
  for (let index = 0; index < 3; index++) {
    await page.getByRole('button', { name: '更新投稿 Submission regression fixture', exact: true }).click()
    await page.getByRole('heading', { name: '更新投稿记录', exact: true }).waitFor()
    if (index === 0) {
      await page.getByLabel('稿件编号', { exact: true }).fill('TEST-002')
      await page.getByRole('button', { name: '保存投稿记录', exact: true }).click()
    } else await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
  }
  assert.equal(await page.getByRole('heading', { name: '工作区暂时无法显示。' }).count(), 0)
  const saved = unwrap(await page.evaluate(() => window.workbench.submissionsSnapshot())).submissions.find(item => item.id === submission.id)
  assert.equal(saved.manuscriptId, 'TEST-002'); assert.equal(saved.stages.length, 1)
  await shot('submission-edit-fixed')
  pass('Submission editor opens repeatedly, saves and closes without rendering recursion')

  for (const appearance of ['dark', 'light']) for (const background of ['klein', 'sage', 'orange', 'yellow', 'red', 'pink']) {
    await preferences(background, appearance)
    const colors = await page.evaluate(() => ({ base: getComputedStyle(document.documentElement).getPropertyValue('--chrome-color').trim(), panel: getComputedStyle(document.querySelector('.sidebar')).backgroundColor, workspace: getComputedStyle(document.documentElement).getPropertyValue('--surface-workspace').trim() }))
    const native = await app.evaluate(() => globalThis.__fixturePalette)
    assert.equal(native.color.toLowerCase(), colors.base)
    await geometry(`${appearance}-${background}`)
    palettes.push({ appearance, background, ...colors, native })
    if (background === 'orange' || background === 'pink') {
      await nav('设置')
      await page.getByRole('heading', { name: '外观与显示', exact: true }).waitFor()
      await page.waitForTimeout(260)
      await shot(`settings-${appearance}-${background}`)
    }
  }
  assert.equal(new Set(palettes.filter(item => item.appearance === 'dark').map(item => item.panel)).size, 6)
  pass('Six palettes in both themes reach content surfaces and native caption buttons')
  for (const width of [1100, 1600, 2048]) for (const fontSize of [14, 18]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1000), width)
    await preferences('sage', 'dark', fontSize)
    await geometry(`${width}-${fontSize}`)
    if (width === 1100 && fontSize === 18 || width === 2048 && fontSize === 14) await shot(`titlebar-${width}-${fontSize}`)
  }
  assert.ok(layouts.find(item => item.name === '2048-14').quoteWidth >= 860)
  pass('Encouragement reaches triple ideal width and contracts without overlapping caption controls')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600, 1000))
  await preferences('klein', 'dark')
  await nav('文献阅读')
  await page.getByRole('button', { name: /^Arxiv Daily/ }).click()
  await page.locator('.arxiv-candidate-abstract p').click()
  await page.getByRole('heading', { name: '中英摘要', exact: true }).waitFor()
  await page.locator('.paper-overview-loading').waitFor()
  assert.equal(await page.locator('.paper-summary-original p').innerText(), candidate.abstract)
  const progress = page.getByRole('progressbar', { name: '标题与摘要翻译进度' })
  assert.equal(await progress.getAttribute('aria-valuenow'), null)
  await shot('candidate-translation-loading')
  await page.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  assert.equal(await page.locator('.paper-summary-translation p').innerText(), translated.abstractZh)
  await shot('candidate-bilingual-preview')
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  await page.getByRole('button', { name: `预览中英摘要 ${candidate.title}`, exact: true }).click()
  await page.getByRole('heading', { name: translated.titleZh, exact: true }).waitFor()
  assert.equal(requests, 1)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers.length, 0)
  await page.getByRole('button', { name: '关闭预览', exact: true }).click()
  pass('Uncollected card and keyboard title open full bilingual preview; reopening reuses one request')

  unwrap(await page.evaluate(() => window.workbench.saveArxivSettings({ enabled: false, daysBack: 14, maxPerDay: 5, excludedKeywords: [], directions: ['hyperspectral image'] })))
  await app.evaluate(({ session }, candidate) => {
    const network = session.fromPartition('workbench-research')
    network.fetch = async (_url, options) => {
      await new Promise((done, reject) => { const timer = setTimeout(done, 1200); options.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(new DOMException('Stopped', 'AbortError')) }, { once: true }) })
      return new Response(`<feed xmlns="http://www.w3.org/2005/Atom"><entry><id>http://arxiv.org/abs/${candidate.pdfId}</id><title>${candidate.title}</title><summary>${candidate.abstract}</summary><published>${candidate.publishedDate}T00:00:00Z</published><author><name>Fixture Author</name></author></entry></feed>`, { status: 200, headers: { 'Content-Type': 'application/atom+xml' } })
    }
  }, candidate)
  await page.getByRole('button', { name: '立即检索', exact: true }).click()
  await page.getByRole('button', { name: '检索中…', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '检索中…', exact: true }).isDisabled(), true)
  const positions = await page.evaluate(() => ({ status: document.querySelector('.arxiv-run-status').getBoundingClientRect().top, candidates: document.querySelector('.arxiv-candidates').getBoundingClientRect().top }))
  assert.ok(positions.status < positions.candidates)
  await shot('retrieval-visible-status')
  await page.getByRole('button', { name: '停止', exact: true }).click()
  await page.getByRole('button', { name: '立即检索', exact: true }).waitFor()
  pass('Retrieval gives immediate busy feedback and visible cancellable status above candidates')

  await page.evaluate(enterFallback)
  await page.getByRole('heading', { name: '工作区暂时无法显示。', exact: true }).waitFor()
  await page.getByRole('button', { name: '重新打开工作区', exact: true }).click()
  await page.locator('.titlebar').waitFor()
  await page.evaluate(enterFallback)
  await page.getByRole('heading', { name: '工作区暂时无法显示。', exact: true }).waitFor()
  const closed = app.waitForEvent('close', { timeout: 5000 })
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  app = undefined
  pass('Error fallback recovers and closes through the normal save handshake')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, palettes, layouts, overviewRequests: requests }, null, 2))
} finally {
  if (app) await app.close()
  await new Promise(done => server.close(done))
}
