import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/hierarchy-0.8.7', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
const page = await app.firstWindow()
const errors = [], checks = []
page.on('pageerror', error => errors.push(error.message))
const pass = name => { checks.push(name); console.log('PASS', name) }
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const capture = async name => {
  if (await page.getByTestId('publication-detail').count()) await page.waitForFunction(() => {
    const detail = document.querySelector('[data-testid="publication-detail"]')
    const cover = detail?.querySelector('.book-opening-cover')
    return detail && Math.abs(new DOMMatrixReadOnly(getComputedStyle(detail).transform).a - 1) < 0.001
      && (!cover || Number(getComputedStyle(cover).opacity) < 0.001)
  })
  return page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
}
const unwrap = async promise => { const result = await promise; assert.equal(result.ok, true, result.error?.message); return result.data }
const bounds = async (width, height) => app.evaluate(({ BrowserWindow }, size) => {
  const win = BrowserWindow.getAllWindows()[0]
  win.setContentSize(size.width, size.height); win.webContents.setBackgroundThrottling(false); win.showInactive()
}, { width, height })
const fixture = resolve('tests/fixtures/translation-check.pdf')
const publicationValues = { title: 'LCA-Net: A Lightweight Network for Small Object Detection in Road Traffic Scenes',
  authors: 'Lin Researcher, Chen Researcher', journal: 'Information', publishedDate: '2026-07-27', doi: '',
  casPartition: '4区', jcrQuartile: '', honors: [], notes: '' }
const geometry = async () => page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
  toolbarOverflow: document.querySelector('.library-toolbar')?.scrollWidth > document.querySelector('.library-toolbar')?.clientWidth + 1 }))

