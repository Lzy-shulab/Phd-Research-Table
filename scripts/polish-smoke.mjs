import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const live = process.env.WORKBENCH_ENCOURAGEMENT_LIVE === '1'
const directory = resolve(`test-results/current/polish-${live ? 'live-' : ''}${executablePath ? 'packaged' : 'development'}`)
mkdirSync(directory, { recursive: true })
const dataDirectory = join(directory, `data-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DATA_DIR: dataDirectory, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], geometries = []
const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const record = (name) => { checks.push(name); console.log('PASS', name) }
let app, page, quote
const firstDate = live ? new Date().toISOString() : '2026-09-08T04:00:00.000Z'
const fixturePool = [
  { id: 6477, uuid: '0a97af92-1467-4fa5-897d-426fc94a7fcc', hitokoto: '把今天的问题问清楚，就是研究向前的一步。', from: '受控验收语句', from_who: null },
  { id: 7081, uuid: '1a97af92-1467-4fa5-897d-426fc94a7fcc', hitokoto: '给自己一点时间，把一个小问题做扎实。', from: '受控验收语句', from_who: null },
  { id: 8997, uuid: '2a97af92-1467-4fa5-897d-426fc94a7fcc', hitokoto: '保持好奇，也允许自己慢一点理解。', from: '受控验收语句', from_who: null }
]
const section = (name) => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const capture = async (name) => {
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nav-selection, .dock-selection')).every((item) => {
    const a = item.getBoundingClientRect(), b = item.parentElement.getBoundingClientRect()
    return Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2
  }))
  const geometry = await page.evaluate(() => {
    const selectors = ['.app-shell', '.titlebar', '.daily-encouragement', 'main', '.submission-card']
    return selectors.flatMap((selector) => Array.from(document.querySelectorAll(selector)).map((element) => {
      const box = element.getBoundingClientRect()
      return { selector, left: box.left, right: box.right, width: box.width, scroll: element.scrollWidth, client: element.clientWidth, font: getComputedStyle(element).fontSize }
    }))
  })
  for (const item of geometry) { assert.ok(item.scroll <= item.client + 2, `${name}: horizontal overflow in ${item.selector}`); assert.ok(item.left >= -1 && item.right <= await page.evaluate(() => innerWidth) + 1, `${name}: outside viewport`) }
  geometries.push({ name, geometry })
  await page.screenshot({ path: join(directory, `${name}.png`), animations: 'disabled', scale: 'css' })
}
async function launch() {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].hide() })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.clock.setFixedTime(new Date(firstDate))
  await app.evaluate(({ session }, { fixturePool, live, firstDate }) => {
    const NativeDate = Date
    globalThis.__polishNow = Date.parse(firstDate)
    globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : [globalThis.__polishNow])) } static now() { return globalThis.__polishNow } }
    globalThis.__quoteRequests = []; globalThis.__quoteOffline = false
    if (!live) session.fromPartition('workbench-research').fetch = async (url) => {
      globalThis.__quoteRequests.push(String(url))
      if (globalThis.__quoteOffline) throw new Error('controlled offline')
      return new Response(JSON.stringify(fixturePool), { headers: { 'Content-Type': 'application/json' } })
    }
    else session.fromPartition('workbench-research').webRequest.onBeforeRequest((details, callback) => { globalThis.__quoteRequests.push(details.url); callback({}) })
    process.env.WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO = '0'
  }, { fixturePool, live, firstDate })
  await page.reload(); await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
try {
  await launch()
  quote = unwrap(await page.evaluate(() => window.workbench.dailyEncouragement()))
  assert.equal(quote.state, 'online')
  await page.waitForFunction((text) => document.querySelector('[data-testid="daily-encouragement-text"]')?.textContent === text, quote.quote.text)
  await page.getByRole('button', { name: '查看每日科研鼓励语' }).click()
  assert.equal(await page.getByRole('dialog').locator('blockquote').textContent(), quote.quote.text)
  await page.screenshot({ path: join(directory, 'encouragement-source.png'), animations: 'disabled' })
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).click()
  const requests = await app.evaluate(() => globalThis.__quoteRequests)
  assert.ok(requests.length > 0 && requests.every((url) => url === 'https://sentences-bundle.hitokoto.cn/sentences/k.json'))
  record(`${live ? 'Live' : 'Controlled'} network quote appears in the shared titlebar with its full text and source available`)
  const inputs = { title: 'DA-MambaHSI: Dynamic Axial Mamba for Hyperspectral Image Classification', journal: 'Pattern Recognition', manuscriptId: 'PR-D-26-12083', stages: [{ name: 'Submitted to Journal', occurredOn: '2026-08-28' }], revisionDueDate: null, reminderEnabled: true, reminderDays: 3, notes: '' }
  const created = unwrap(await page.evaluate((input) => window.workbench.createSubmission(input), inputs))
  const reviewed = unwrap(await page.evaluate((input) => window.workbench.createSubmission({ ...input, title: '另一篇进入审稿的研究论文' }), inputs))
  unwrap(await page.evaluate(({ submission, input }) => window.workbench.updateSubmission(submission.id, { ...input, title: '另一篇进入审稿的研究论文', stages: [
    { id: submission.stages[0].id, name: 'Submitted to Journal', occurredOn: '2026-08-28' },
    { name: 'With editor', occurredOn: '2026-09-08' }
  ] }), { submission: reviewed, input: inputs }))
  await section('论文投稿')
  const card = page.getByTestId('submission-card').filter({ hasText: inputs.title })
  const reviewedCard = page.getByTestId('submission-card').filter({ hasText: '另一篇进入审稿的研究论文' })
  await card.waitFor()
  const submissionPresentation = await page.evaluate(() => {
    const journal = getComputedStyle(document.querySelector('.submission-journal'))
    return { journalWeight: Number(journal.fontWeight), journalBackground: journal.backgroundColor }
  })
  assert.ok(submissionPresentation.journalWeight >= 600)
  assert.notEqual(submissionPresentation.journalBackground, 'rgba(0, 0, 0, 0)')
  assert.equal(await card.getByTestId('submission-stage').count(), 1)
  assert.equal(await reviewedCard.getByTestId('submission-stage').count(), 2)
  assert.match(await card.getByTestId('submission-stage').textContent(), /Submitted to Journal.*8月28日/)
  assert.match(await reviewedCard.getByTestId('submission-stage').last().textContent(), /With editor.*9月8日/)
  assert.equal(await page.getByRole('navigation', { name: '当前投稿状态筛选' }).getByRole('button', { name: /With editor/ }).count(), 1)
  assert.equal(await page.getByTestId('stat-阶段记录').count(), 1)
  unwrap(await page.evaluate(({ submission, input }) => window.workbench.updateSubmission(submission.id, { ...input, stages: submission.stages.map(({ id, name, occurredOn }) => ({ id, name, occurredOn })), notes: '补充备注不改变状态日期' }), { submission: created, input: inputs }))
  await capture('submissions-light')
  record('Custom stage names and explicit dates render in order; only recorded stages appear and note edits preserve their dates')
  assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).fontSize), '14px')
  for (const [label, theme] of [['浅色模式', 'light'], ['深色模式', 'dark']]) {
    await page.getByRole('button', { name: label, exact: true }).click()
    await page.waitForFunction((value) => document.documentElement.dataset.theme === value, theme)
    await app.evaluate(({ BrowserWindow }, theme) => { BrowserWindow.getAllWindows()[0].setBounds(theme === 'dark' ? { width: 1100, height: 700 } : { width: 1440, height: 940 }) }, theme)
    for (const [name, slug] of [['研究计划', 'planner'], ['文献阅读', 'library'], ['科研成果', 'outputs'], ['论文投稿', 'submissions'], ['设置', 'settings']]) {
      await section(name)
      await page.locator('main').waitFor()
      assert.equal(await page.getByTestId('daily-encouragement-text').textContent(), quote.quote.text)
      await capture(`${slug}-${theme}`)
    }
  }
  await section('论文投稿')
  await card.getByRole('button', { name: /^更新投稿/ }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByRole('button', { name: '保存投稿记录', exact: true }).scrollIntoViewIfNeeded()
  await page.screenshot({ path: join(directory, 'submission-dialog-minimum.png'), animations: 'disabled' })
  await dialog.getByRole('button', { name: '取消', exact: true }).click()
  record('All five pages share the same sentence and larger typography; light and minimum-size dark layouts and the submission form fit')
  if (!live) {
    await app.evaluate(() => { globalThis.__polishNow = Date.parse('2026-09-09T00:00:00.000Z') })
    await page.clock.setFixedTime(new Date('2026-09-09T00:00:00.000Z'))
    await app.evaluate(({ powerMonitor, BrowserWindow }) => { powerMonitor.emit('resume'); BrowserWindow.getAllWindows()[0].webContents.send('submissions:changed') })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await page.waitForFunction((text) => document.querySelector('[data-testid="daily-encouragement-text"]')?.textContent !== text, quote.quote.text)
    const next = unwrap(await page.evaluate(() => window.workbench.dailyEncouragement()))
    assert.equal(next.date, '2026-09-09'); assert.notEqual(next.quote.id, quote.quote.id)
    await app.evaluate(() => { globalThis.__polishNow = Date.parse('2026-09-10T00:00:00.000Z'); globalThis.__quoteOffline = true })
    await page.clock.setFixedTime(new Date('2026-09-10T00:00:00.000Z'))
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    const offline = unwrap(await page.evaluate(() => window.workbench.dailyEncouragement()))
    assert.equal(offline.state, 'cached'); assert.equal(offline.sourceDate, '2026-09-09'); assert.equal(offline.quote.text, next.quote.text)
    await app.evaluate(() => { globalThis.__quoteOffline = false })
    const restored = unwrap(await page.evaluate(() => window.workbench.dailyEncouragement(true)))
    assert.equal(restored.state, 'online'); assert.equal(restored.date, '2026-09-10')
    record('Resume advances the daily quote while explicit submission dates remain unchanged, and offline cache recovers without false source dates')
  }
  await app.close(); app = null
  await launch()
  const persisted = unwrap(await page.evaluate(() => window.workbench.submissionsSnapshot()))
  assert.equal(persisted.submissions.length, 2)
  assert.equal(persisted.submissions.find((item) => item.id === created.id).notes, '补充备注不改变状态日期')
  assert.equal(persisted.submissions.find((item) => item.id === reviewed.id).currentStage, 'With editor')
  record('Restart preserves submission records, custom stages and settings')
  assert.deepEqual(errors, [])
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ checks, errors, live, executablePath: executablePath ?? 'development', dataDirectory, quote, geometries, boundary: 'All data is isolated. Live mode fetches the public sentence source; controlled mode uses a fixed source and simulated dates/resume. Background midnight scheduling is also tested with fake timers in unit tests.' }, null, 2))
  console.log(`ALL ${checks.length} POLISH CHECKS PASSED`)
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(directory, 'failure.png'), animations: 'disabled' }).catch(() => {})
  console.error(error); process.exitCode = 1
} finally { if (app) await app.close() }
