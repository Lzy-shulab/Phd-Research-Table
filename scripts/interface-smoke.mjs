import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('验收记录/界面与翻译升级', executablePath ? 'packaged' : 'development')
mkdirSync(evidence, { recursive: true })
const root = realpathSync(tmpdir()), profile = mkdtempSync(join(root, 'workbench-interface-'))
const fixture = readFileSync(resolve('tests/fixtures/translation-check.pdf'))
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = [], layouts = []
const check = (name) => { checks.push(name); console.log('PASS', name) }
const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const hash = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')
let app, page
const nav = (name) => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const preferences = async () => unwrap(await page.evaluate(() => window.workbench.interfacePreferences()))
const library = async () => unwrap(await page.evaluate(() => window.workbench.librarySnapshot()))
const storage = () => page.evaluate(() => window.workbench.storageSnapshot())
const pick = (path) => app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: !path, filePaths: path ? [path] : [] }) }, path)
const capture = async (name) => { await page.waitForTimeout(350); return page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' }) }
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.setBounds({ width: 1440, height: 950 }) })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  assert.equal(await app.evaluate(({ app }) => app.getPath('userData')), profile)
}
async function layout(name, selectors) {
  const result = await page.evaluate((selectors) => {
    const bounds = selectors.flatMap((selector) => [...document.querySelectorAll(selector)].map((el) => {
      const rect = el.getBoundingClientRect(), style = getComputedStyle(el)
      return { selector, width: el.clientWidth, scroll: el.scrollWidth, left: rect.left, right: rect.right, overflow: style.overflowX }
    }))
    return { viewport: innerWidth, rootWidth: document.documentElement.scrollWidth, bounds }
  }, selectors)
  assert.ok(result.rootWidth <= result.viewport + 1, `${name}: root overflow`)
  for (const item of result.bounds) assert.ok(item.scroll <= item.width + 2, `${name}: ${JSON.stringify(item)}`)
  layouts.push({ name, ...result })
}
async function setFont(size, label) {
  await page.getByRole('button', { name: `${label}字号 ${size}`, exact: true }).click()
  await page.waitForFunction((size) => getComputedStyle(document.documentElement).fontSize === `${size}px`, size)
  await waitForAsync(page, async (size) => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.fontSize === size }, size)
}
async function makePublication(path, title, partition) {
  await page.getByRole('button', { name: '添加成果', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await pick(path)
  await dialog.getByRole('button', { name: '选择 PDF', exact: true }).click()
  await dialog.getByLabel('成果标题', { exact: true }).fill(title)
  await dialog.getByLabel('作者', { exact: true }).fill('测试作者')
  await dialog.getByLabel('期刊 / 会议', { exact: true }).fill('期刊分区验收')
  await dialog.getByLabel('发表时间精度').selectOption('year')
  await dialog.getByLabel('发表时间', { exact: true }).fill('2026')
  await dialog.getByLabel('期刊分区', { exact: true }).selectOption(partition)
  await dialog.getByLabel('JCR 分区', { exact: true }).selectOption('Q2')
  await dialog.getByRole('button', { name: '保存成果', exact: true }).click()
  await dialog.waitFor({ state: 'hidden' })
}
try {
  await launch()
  const paths = Array.from({ length: 7 }, (_, i) => {
    const path = join(profile, `fixture-${i}.pdf`)
    writeFileSync(path, Buffer.concat([fixture, Buffer.from(`\n% independent fixture ${i}\n`)]))
    return path
  })
  await page.evaluate(async (paths) => {
    const unwrap = (r) => { if (!r.ok) throw Error(r.error.message); return r.data }
    unwrap(await window.workbench.setMetadataOnline(false))
    unwrap(await window.workbench.importPapers(paths, null, false))
    const papers = unwrap(await window.workbench.librarySnapshot()).papers
    const names = ['Hyperspectral Image Reconstruction with Spatial and Spectral Priors', '高光谱与多光谱图像融合：方法、实验与研究笔记', 'Learning Spatial–Spectral Representations for Remote Sensing', 'Efficient Image Restoration with Structured State Space Models', 'Self-supervised Spectral Reconstruction across Multiple Scales']
    for (let i = 0; i < papers.length; i++) unwrap(await window.workbench.updatePaper(papers[i].id, { title: names[i], authors: '研究作者 · 隔离界面验收', journal: 'Research Preview', year: '2026', pageCount: 1, notes: '字号与排版检查，不含个人文献。' }))
    const today = new Date().toLocaleDateString('en-CA')
    for (let i = 0; i < 2; i++) {
      const project = unwrap(await window.workbench.createProject({ name: ['高光谱图像重建', '论文写作与修改'][i], description: '隔离验收', colorKey: ['blue', 'sage'][i] }))
      unwrap(await window.workbench.createTask({ title: ['整理实验结果与方法图', '核对期刊与参考文献'][i], projectId: project.id, scheduledDate: today, startTime: ['09:17', '10:05'][i], endTime: ['10:43', '11:38'][i] }))
    }
  }, paths.slice(0, 5))
  await page.reload()
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await nav('科研成果')
  await makePublication(paths[5], '原有分区保留验证', '1区')
  await makePublication(paths[6], '新增期刊类型验证', 'EI')
  assert.equal(await page.getByText('期刊分区 EI', { exact: true }).count(), 1)
  const publicationBefore = (await library()).papers.find((paper) => paper.title === '新增期刊类型验证')
  for (const value of ['中文核心', '大学学报']) {
    await page.getByRole('button', { name: '编辑成果 新增期刊类型验证', exact: true }).click()
    await page.getByLabel('期刊分区', { exact: true }).selectOption(value)
    await page.getByRole('button', { name: '保存成果', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'hidden' })
    const saved = (await library()).papers.find((paper) => paper.id === publicationBefore.id)
    assert.equal(saved.casPartition, value); assert.equal(saved.jcrQuartile, 'Q2')
    assert.equal(saved.sourcePath, publicationBefore.sourcePath); assert.equal(hash(saved.sourcePath), hash(paths[6]))
  }
  assert.equal((await library()).papers.find((p) => p.title === '原有分区保留验证').casPartition, '1区')
  check('EI, 中文核心 and 大学学报 save through the dialog; existing 1区, JCR and source PDF paths are preserved')
  const libraryBefore = (await library()).papers, plannerBefore = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  const storageBefore = await storage(), sourceHashes = paths.map(hash)
  await nav('设置')
  assert.equal((await preferences()).preferences.fontSize, 14)
  for (const [value, label] of [['mist', '晨雾'], ['sage', '青绿'], ['dusk', '暮色'], ['default', '默认']]) {
    await page.getByRole('button', { name: `${label}背景`, exact: true }).click()
    await page.waitForFunction((value) => document.documentElement.dataset.background === value, value)
    await waitForAsync(page, async (value) => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.background === value }, value)
  }
  for (const [size, label] of [[13, '较小'], [14, '默认'], [16, '较大'], [18, '特大']]) await setFont(size, label)
  await page.getByRole('group', { name: '显示模式' }).getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await capture('settings-dark-18')
  check('Four built-in backgrounds, all four text sizes and light/dark appearance apply and persist immediately')

  const images = await page.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 1600; canvas.height = 1000
    const ctx = canvas.getContext('2d'), gradient = ctx.createLinearGradient(0, 0, 1600, 1000)
    gradient.addColorStop(0, '#bad8d0'); gradient.addColorStop(0.5, '#b4bdd8'); gradient.addColorStop(1, '#dac1bb')
    ctx.fillStyle = gradient; ctx.fillRect(0, 0, 1600, 1000)
    ctx.fillStyle = '#ffffff70'; ctx.beginPath(); ctx.arc(300, 350, 230, 0, Math.PI * 2); ctx.fill()
    return { png: canvas.toDataURL('image/png'), jpg: canvas.toDataURL('image/jpeg') }
  })
  for (const [extension, url] of Object.entries(images)) writeFileSync(join(profile, `background.${extension}`), Buffer.from(url.split(',')[1], 'base64'))
  const imageHashes = Object.keys(images).map((ext) => hash(join(profile, `background.${ext}`)))
  for (const extension of Object.keys(images)) {
    await pick(join(profile, `background.${extension}`))
    await page.getByRole('button', { name: '上传背景', exact: true }).click()
    await waitForAsync(page, async (extension) => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.backgroundName === `background.${extension}` }, extension, 5000)
    assert.equal((await preferences()).preferences.background, 'custom')
  }
  assert.deepEqual(Object.keys(images).map((ext) => hash(join(profile, `background.${ext}`))), imageHashes)
  const custom = await preferences()
  assert.match(custom.backgroundDataUrl, /^data:image\/jpeg;base64,/)
  await pick(null); await page.getByRole('button', { name: '上传背景', exact: true }).click()
  await page.waitForFunction(() => !document.querySelector('.appearance-feedback')?.textContent.includes('正在保存'))
  assert.deepEqual(await preferences(), custom)
  const invalid = join(profile, 'invalid.png'); writeFileSync(invalid, 'not an image')
  await pick(invalid); await page.getByRole('button', { name: '上传背景', exact: true }).click()
  await page.getByText('这张图片无法读取，请换一张图片。', { exact: true }).waitFor()
  assert.deepEqual(await preferences(), custom)
  assert.equal((await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 90 }))).ok, false)
  assert.equal((await page.evaluate(() => window.workbench.updateInterfacePreferences({ backgroundFile: '../bad.jpg' }))).ok, false)
  check('PNG and JPG uploads work; cancellation and unreadable images preserve preferences; original images are byte-identical')

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 700 }))
  await page.getByRole('button', { name: '自定义背景', exact: true }).click()
  await page.locator('.settings-workspace').evaluate((el) => { el.scrollTop = 0 })
  await capture('settings-custom-minimum-dark-18')
  await layout('settings-18', ['.main-region', '.settings-body', '.appearance-card', '.font-size-options', '.storage-row'])
  await page.getByRole('group', { name: '显示模式' }).getByRole('button', { name: '浅色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'light')
  await capture('settings-custom-minimum-light-18')
  await page.getByRole('button', { name: '特大字号 18', exact: true }).scrollIntoViewIfNeeded()
  await capture('settings-type-minimum-light-18')
  await nav('文献阅读')
  await page.locator('.paper-card .pdf-cover img').first().waitFor()
  assert.equal(await page.locator('.paper-card').count(), 5)
  await layout('library-18', ['.main-region', '.library-toolbar', '.paper-grid', '.paper-card'])
  await capture('library-minimum-light-18')
  await nav('科研成果')
  await layout('outputs-18', ['.main-region', '.publication-grid', '.publication-card'])
  await capture('outputs-minimum-light-18')
  await page.getByRole('button', { name: '编辑成果 新增期刊类型验证', exact: true }).click()
  assert.equal(await page.getByLabel('期刊分区', { exact: true }).inputValue(), '大学学报')
  await page.getByLabel('期刊分区', { exact: true }).scrollIntoViewIfNeeded()
  await layout('publication-dialog-18', ['.publication-dialog', '.publication-dialog form'])
  await capture('publication-partitions-minimum-18')
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await nav('论文投稿')
  await layout('submissions-18', ['.main-region', '.submission-toolbar'])
  await capture('submissions-minimum-light-18')
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: '日历', exact: true }).click()
  await page.locator('.calendar-view').waitFor()
  await layout('calendar-18', ['.main-region', '.workspace-header', '.quick-capture'])
  await capture('calendar-minimum-light-18')
  check('Minimum 1100×700 window supports large text across settings, library, outputs, publication dialog, submissions and calendar without horizontal overflow')

  await nav('设置')
  await setFont(14, '默认')
  await page.getByRole('button', { name: '恢复默认背景', exact: true }).click()
  await waitForAsync(page, async () => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.background === 'default' })
  await page.getByRole('button', { name: '自定义背景', exact: true }).click()
  await page.evaluate(() => {
    for (const label of ['特大字号 18', '较小字号 13', '较大字号 16']) document.querySelector(`[aria-label="${label}"]`).click()
  })
  await waitForAsync(page, async () => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.fontSize === 16 && r.data.preferences.background === 'custom' })
  const persisted = await preferences()
  assert.deepEqual(await storage(), storageBefore)
  assert.deepEqual((await library()).papers, libraryBefore)
  const plannerAfter = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.deepEqual(plannerAfter.tasks, plannerBefore.tasks); assert.deepEqual(plannerAfter.projects, plannerBefore.projects)
  assert.deepEqual(paths.map(hash), sourceHashes)
  unlinkSync(join(profile, 'background.jpg'))
  await app.close(); app = null
  await launch()
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '16px')
  assert.deepEqual(await preferences(), persisted)
  assert.deepEqual(await storage(), storageBefore)
  assert.deepEqual((await library()).papers, libraryBefore)
  await nav('文献阅读')
  await capture('library-custom-restart-16')
  check('Rapid font changes keep the last choice; custom wallpaper survives source removal and restart; all saved papers, tasks, projects and storage paths remain unchanged')
  await nav('设置'); await setFont(14, '默认')
  await page.getByRole('group', { name: '显示模式' }).getByRole('button', { name: '深色', exact: true }).click()
  await nav('文献阅读')
  await page.waitForFunction(() => [...document.querySelectorAll('.paper-card .pdf-cover img')].filter((image) => image.complete && image.naturalWidth > 0).length === 5)
  await capture('library-custom-dark-14')
  const readerGeometry = async () => {
    await page.getByRole('button', { name: '原文', exact: true }).first().click()
    await page.locator('.textLayer span').first().waitFor()
    return page.locator('.pdf-page').evaluate((el) => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height, textSize: getComputedStyle(el.querySelector('.textLayer span')).fontSize }))
  }
  const normalPdf = await readerGeometry()
  await page.getByRole('button', { name: '返回文献库', exact: true }).click()
  await nav('设置'); await setFont(18, '特大'); await nav('文献阅读')
  assert.deepEqual(await readerGeometry(), normalPdf)
  await capture('reader-dark-18')
  await page.getByRole('button', { name: '返回文献库', exact: true }).click()
  check('Changing interface text size leaves PDF page geometry and its selectable text layer unchanged')
  await nav('设置'); await setFont(14, '默认'); await nav('文献阅读')
  await page.getByRole('button', { name: /^Arxiv Daily/ }).click()
  await capture('arxiv-custom-dark-14')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), true)
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, layouts, packaged: !!executablePath, isolated: true, boundary: 'Real Electron IPC, image decoding, PDF import, persistence and rendered UI. The native file picker is stubbed. Test PDFs and backgrounds are synthetic.' }, null, 2))
  console.log(`ALL ${checks.length} INTERFACE CHECKS PASSED`)
} catch (error) {
  await capture('failure').catch(() => {})
  throw error
} finally {
  if (app) await app.close()
  const target = realpathSync(profile)
  if (dirname(target) === root && basename(target).startsWith('workbench-interface-')) rmSync(target, { recursive: true, force: true })
}
