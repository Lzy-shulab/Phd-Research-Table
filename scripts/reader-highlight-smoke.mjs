import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/reader-ui-0.8.18', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const fixture = resolve('tests/fixtures/translation-check.pdf')
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: profile,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE

let overviewRequests = 0
const server = createServer(async (request, response) => {
  let body = ''
  for await (const chunk of request) body += chunk
  const input = JSON.parse(body)
  assert.equal(request.url, '/v1/chat/completions')
  assert.match(input.messages[0].content, /学术论文翻译助手/)
  overviewRequests++
  await new Promise((done) => setTimeout(done, 2200))
  response.writeHead(200, { 'Content-Type': 'application/json' })
  response.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ titleZh: '科研工作流翻译检查', abstractZh: '这是用于验收翻译进度与阅读交互的中文摘要。' }) } }] }))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`

const errors = [], checks = []
const pass = (name) => { checks.push(name); console.log('PASS', name) }
let app, page
async function launch() {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(1600, 940)
    window.webContents.setBackgroundThrottling(false)
    window.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
}
const nav = (name) => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const screenshot = (name) => page.screenshot({ path: join(evidence, name), animations: 'disabled', scale: 'css' })

try {
  await launch()
  const imported = await page.evaluate(async ({ fixture, baseUrl }) => {
    const unwrap = (result) => { if (!result.ok) throw Error(result.error.message); return result.data }
    unwrap(await window.workbench.saveAssistantSettings({ provider: 'custom', model: 'controlled-overview', baseUrl }))
    return unwrap(await window.workbench.importPapers([fixture], null, false))
  }, { fixture, baseUrl })
  assert.equal(imported.added, 1)
  await page.evaluate(async () => {
    const snapshot = await window.workbench.librarySnapshot()
    if (!snapshot.ok) throw Error(snapshot.error.message)
    const result = await window.workbench.updatePaper(snapshot.data.papers[0].id, { notes: '已有阅读笔记应保留。' })
    if (!result.ok) throw Error(result.error.message)
  })
  await nav('文献阅读')
  await page.getByTestId('paper-card').waitFor()

  await page.getByTestId('paper-card').getByRole('button', { name: '中英摘要', exact: true }).click()
  const overview = page.getByRole('dialog', { name: '中英摘要' })
  const sourceAbstract = overview.getByLabel('原文摘要', { exact: true })
  await sourceAbstract.waitFor()
  await sourceAbstract.fill('This controlled abstract explains a research workflow for hyperspectral image reconstruction, translation progress, and persistent PDF highlights. The text is only test data and contains no private information.')
  await overview.getByRole('button', { name: '翻译摘要', exact: true }).click()
  const progress = overview.getByRole('progressbar', { name: '标题与摘要翻译进度' })
  await progress.waitFor()
  assert.match(await overview.locator('.paper-overview-progress-heading').innerText(), /正在.+摘要|正在翻译/)
  await screenshot('01-overview-progress.png')
  await overview.getByRole('heading', { name: '科研工作流翻译检查', exact: true }).waitFor()
  assert.equal(overviewRequests, 1)
  await screenshot('02-overview-complete.png')
  await overview.getByRole('button', { name: '关闭对话框' }).click()
  pass('Title and abstract translation exposes a staged progress bar and completes through a controlled API')

  await page.getByTestId('paper-card').getByRole('button', { name: '原文', exact: true }).click()
  await page.locator('.textLayer span').filter({ hasText: /Research workflow translation check/i }).first().waitFor()
  assert.equal(await page.locator('.reader-notes-panel').count(), 1)
  const readerGeometry = await page.evaluate(() => {
    const dialog = document.querySelector('.reader-dialog').getBoundingClientRect()
    const scroll = document.querySelector('.reader-scroll').getBoundingClientRect()
    const back = document.querySelector('.reader-back-button').getBoundingClientRect()
    const toolbar = document.querySelector('.reader-toolbar').getBoundingClientRect()
    return { dialogWidth: dialog.width, scrollWidth: scroll.width, ratio: scroll.width / dialog.width, backWidth: back.width, backLeft: back.left - toolbar.left }
  })
  assert.ok(readerGeometry.ratio > 0.65 && readerGeometry.ratio < 0.86, JSON.stringify(readerGeometry))
  assert.ok(readerGeometry.backWidth < 180 && readerGeometry.backLeft < 30, JSON.stringify(readerGeometry))
  await page.locator('.textLayer').evaluate((layer) => {
    const span = Array.from(layer.querySelectorAll('span')).find((node) => /Research workflow translation check/i.test(node.textContent ?? ''))
      ?? Array.from(layer.querySelectorAll('span')).find((node) => (node.textContent ?? '').trim().length > 8)
    if (!span) throw Error('No selectable text span found')
    const range = document.createRange()
    range.selectNodeContents(span)
    const selection = window.getSelection()
    selection.removeAllRanges(); selection.addRange(range)
    span.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
  })
  const palette = page.getByRole('toolbar', { name: '选择划线颜色' })
  await palette.waitFor()
  assert.deepEqual(await palette.getByRole('button').allTextContents(), ['重点', '方法', '证据', '疑问'])
  await palette.getByRole('button', { name: '方法划线' }).click()
  await waitForAsync(page, async () => {
    const result = await window.workbench.librarySnapshot()
    return result.ok && result.data.papers[0]?.highlights?.length === 1
  })
  const highlightStyle = await page.locator('.pdf-highlight.highlight-method').first().evaluate((element) => ({ left: element.style.left, top: element.style.top, width: element.style.width, background: getComputedStyle(element).backgroundColor }))
  assert.ok(highlightStyle.left && highlightStyle.top && highlightStyle.width)
  assert.match(highlightStyle.background, /rgb/)
  await screenshot('03-reader-method-highlight.png')
  pass('Document-only reader shows the four-color selection palette and paints the chosen paragraph in place')

  assert.equal(await page.getByRole('textbox', { name: '阅读笔记', exact: true }).count(), 0)
  const categories = await page.locator('.reader-category-toggle').evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect()
    return { left: bounds.left, top: bounds.top, bottom: bounds.bottom }
  }))
  assert.equal(categories.length, 4)
  assert.ok(categories.every((category, index) => category.left === categories[0].left && (!index || category.top >= categories[index - 1].bottom)))
  await page.getByRole('button', { name: '方法 1', exact: true }).click()
  assert.equal(await page.locator('.reader-annotation').count(), 0)
  await page.getByRole('button', { name: '方法 1', exact: true }).click()
  assert.equal(await page.locator('.reader-annotation').count(), 1)
  await page.getByRole('button', { name: /跳到第 1 页批注/ }).click()
  const located = page.locator('.pdf-highlight.is-located').first()
  await located.waitFor()
  const focusStyle = await located.evaluate(element => {
    const style = getComputedStyle(element)
    return { outline: style.outlineStyle, border: style.borderWidth, animations: element.getAnimations().length }
  })
  assert.deepEqual(focusStyle, { outline: 'none', border: '0px', animations: 1 })
  await located.evaluate(element => element.getAnimations().forEach(animation => animation.finish()))
  await page.getByRole('button', { name: /跳到第 1 页批注/ }).click()
  assert.equal(await located.evaluate(element => element.getAnimations().length), 1)
  await page.getByRole('button', { name: '收起批注栏', exact: true }).click()
  assert.equal(await page.locator('.reader-notes-panel').count(), 0)
  await page.getByRole('button', { name: '展开批注栏', exact: true }).click()
  await screenshot('03b-reader-annotations.png')
  pass('Four vertical categories expand and collapse; repeat locating pulses the sentence without outlines')

  await page.getByRole('button', { name: /返回文献库/ }).click()
  await app.close()
  await launch()
  await nav('文献阅读')
  await page.getByTestId('paper-card').getByRole('button', { name: '原文', exact: true }).click()
  await page.locator('.pdf-highlight.highlight-method').first().waitFor()
  assert.equal(await page.getByRole('textbox', { name: '阅读笔记', exact: true }).count(), 0)
  assert.equal(await page.evaluate(async () => {
    const result = await window.workbench.librarySnapshot()
    return result.ok && result.data.papers[0].notes
  }), '已有阅读笔记应保留。')
  assert.equal(await page.locator('.pdf-highlight.highlight-method').count(), 1)
  const restored = await page.locator('.pdf-highlight.highlight-method').first().evaluate((element) => ({ left: element.style.left, top: element.style.top, width: element.style.width }))
  assert.deepEqual(restored, { left: highlightStyle.left, top: highlightStyle.top, width: highlightStyle.width })
  pass('Colored highlights persist across an application restart with normalized page coordinates')

  await page.getByRole('button', { name: /返回文献库/ }).click()
  await nav('设置')
  await page.getByRole('button', { name: '克莱因蓝背景', exact: true }).click()
  await page.locator('.workspace-wallpaper.wallpaper-klein').waitFor()
  await page.getByRole('group', { name: '显示模式' }).getByRole('button', { name: '深色', exact: true }).click()
  const shell = await page.evaluate(() => {
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect()
    const main = document.querySelector('.main-region').getBoundingClientRect()
    const dock = document.querySelector('.dock-wrap').getBoundingClientRect()
    const bay = getComputedStyle(document.querySelector('.dock-wrap'), '::before')
    return {
      viewportHeight: innerHeight, sidebarBottom: sidebar.bottom, mainBottom: main.bottom, dockBottom: dock.bottom,
      dockOverlapsMain: dock.top < main.bottom, bayContent: bay.content,
      dockRadius: parseFloat(getComputedStyle(document.querySelector('.dock')).borderRadius),
      wallpaper: Array.from(document.querySelectorAll('.workspace-wallpaper')).map((element) => element.className).join(' ')
    }
  })
  assert.ok(Math.abs(shell.viewportHeight - shell.sidebarBottom) <= 14, JSON.stringify(shell))
  assert.ok(Math.abs(shell.viewportHeight - shell.mainBottom) <= 14, JSON.stringify(shell))
  assert.ok(Math.abs(shell.viewportHeight - shell.dockBottom) <= 1, JSON.stringify(shell))
  assert.equal(shell.dockOverlapsMain, true)
  assert.equal(shell.bayContent, 'none')
  assert.ok(shell.dockRadius > 100)
  assert.match(shell.wallpaper, /wallpaper-klein/)
  await screenshot('04-klein-dock-capsule.png')
  await page.getByRole('button', { name: '极夜黑背景', exact: true }).click()
  await screenshot('05-midnight-background.png')
  pass('Sidebar and main panel reach the bottom with a floating Dock capsule; dark backgrounds apply')

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)
  assert.equal(overflow, false)
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, readerGeometry, shell, overviewRequests, profile, executablePath: executablePath ? resolve(executablePath) : 'development', fixtureBytes: readFileSync(fixture).length }, null, 2))
  console.log('PASS reader/highlight UI smoke', evidence)
} finally {
  if (app) await app.close().catch(() => undefined)
  await new Promise((done) => server.close(done))
}