try {
  const runtime = await app.evaluate(({ app }) => ({ version: app.getVersion(), packaged: app.isPackaged }))
  assert.equal(runtime.version, JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version)
  assert.equal(runtime.packaged, !!executablePath)
  await bounds(1600, 1000)
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  assert.equal(await page.locator('.assistant-launcher').count(), 0)
  const librarySources = []
  for (let index = 0; index < 3; index++) {
    const path = join(profile, `library-fixture-${index}.pdf`)
    writeFileSync(path, Buffer.concat([readFileSync(fixture), Buffer.from(`\n% fixture-${index}\n`)]))
    librarySources.push(path)
  }
  await unwrap(page.evaluate(paths => window.workbench.importPapers(paths, null, false), librarySources))
  const library = await unwrap(page.evaluate(() => window.workbench.librarySnapshot()))
  for (const [index, paper] of library.papers.entries()) await unwrap(page.evaluate(({ id, patch }) => window.workbench.updatePaper(id, patch), {
    id: paper.id, patch: { title: ['All in One: A Unified Network for Hyperspectral Image Fusion',
      'Fully-Connected Transformer for Multi-Source Image Fusion',
      'Diffusion model with disentangled modulations for sharpening multispectral and hyperspectral images'][index],
    journal: ['IEEE Transactions on Geoscience and Remote Sensing', 'IEEE Transactions on Pattern Analysis and Machine Intelligence', 'Information Fusion'][index],
    authors: 'Yaoting Liu, Xinwei Cheng, Hui Li, Shenglan Luo, Bin Wang', year: '2026' }
  }))
  const date = new Date(), today = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  const localDay = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
  const last = new Date(today); last.setDate(last.getDate() - 17)
  const first = new Date(last); first.setDate(first.getDate() - 13)
  const submission = await unwrap(page.evaluate(input => window.workbench.createSubmission(input), {
    title: 'DA-MambaHSI: Dynamic Axial Mamba for Hyperspectral Image Classification', journal: 'Pattern Recognition', manuscriptId: 'PR-D-26-12083',
    stages: [{ name: 'Submitted to journal', occurredOn: localDay(first) }, { name: 'With editor', occurredOn: localDay(last) }],
    revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: ''
  }))
  await unwrap(page.evaluate(input => window.workbench.createSubmission(input), { title: 'Empty status fixture', journal: 'npj heritage science', manuscriptId: '', stages: [], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '' }))
  const future = new Date(today); future.setDate(future.getDate() + 2)
  await unwrap(page.evaluate(input => window.workbench.createSubmission(input), { title: 'Future status fixture', journal: 'Research Journal', manuscriptId: '', stages: [{ name: 'Planned', occurredOn: localDay(future) }], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '' }))
  await app.evaluate(({ dialog }, fixturePath) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [fixturePath] }) }, fixture)
  const picked = await unwrap(page.evaluate(() => window.workbench.pickPublicationPdf()))
  const publication = await unwrap(page.evaluate(({ path, values }) => window.workbench.createPublication(path, values), { path: picked, values: publicationValues }))
  const project = await unwrap(page.evaluate(() => window.workbench.createProject({ name: 'CFSSR-Net', description: '', colorKey: 'blue' })))
  const project2 = await unwrap(page.evaluate(() => window.workbench.createProject({ name: '硕士毕业论文', description: '', colorKey: 'sage' })))
  for (const [index, title] of ['修改实验描述', 'Coverletter', '修改方法', '开题报告 PPT', '拍摄高光谱'].entries()) {
    const task = await unwrap(page.evaluate(input => window.workbench.createTask(input), { title, projectId: index < 3 ? project.id : project2.id }))
    if (index === 2) await unwrap(page.evaluate(id => window.workbench.completeTask(id, true), task.id))
  }
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  for (const theme of ['dark', 'light']) {
    await page.getByRole('button', { name: theme === 'dark' ? '深色模式' : '浅色模式', exact: true }).click()
    await nav('文献阅读')
    const switcher = page.getByRole('group', { name: '文献显示方式' })
    await switcher.getByRole('button', { name: '卡片', exact: true }).click()
    await page.getByTestId('paper-card').first().waitFor()
    const alignment = await switcher.getByRole('button').evaluateAll(buttons => buttons.map(button => ({ display: getComputedStyle(button).display, whiteSpace: getComputedStyle(button).whiteSpace,
      overflowing: button.scrollWidth > button.clientWidth + 1, selected: button.getAttribute('aria-pressed') })))
    assert.ok(alignment.every(button => ['flex', 'inline-flex'].includes(button.display) && button.whiteSpace === 'nowrap' && !button.overflowing), JSON.stringify(alignment))
    assert.equal(alignment.filter(button => button.selected === 'true').length, 1)
    await capture(`01-library-cards-${theme}`)
    await switcher.getByRole('button', { name: '列表', exact: true }).click()
    await page.locator('.paper-compact-row').first().waitFor()
    assert.equal(await page.locator('.paper-list-actions').getByRole('button', { name: '翻译', exact: true }).count(), 3)
    await capture(`02-library-list-${theme}`)
    assert.equal((await geometry()).toolbarOverflow, false)
    await nav('论文投稿')
    const age = page.getByTestId('submission-card').filter({ hasText: submission.title }).locator('.submission-status-age')
    await age.waitFor(); assert.match(await age.innerText(), /最新状态距今：\s*17\s*天/)
    assert.match(await page.getByTestId('submission-card').filter({ hasText: 'Empty status fixture' }).innerText(), /暂无状态日期/)
    assert.match(await page.getByTestId('submission-card').filter({ hasText: 'Future status fixture' }).innerText(), /状态日期在\s*2\s*天后/)
    await page.getByRole('textbox', { name: '搜索投稿记录' }).fill('DA-MambaHSI')
    await capture(`03-submissions-${theme}`)
    await page.getByRole('textbox', { name: '搜索投稿记录' }).fill('')
    await nav('科研成果')
    await page.getByTestId('publication-book').first().click()
    const detail = page.getByTestId('publication-detail')
    await detail.waitFor()
    assert.deepEqual(await detail.locator('.book-detail-actions .button').allTextContents(), ['阅读论文', '翻译论文', '编辑发表信息'])
    await capture(`04-publication-${theme}`)
    await detail.getByRole('button', { name: '翻译论文', exact: true }).hover()
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.book-detail-actions .button-translation')).backgroundColor === 'rgb(217, 229, 216)')
    await detail.getByRole('button', { name: '放回书架' }).click()
  }
  pass('Light/dark cards and lists, publication actions, current/empty/future stage dates, assistant icon removal')
  await bounds(1100, 780)
  await unwrap(page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
  await page.reload()
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '18px')
  await nav('文献阅读')
  await page.getByRole('group', { name: '文献显示方式' }).getByRole('button', { name: '列表', exact: true }).click()
  await capture('05-list-narrow-18px')
  const narrow = await geometry(); assert.ok(narrow.document <= narrow.viewport + 1); assert.equal(narrow.toolbarOverflow, false)
  await nav('科研成果')
  await page.getByTestId('publication-book').first().click()
  await capture('06-publication-narrow-18px')
  const bookLayout = await page.getByTestId('publication-detail').evaluate(detail => {
    const box = detail.getBoundingClientRect(), panels = [...detail.children].filter(node => node.matches('.book-detail-preview, .book-detail-information'))
    return { widths: panels.map(node => node.getBoundingClientRect().width), buttonsFit: [...detail.querySelectorAll('.book-detail-actions .button')].every(button => {
      const bounds = button.getBoundingClientRect(); return bounds.left >= box.left && bounds.right <= box.right && bounds.bottom <= box.bottom
    }) }
  })
  assert.ok(Math.abs(bookLayout.widths[0] - bookLayout.widths[1]) < 1)
  assert.equal(bookLayout.buttonsFit, true)
  await page.getByTestId('publication-detail').getByRole('button', { name: '翻译论文', exact: true }).click()
  // An unconfigured profile opens settings instead of attempting a billable request.
  await page.getByRole('heading', { name: '文献翻译设置', exact: true }).waitFor()
  let snapshot = await unwrap(page.evaluate(() => window.workbench.librarySnapshot()))
  assert.equal(snapshot.papers.find(paper => paper.id === publication.id).translationStatus, 'idle')
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  await unwrap(page.evaluate(() => window.workbench.saveTranslationProfile({ id: 'siliconflow-api', name: 'SiliconFlow', provider: 'siliconflow', model: 'Qwen/Qwen3-8B', baseUrl: 'https://example.test/v1', apiKey: 'fake-ui-key' })))
  await unwrap(page.evaluate(() => window.workbench.setTranslationPaused(true)))
  await page.getByTestId('publication-book').first().click()
  await page.getByTestId('publication-detail').getByRole('button', { name: '翻译论文', exact: true }).click()
  await waitForAsync(page, async id => { const result = await window.workbench.librarySnapshot(); return result.ok && result.data.papers.find(paper => paper.id === id)?.translationStatus === 'queued' }, publication.id)
  await page.getByTestId('publication-book').first().click()
  const waiting = page.getByTestId('publication-detail').getByRole('button', { name: '等待翻译', exact: true })
  assert.equal(await waiting.isDisabled(), true)
  await page.getByRole('button', { name: '放回书架' }).click()
  await unwrap(page.evaluate(id => window.workbench.cancelTranslation(id), publication.id))
  snapshot = await unwrap(page.evaluate(() => window.workbench.librarySnapshot()))
  assert.equal(snapshot.papers.find(paper => paper.id === publication.id).translationStatus, 'idle')
  assert.equal(snapshot.papers.filter(paper => paper.collection === 'publication').length, 1)
  pass('18px/narrow layout, translation setup handoff, shared queue, duplicate-start prevention and cancellation')
  await bounds(1600, 1000)
  await unwrap(page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 14 })))
  await page.reload()
  await page.waitForFunction(() => getComputedStyle(document.documentElement).fontSize === '14px')
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  await page.getByRole('group', { name: '任务显示方式' }).getByRole('button', { name: '项目卡片', exact: true }).click()
  await capture('07-planner-light')
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await capture('08-planner-dark')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, narrow, isolatedData: profile, executablePath: executablePath || 'development' }, null, 2))
  console.log('PASS Hierarchy smoke', evidence)
} finally { await app.close() }
