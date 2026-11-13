import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const executable = process.argv.find(arg => arg.startsWith('--executable='))?.slice(13)
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-results/desktop-refinement/ui')
const profile = join(output, `profile-${Date.now()}`)
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', WORKBENCH_DISABLE_LEGACY_TRANSLATION_ENGINE: '1' }
delete env.ELECTRON_RUN_AS_NODE
let app, panel
const errors = [], checks = [], layouts = []
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
const pass = message => { checks.push(message); console.log('PASS', message) }
const waitForSavedPage = async (main, id, field, page) => {
  for (let index = 0; index < 100; index++) {
    const snapshot = unwrap(await main.evaluate(() => window.workbench.librarySnapshot()))
    if (snapshot.papers.find(paper => paper.id === id)?.[field] === page) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Reading position was not saved: ${field} ${page}`)
}
const start = async () => {
  app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
  app.context().setDefaultTimeout(15000)
  for (const page of app.windows()) page.on('pageerror', error => errors.push(error.message))
  app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
}
const pageWith = async text => {
  for (let index = 0; index < 150; index++) {
    const page = app.windows().find(page => page.url().includes(text))
    if (page) return page
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Missing ${text}`)
}
const layout = async kind => {
  await panel.waitForTimeout(450)
  const result = await panel.evaluate(() => {
    const rect = selector => { const value = document.querySelector(selector).getBoundingClientRect(); return { top: value.top, bottom: value.bottom, left: value.left, right: value.right } }
    return { width: innerWidth, height: innerHeight, header: rect('.desktop-header'), content: rect('.desktop-panel-content'), footer: rect('.desktop-panel-footer'), overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.equal(result.overflow, false)
  assert.ok(result.header.top >= -1 && result.header.bottom <= result.content.top + 1)
  assert.ok(result.content.bottom <= result.footer.top + 1)
  assert.ok(result.footer.bottom <= result.height + 1)
  assert.ok(result.footer.right <= result.width + 1)
  layouts.push({ kind, ...result })
  await panel.screenshot({ path: join(output, `${kind}.png`), scale: 'css' })
}
function pdf(label) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R 5 0 R 7 0 R] /Count 3 >>']
  for (let page = 1; page <= 3; page++) {
    const text = `BT /F1 18 Tf 60 740 Td (${label} page ${page}) Tj ET`
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 9 0 R >> >> /Contents ${page * 2 + 2} 0 R >>`, `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`)
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let value = '%PDF-1.4\n'
  const offsets = [0]
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(value)); value += `${index + 1} 0 obj\n${object}\nendobj\n` })
  const start = Buffer.byteLength(value)
  return value + `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('') + `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF`
}

try {
  await start()
  let rail = await pageWith('rail.html')
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = function () { globalThis.railContextMenu = this } })
  await rail.locator('#workbench').click({ button: 'right' })
  await app.evaluate(() => globalThis.railContextMenu.getMenuItemById('manage-shortcuts').click())
  panel = await pageWith('panel=more')
  assert.equal(app.windows().length, 2)
  for (let index = 0; index < 3; index++) await panel.getByRole('button', { name: '上移论文阅读', exact: true }).click()
  await panel.getByRole('switch', { name: '在桌面显示GPU 监控', exact: true }).uncheck()
  await panel.getByRole('switch', { name: '在桌面显示Codex 额度', exact: true }).uncheck()
  await panel.getByRole('button', { name: '完成', exact: true }).waitFor({ state: 'visible' })
  await panel.waitForFunction(() => !document.querySelector('.desktop-more-list input:disabled'))
  const preferences = unwrap(await panel.evaluate(() => window.workbench.widgetSnapshot())).preferences
  assert.equal(preferences.railOrder[0], 'reading')
  assert.deepEqual(preferences.hiddenPanels, ['gpu', 'codex'])
  assert.deepEqual(await rail.locator('#rail-shortcuts button:visible').evaluateAll(buttons => buttons.map(button => button.dataset.panel)), ['reading', 'checkin', 'tasks', 'submissions'])
  await layout('more-manage')
  await rail.screenshot({ path: join(output, 'rail.png'), scale: 'css' })
  await panel.getByRole('button', { name: '完成', exact: true }).click()
  await rail.locator('#workbench').click({ button: 'right' })
  await app.evaluate(() => globalThis.railContextMenu.getMenuItemById('open-codex').click())
  await panel.getByRole('button', { name: '刷新额度', exact: true }).waitFor()
  pass('ordering and visibility update the rail; hidden quota remains reachable through the context menu')

  unwrap(await rail.evaluate(() => window.workbench.openWorkbench()))
  const main = await pageWith('index.html')
  await main.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const boot = unwrap(await main.evaluate(() => window.workbench.bootstrap()))
  assert.ok(resolve(boot.databasePath).startsWith(profile + '\\'))
  const first = unwrap(await main.evaluate(() => window.workbench.createProject({ name: '高光谱融合', description: '', colorKey: 'sage' })))
  const second = unwrap(await main.evaluate(() => window.workbench.createProject({ name: '论文写作', description: '', colorKey: 'blue' })))
  const today = await main.evaluate(() => new Date().toLocaleDateString('en-CA'))
  for (let index = 0; index < 18; index++) unwrap(await main.evaluate(input => window.workbench.createTask(input), { title: `融合实验 ${index + 1}`, projectId: first.id, scheduledDate: today }))
  unwrap(await main.evaluate(input => window.workbench.createTask(input), { title: '写作讨论提纲', projectId: second.id, scheduledDate: today }))
  unwrap(await main.evaluate(input => window.workbench.createTask(input), { title: '整理待安排材料', projectId: second.id, scheduledDate: null }))
  unwrap(await main.evaluate(() => window.workbench.createSubmission({ title: '跨场景高光谱图像融合方法', journal: 'IEEE Transactions on Geoscience and Remote Sensing', manuscriptId: 'TGRS-2026-1042', stages: [{ name: '已投稿', occurredOn: '2026-10-12' }, { name: '大修', occurredOn: '2026-11-01' }], revisionDueDate: '2026-11-12', reminderEnabled: false, reminderDays: 7, notes: '补充跨场景实验。' })))
  const folder = unwrap(await main.evaluate(() => window.workbench.createFolder({ name: '遥感论文', parentId: null })))
  const source = join(output, 'fusion-study.pdf'), other = join(output, 'classification-study.pdf')
  writeFileSync(source, pdf('Research fusion')); writeFileSync(other, pdf('Spectral classification'))
  unwrap(await main.evaluate(({ source, other, folderId }) => window.workbench.importPapers([source, other], folderId, false), { source, other, folderId: folder.id }))
  let library = unwrap(await main.evaluate(() => window.workbench.librarySnapshot()))
  const readingPaper = library.papers.find(paper => paper.originalName === 'fusion-study.pdf')
  const otherPaper = library.papers.find(paper => paper.originalName === 'classification-study.pdf')
  assert.ok(readingPaper && otherPaper)
  const translated = join(dirname(readingPaper.sourcePath), 'bilingual.pdf')
  assert.ok(translated.startsWith(profile + '\\'))
  copyFileSync(source, translated)
  unwrap(await main.evaluate(id => window.workbench.updatePaper(id, { title: '高光谱图像融合方法', authors: 'Lin Yu', tags: ['遥感', '融合'] }), readingPaper.id))
  unwrap(await main.evaluate(id => window.workbench.updatePaper(id, { title: 'Spectral Classification', authors: 'Liu Q', tags: ['分类'] }), otherPaper.id))
  const db = new DatabaseSync(boot.databasePath)
  db.prepare('UPDATE papers SET translated_path=?, translation_status=? WHERE id=?').run(translated, 'ready', readingPaper.id)
  db.close()
  unwrap(await main.evaluate(() => window.workbench.returnToDesktop()))

  unwrap(await rail.evaluate(() => window.workbench.openDesktopPanel('tasks')))
  await panel.getByRole('tab', { name: '今天', exact: true }).waitFor()
  await panel.getByLabel('任务所属项目', { exact: true }).selectOption(first.id)
  await panel.getByText('融合实验 1', { exact: true }).waitFor()
  assert.equal(await panel.getByText('写作讨论提纲', { exact: true }).count(), 0)
  const beforeScroll = await panel.locator('.desktop-panel-footer').boundingBox()
  await panel.locator('.desktop-list').evaluate(element => { element.scrollTop = element.scrollHeight })
  assert.deepEqual(await panel.locator('.desktop-panel-footer').boundingBox(), beforeScroll)
  await layout('tasks-long-list')
  await panel.getByLabel('任务所属项目', { exact: true }).selectOption(second.id)
  await panel.getByText('写作讨论提纲', { exact: true }).waitFor()
  assert.equal(await panel.getByText('融合实验 1', { exact: true }).count(), 0)
  await panel.getByLabel('新任务', { exact: true }).fill('修改论文图注')
  await panel.getByRole('button', { name: '创建任务', exact: true }).click()
  await panel.getByText('修改论文图注', { exact: true }).waitFor()
  const created = unwrap(await panel.evaluate(() => window.workbench.desktopTasks())).tasks.find(task => task.title === '修改论文图注')
  assert.equal(created.projectId, second.id)
  await panel.getByRole('checkbox', { name: '完成 修改论文图注', exact: true }).check()
  await panel.locator('.desktop-task.is-done').getByText('修改论文图注', { exact: true }).waitFor()
  await panel.getByRole('tab', { name: '待安排', exact: true }).click()
  await panel.getByText('整理待安排材料', { exact: true }).waitFor()
  await panel.getByLabel('任务所属项目', { exact: true }).selectOption('all')
  assert.equal(await panel.getByRole('button', { name: '创建任务', exact: true }).isDisabled(), true)
  pass('project selection filters tasks and counts, new tasks use that project, and the footer stays fixed while scrolling')

  unwrap(await rail.evaluate(() => window.workbench.openDesktopPanel('reading')))
  await panel.getByLabel('搜索论文', { exact: true }).fill('遥感 LIN')
  await panel.getByRole('button', { name: '高光谱图像融合方法', exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: 'Spectral Classification', exact: true }).count(), 0)
  await panel.getByLabel('搜索论文', { exact: true }).fill('CLASSIFICATION')
  await panel.getByRole('button', { name: 'Spectral Classification', exact: true }).waitFor()
  assert.equal(await panel.getByRole('button', { name: '高光谱图像融合方法', exact: true }).count(), 0)
  await panel.getByLabel('搜索论文', { exact: true }).fill('不存在的检索词')
  await panel.getByText('没有匹配的论文', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '清空论文搜索', exact: true }).click()
  await panel.getByRole('button', { name: '展开目录', exact: true }).click()
  await panel.getByRole('button', { name: '遥感论文', exact: true }).click()
  await panel.getByRole('button', { name: '收起目录', exact: true }).click()
  await panel.getByRole('button', { name: '高光谱图像融合方法', exact: true }).click()
  await main.getByLabel('文献页码', { exact: true }).waitFor()
  await main.locator('.pdf-page[data-rendered=true]').waitFor()
  await main.getByLabel('文献页码', { exact: true }).fill('3')
  await main.getByLabel('文献页码', { exact: true }).press('Enter')
  await main.locator('.pdf-page[aria-label="第 3 页"][data-rendered=true]').waitFor()
  await waitForSavedPage(main, readingPaper.id, 'translatedReadPage', 3)
  await main.getByRole('button', { name: '返回文献库', exact: true }).click()
  await panel.getByRole('button', { name: '继续上次阅读', exact: true }).waitFor()
  await panel.getByText('中英对照 · 第 3 页', { exact: true }).waitFor()
  await layout('reading-resume')
  await panel.getByRole('button', { name: '继续上次阅读', exact: true }).click()
  await main.getByLabel('文献页码', { exact: true }).waitFor()
  assert.equal(await main.getByLabel('文献页码', { exact: true }).inputValue(), '3')
  assert.equal(await main.getByRole('button', { name: '中英对照', exact: true }).getAttribute('aria-pressed'), 'true')
  await main.getByRole('button', { name: '原文', exact: true }).click()
  await main.locator('.pdf-page[data-rendered=true]').waitFor()
  await main.getByLabel('文献页码', { exact: true }).fill('2')
  await main.getByLabel('文献页码', { exact: true }).press('Enter')
  await main.locator('.pdf-page[aria-label="第 2 页"][data-rendered=true]').waitFor()
  await waitForSavedPage(main, readingPaper.id, 'readPage', 2)
  await main.getByRole('button', { name: '返回文献库', exact: true }).click()
  await panel.getByText('原文 · 第 2 页', { exact: true }).waitFor()
  pass('search combines metadata and folder scope; Continue restores the exact original or translated page')

  for (const kind of ['checkin', 'submissions', 'gpu', 'codex', 'more']) {
    unwrap(await rail.evaluate(kind => window.workbench.openDesktopPanel(kind), kind))
    await panel.getByRole('button', { name: '收起面板', exact: true }).waitFor()
    if (kind === 'submissions') await panel.getByRole('button', { name: '跨场景高光谱图像融合方法', exact: true }).click()
    await layout(kind)
  }
  unwrap(await panel.evaluate(() => window.workbench.updateWidgetPreferences({ scale: .8 })))
  await layout('more-scaled')
  unwrap(await panel.evaluate(() => window.workbench.updateWidgetPreferences({ scale: null })))
  pass('all seven panels share fixed headers and footers with a scrollable middle at normal and reduced scale')

  await app.close(); app = null
  await start(); rail = await pageWith('rail.html')
  const restored = unwrap(await rail.evaluate(() => window.workbench.widgetSnapshot())).preferences
  assert.deepEqual(restored.railOrder, preferences.railOrder)
  assert.deepEqual(restored.hiddenPanels, preferences.hiddenPanels)
  unwrap(await rail.evaluate(() => window.workbench.openDesktopPanel('reading')))
  panel = await pageWith('panel=reading')
  await panel.getByText('原文 · 第 2 页', { exact: true }).waitFor()
  await panel.getByRole('button', { name: '继续上次阅读', exact: true }).click()
  const reopened = await pageWith('index.html')
  await reopened.getByLabel('文献页码', { exact: true }).waitFor()
  assert.equal(await reopened.getByLabel('文献页码', { exact: true }).inputValue(), '2')
  assert.equal(await reopened.getByRole('button', { name: '原文', exact: true }).getAttribute('aria-pressed'), 'true')
  library = unwrap(await reopened.evaluate(() => window.workbench.librarySnapshot()))
  assert.equal(library.papers.find(paper => paper.id === readingPaper.id).translatedReadPage, 3)
  pass('a fresh process retains rail customization and both versions of the reading position')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, layouts, errors }, null, 2))
} catch (error) {
  console.error('SMOKE_FAILURE', String(error), errors)
  const reader = app?.windows().find(page => page.url().includes('index.html'))
  if (reader) { console.error(await reader.locator('.reader-message').allTextContents()); await reader.screenshot({ path: join(output, 'reader-failure.png') }).catch(() => {}) }
  if (panel && !panel.isClosed()) await panel.screenshot({ path: join(output, 'failure.png'), scale: 'css' }).catch(() => {})
  throw error
} finally { if (app) await app.close() }
