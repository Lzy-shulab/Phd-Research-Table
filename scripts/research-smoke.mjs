import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const directory = resolve('test-results/current/research')
mkdirSync(directory, { recursive: true })
const dataDirectory = resolve(directory, `data-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: dataDirectory }
delete env.ELECTRON_RUN_AS_NODE
let app, page
const errors = [],
  checks = []
const record = (name) => {
  checks.push(name)
  console.log('PASS', name)
}
const snap = async () => {
  const result = await page.evaluate(() => window.workbench.librarySnapshot())
  assert.equal(result.ok, true)
  return result.data
}
const capture = (name) =>
  page.screenshot({ path: resolve(directory, name), animations: 'disabled', scale: 'css' })
async function launch() {
  app = await electron.launch({ args: ['.', '--seed-demo'], env })
  page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
try {
  await launch()
  await page.getByRole('button', { name: '浅色模式' }).click()
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: /^全部任务/ })
    .click()
  await page.locator('.plan-note').filter({ hasText: 'CFSSR-Net' }).waitFor()
  await capture('all-tasks-notes-light.png')
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: /^Today Plan/ })
    .click()
  assert.equal(
    await page.locator('.task-content').filter({ hasText: '准备本周导师组会' }).count(),
    1
  )
  assert.ok(await page.locator('.task-content').filter({ hasText: '回顾上次实验记录' }).count())
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: '日历', exact: true })
    .click()
  assert.ok(
    await page.getByTestId('schedule-block').filter({ hasText: '阅读近期 HSI 融合论文' }).count()
  )
  assert.ok(await page.getByTestId('schedule-block').filter({ hasText: '修改方法部分' }).count())
  assert.equal(await page.getByLabel('新计划所属项目').inputValue(), '')
  assert.match(await page.locator('.workspace-breadcrumb').innerText(), /研究计划.*日历/s)
  await capture('all-projects-calendar-light.png')
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: '全部任务', exact: false })
    .click()
  assert.ok(
    await page.getByRole('checkbox', { name: '恢复 整理基线实验结果', exact: true }).count()
  )
  await page
    .getByRole('navigation', { name: '研究计划视图' })
    .getByRole('button', { name: /^Today Plan/ })
    .click()
  assert.ok(await page.locator('.task-content').filter({ hasText: '准备本周导师组会' }).count())
  record(
    'All Tasks groups work by project notes while Today Plan and calendar combine every project'
  )

  await page
    .getByRole('navigation', { name: '科研工作空间' })
    .getByRole('button', { name: '文献阅读' })
    .click()
  await page.getByRole('heading', { name: '文献库', exact: true }).waitFor()
  await page.getByRole('button', { name: '新建文献文件夹', exact: true }).click()
  await page.getByLabel('文件夹名称', { exact: true }).fill('研究方法')
  await page.getByRole('button', { name: '保存文件夹' }).click()
  await page.getByRole('heading', { name: '研究方法', exact: true }).waitFor()
  const parent = (await snap()).folders[0]
  await page.getByRole('button', { name: '在 研究方法 下新建子文件夹', exact: true }).click()
  await page.getByLabel('文件夹名称', { exact: true }).fill('CVPR')
  await page.getByRole('button', { name: '保存文件夹' }).click()
  await page.getByRole('heading', { name: 'CVPR', exact: true }).waitFor()
  await page.getByRole('button', { name: '在 CVPR 下新建子文件夹', exact: true }).click()
  await page.getByLabel('文件夹名称', { exact: true }).fill('2026')
  await page.getByRole('button', { name: '保存文件夹' }).click()
  await page.getByRole('heading', { name: '2026', exact: true }).waitFor()
  const child = (await snap()).folders.find((f) => f.name === '2026')
  assert.ok(child)
  assert.equal(
    await page.getByRole('button', { name: '在 2026 下新建子文件夹', exact: true }).count(),
    0
  )
  record('Native UI creates explicit second- and third-level folders and stops at three levels')

  const sourceDirectory = 'D:/Desktop/我的文件/Phd Research Move/LiteratureTranslation/source'
  const sources = readdirSync(sourceDirectory)
    .filter((name) => /\.pdf$/i.test(name) && !/reviewer/i.test(name))
    .map((name) => join(sourceDirectory, name))
  const originalHashes = sources.map((path) => readFileSync(path).length)
  await app.evaluate(({ dialog }, paths) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: paths })
  }, sources)
  await page.getByRole('button', { name: '添加文献', exact: true }).click()
  await page.getByRole('switch', { name: '上传后自动翻译', exact: true }).uncheck()
  await page.getByRole('button', { name: '选择 PDF 并添加' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.waitForFunction(
    (count) => document.querySelectorAll('.pdf-cover img').length === count,
    sources.length
  )
  assert.equal((await snap()).papers.length, sources.length)
  assert.ok(
    (await snap()).papers.every(
      (paper) => paper.folderId === child.id && paper.translationStatus === 'idle'
    )
  )
  assert.deepEqual(
    sources.map((path) => readFileSync(path).length),
    originalHashes
  )
  record(
    'Batch import uses a mocked OS picker with real PDFs; originals preserved; multiple covers render'
  )
  const duplicate = await page.evaluate(
    async ({ paths, folder }) => window.workbench.importPapers(paths, folder, false),
    { paths: sources, folder: parent.id }
  )
  assert.equal(duplicate.data.added, 0)
  assert.equal(duplicate.data.duplicates, sources.length)
  assert.ok((await snap()).papers.every((p) => p.folderId === child.id))
  const invalidFile = resolve(directory, 'invalid.pdf')
  writeFileSync(invalidFile, 'This is not a PDF')
  const invalid = await page.evaluate(
    (path) => window.workbench.importPapers([path], null, false),
    invalidFile
  )
  assert.equal(invalid.data.failures.length, 1)
  record('Duplicate content stays in its existing folder; non-PDF content is rejected')

  await page.locator('.folder-name').filter({ hasText: '研究方法' }).click()
  assert.equal(await page.getByTestId('paper-card').count(), sources.length)
  await page.getByLabel('搜索文献').fill('NO_MATCH_AT_ALL')
  await page.getByRole('heading', { name: '没有找到符合条件的文献' }).waitFor()
  await page.getByRole('button', { name: '清除筛选', exact: true }).click()
  const paperId = (await snap()).papers.find((p) => p.originalName.startsWith('Li_')).id
  const first = (await snap()).papers.find((p) => p.id === paperId)
  await page.getByRole('button', { name: `编辑文献 ${first.title}`, exact: true }).click()
  await page.getByLabel('期刊 / 会议').fill('CVPR 2024')
  await page.getByLabel('年份', { exact: true }).fill('2024')
  await page.getByLabel('阅读笔记').fill('验证笔记：关注研究假设与实验设置。')
  await page.getByRole('button', { name: '保存信息' }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const firstCard = page.getByTestId('paper-card').filter({ hasText: 'CVPR 2024' })
  await firstCard.getByRole('button', { name: '原文', exact: true }).click()
  await page.waitForFunction(
    () => (document.querySelector('.textLayer')?.textContent?.length ?? 0) > 100
  )
  await page.getByRole('button', { name: '下一页文献' }).click()
  await waitForAsync(
    page,
    async (id) => {
      const r = await window.workbench.librarySnapshot()
      return r.ok && r.data.papers.find((p) => p.id === id)?.readPage === 2
    },
    paperId
  )
  await page.getByRole('button', { name: '放大文献' }).click()
  await page.getByRole('button', { name: '返回文献库' }).click()
  record(
    'Parent folder includes child documents; search, metadata, notes and second-page reading persist'
  )
  await page.getByRole('button', { name: '文献翻译设置', exact: true }).click()
  await page.getByRole('switch', { name: '默认自动翻译新文献' }).uncheck()
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '管理文件夹 2026', exact: true }).click()
  await page.getByLabel('文件夹名称', { exact: true }).fill('会议文献')
  await page.getByRole('button', { name: '保存文件夹' }).click()
  await page.getByRole('heading', { name: '会议文献', exact: true }).waitFor()
  await page
    .getByRole('navigation', { name: '文献文件夹' })
    .getByRole('button', { name: /^全部文献/ })
    .click()
  for (const close of await page.getByRole('button', { name: '关闭消息', exact: true }).all())
    await close.click()
  await capture('library-cards-light.png')
  await page.getByRole('button', { name: '深色模式' }).click()
  await capture('library-cards-dark.png')
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setBounds({ width: 1100, height: 700 })
  )
  await capture('library-minimum-dark.png')
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth > innerWidth,
    sidebar:
      document.querySelector('.sidebar').getBoundingClientRect().right >
      document.querySelector('.main-region').getBoundingClientRect().left,
    cards: Array.from(document.querySelectorAll('.paper-card')).some(
      (el) => el.scrollWidth > el.clientWidth + 1
    )
  }))
  assert.deepEqual(overflow, { document: false, sidebar: false, cards: false })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '浅色模式' }).click()
  await capture('library-minimum-light.png')
  record(
    'Light/dark and 1100x700 layouts have no document/card overflow or sidebar collision after reading; reduced-motion mode stays usable'
  )

  await app.close()
  app = null
  await launch()
  const restored = await snap()
  assert.equal(restored.autoTranslate, false)
  assert.equal(restored.folders.find((f) => f.id === child.id).name, '会议文献')
  assert.equal(restored.papers.find((p) => p.id === paperId).readPage, 2)
  assert.match(restored.papers.find((p) => p.id === paperId).notes, /验证笔记/)
  await page
    .getByRole('navigation', { name: '科研工作空间' })
    .getByRole('button', { name: '文献阅读' })
    .click()
  await page.getByRole('button', { name: '管理文件夹 会议文献', exact: true }).click()
  await page.getByRole('button', { name: '删除文件夹', exact: true }).click()
  await page
    .getByRole('dialog', { name: '删除此文件夹？', exact: true })
    .getByRole('button', { name: '删除', exact: true })
    .click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  const afterDelete = await snap()
  assert.equal(afterDelete.papers.length, sources.length)
  assert.ok(afterDelete.papers.every((p) => p.folderId === null))
  record(
    'Restart restores folder edits, preference, notes and reading position; folder deletion preserves PDFs'
  )
  assert.deepEqual(errors, [])
  writeFileSync(
    resolve(directory, 'report.json'),
    JSON.stringify({ checks, errors, dataDirectory, overflow }, null, 2)
  )
  console.log(`ALL ${checks.length} RESEARCH CHECKS PASSED`)
} catch (error) {
  await capture('failure.png').catch(() => {})
  writeFileSync(resolve(directory, 'failure.txt'), await page.locator('body').innerText())
  throw error
} finally {
  if (app) await app.close()
}
