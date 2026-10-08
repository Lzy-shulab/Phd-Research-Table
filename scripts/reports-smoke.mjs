import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// All synthetic rows, files, requests and preferences live in an isolated workspace.
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const expectedVersion = JSON.parse(readFileSync(resolve('package.json'), 'utf8')).version
const evidence = resolve(`test-results/research-${expectedVersion}`, executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const localDay = value => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const today = localDay(new Date()), checks = [], errors = [], layouts = []
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
const candidate = index => ({ id: `2609.2000${index}`, arxivId: `2609.2000${index}`, pdfId: `2609.2000${index}v1`, title: `Hyperspectral image synthetic candidate ${index}`, authors: 'Fixture Author', abstract: 'Synthetic hyperspectral image research abstract for isolated decision and download verification. This is a fixture and contains no private data.', journal: '', doi: '', publishedDate: today, matchReason: '匹配：hyperspectral image', favorite: false, ignored: false })
let app, page
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), expectedVersion)
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1050); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
}
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
try {
  await launch()
  const initial = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  const research = unwrap(await page.evaluate(() => window.workbench.createProject({ name: '材料实验', description: '', colorKey: 'sage' })))
  const personal = unwrap(await page.evaluate(() => window.workbench.createProject({ name: '家教', description: '', colorKey: 'blue' })))
  for (const projectId of [research.id, research.id, research.id, personal.id]) {
    const task = unwrap(await page.evaluate(projectId => window.workbench.createTask({ title: 'Fixture completed task', projectId }), projectId))
    unwrap(await page.evaluate(id => window.workbench.completeTask(id, true), task.id))
  }
  const group = randomUUID()
  for (let round = 0; round < 2; round++) unwrap(await page.evaluate(({ group, today, round }) => window.workbench.createSubmission({ title: 'Fixture submission', journal: `Fixture Journal ${round}`, manuscriptId: '', stages: [{ name: 'Submitted to journal', occurredOn: today }], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '', manuscriptGroupId: group }), { group, today, round }))
  unwrap(await page.evaluate(today => window.workbench.createSubmission({ title: 'Fixture preparation', journal: 'Draft Journal', manuscriptId: '', stages: [{ name: '准备投稿', occurredOn: today }], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '' }), today))
  await app.close()
  const database = new DatabaseSync(initial.databasePath)
  database.prepare('INSERT INTO app_settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('arxiv.candidates.v1', JSON.stringify([1, 2, 3].map(candidate)))
  const paperId = randomUUID(), publicationId = randomUUID(), source = join(profile, 'fixture.pdf')
  writeFileSync(source, '%PDF-1.7\nSynthetic fixture\n%%EOF')
  database.prepare('INSERT INTO papers(id,collection,title,original_name,source_path,sha256,reading_status,published_date,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(paperId, 'library', 'Fixture already read paper', 'fixture.pdf', source, randomUUID(), 'done', '', new Date().toISOString(), new Date().toISOString())
  database.prepare('INSERT INTO papers(id,collection,title,original_name,source_path,sha256,reading_status,published_date,added_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(publicationId, 'publication', 'Fixture publication', 'fixture.pdf', source, randomUUID(), 'unread', today, new Date().toISOString(), new Date().toISOString())
  database.close()
  await launch()
  await nav('文献阅读'); await page.getByRole('button', { name: /^Arxiv Daily/ }).click()
  await app.evaluate(({ session }) => {
    const network = session.fromPartition('workbench-research')
    globalThis.__fixturePdfCalls = []
    network.fetch = async (url, options) => {
      globalThis.__fixturePdfCalls.push(url)
      if (url.includes('20001')) await new Promise((done, reject) => { globalThis.__releaseFixturePdf = done; options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) })
      return new Response(`%PDF-1.7\n${url}\n%%EOF`, { headers: { 'Content-Type': 'application/pdf' } })
    }
  })
  const cards = page.locator('.arxiv-candidate-list article')
  await cards.nth(0).getByRole('button', { name: '收藏', exact: true }).click()
  await cards.nth(0).getByText('正在下载', { exact: true }).waitFor()
  assert.equal(await cards.nth(1).getByRole('button', { name: '收藏', exact: true }).isEnabled(), true)
  await cards.nth(1).getByRole('button', { name: '收藏', exact: true }).click()
  await cards.nth(1).getByText('等待下载', { exact: true }).waitFor()
  await cards.nth(2).getByRole('button', { name: '忽略', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.arxiv-candidate-list article').length === 2)
  assert.equal(await page.getByText('点击卡片查看中英摘要', { exact: true }).count(), 0)
  await shot('independent-candidate-downloads')
  await app.evaluate(() => globalThis.__releaseFixturePdf())
  await page.waitForFunction(() => document.querySelectorAll('.arxiv-candidate-list article').length === 0, null, { timeout: 20000 })
  assert.equal(unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers.filter(p => p.collection === 'arxiv').length, 2)
  assert.equal((await app.evaluate(() => globalThis.__fixturePdfCalls)).length, 2)
  pass('Other cards remain interactive during download; favorites queue and ignored cards never download')

  await nav('研究计划'); await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  const before = unwrap(await page.evaluate(() => window.workbench.bootstrap())).tasks.length
  await page.locator('.important-countdowns').getByRole('button', { name: '设置', exact: true }).click()
  await page.getByLabel('倒计时名称', { exact: true }).fill('实验验收与研究里程碑')
  const future = new Date(); future.setDate(future.getDate() + 12)
  await page.getByLabel('倒计时截止时间', { exact: true }).fill(`${localDay(future)}T18:30`)
  await page.getByRole('button', { name: '添加倒计时', exact: true }).click()
  await page.getByText('实验验收与研究里程碑', { exact: true }).waitFor()
  await page.getByRole('dialog').getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(unwrap(await page.evaluate(() => window.workbench.bootstrap())).tasks.length, before)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.countdowns())).length, 1)
  await shot('independent-countdown')
  pass('Countdown form saves independently without changing ordinary tasks')

  await nav('研究报表'); await page.getByRole('heading', { name: '研究报表', exact: true }).waitFor()
  await page.getByRole('button', { name: '目标与项目', exact: true }).click()
  await page.locator('.report-project-options').getByLabel('材料实验', { exact: true }).check()
  for (const [label, value] of [['每月读完论文目标', '5'], ['每月完成任务目标', '10'], ['每月打卡时长目标', '40']]) await page.getByLabel(label, { exact: true }).fill(value)
  await page.getByRole('button', { name: '保存目标与项目', exact: true }).click()
  await page.locator('.report-settings').waitFor({ state: 'hidden' })
  const settings = unwrap(await page.evaluate(() => window.workbench.researchReport())).settings
  assert.deepEqual(settings.projectIds, [research.id]); assert.equal(settings.goals.month.checkinMinutes, 2400)
  await page.locator('.report-reading-dates summary').click()
  await page.getByLabel('已读论文日期记录', { exact: true }).selectOption(paperId)
  await page.getByLabel('读完日期', { exact: true }).fill(today)
  await page.getByRole('button', { name: '保存读完日期', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.report-goal')[1].innerText.includes('1 篇'))
  await page.getByRole('button', { name: '登记打卡', exact: true }).click()
  await page.getByLabel('打卡开始时间', { exact: true }).fill('09:00'); await page.getByLabel('打卡结束时间', { exact: true }).fill('11:30')
  await page.getByLabel('打卡备注', { exact: true }).fill('材料实验与论文阅读')
  await page.getByRole('button', { name: '保存打卡', exact: true }).click(); await page.locator('#report-checkins .report-entry-form').waitFor({ state: 'hidden' })
  assert.ok((await page.locator('.report-checkin-totals').innerText()).includes('2 小时 30 分钟'))
  await page.getByRole('button', { name: '登记津贴', exact: true }).click()
  await page.getByLabel('津贴金额', { exact: true }).fill('1500.25'); await page.getByLabel('津贴来源', { exact: true }).fill('助研津贴')
  await page.getByRole('button', { name: '保存津贴', exact: true }).click(); await page.locator('#report-finance .report-entry-form').waitFor({ state: 'hidden' })
  assert.ok((await page.locator('.report-finance-total').innerText()).includes('1,500.25'))
  const goals = await page.locator('.report-goal').allInnerTexts()
  assert.equal(goals.length, 3); assert.ok(goals[0].includes('3 项')); assert.ok(goals[1].includes('1 篇')); assert.ok(goals[2].includes('2 小时 30 分钟'))
  assert.equal(unwrap(await page.evaluate(() => window.workbench.bootstrap())).tasks.length, before)
  await page.locator('.reports-body').evaluate(element => { element.scrollTop = 0 })
  await shot('reports-overview-light')
  pass('Research projects, historical reading, yearly cash and weekly/monthly interval hours agree')

  for (const width of [1100, 1600, 2048]) for (const fontSize of [14, 18]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 1050), width)
    unwrap(await page.evaluate(({ width, fontSize }) => window.workbench.updateInterfacePreferences({ background: width === 1100 ? 'pink' : 'orange', fontSize }), { width, fontSize }))
    unwrap(await page.evaluate(width => window.workbench.setAppearance(width === 1600 ? 'dark' : 'light'), width))
    await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor(); await nav('研究报表')
    await page.getByRole('heading', { name: '阅读与任务趋势', exact: true }).waitFor()
    await page.locator('.reports-body').evaluate(element => { element.scrollTop = 0 })
    await page.waitForTimeout(300)
    const geometry = await page.evaluate(() => {
      const root = document.querySelector('.reports-body'), dock = document.querySelector('.dock'), goal = document.querySelector('.report-goals')
      const r = root.getBoundingClientRect(), d = dock.getBoundingClientRect()
      return { width: innerWidth, documentWidth: document.documentElement.scrollWidth, reportWidth: root.clientWidth, reportScroll: root.scrollWidth, goalWidth: goal.clientWidth, goalScroll: goal.scrollWidth, dockLeft: d.left, dockRight: d.right, reportRight: r.right, fontSize: parseFloat(getComputedStyle(document.documentElement).fontSize), theme: document.documentElement.dataset.theme, headingSize: parseFloat(getComputedStyle(document.querySelector('.reports-workspace h1')).fontSize) }
    })
    assert.ok(geometry.documentWidth <= width + 1 && geometry.reportScroll <= geometry.reportWidth + 1 && geometry.goalScroll <= geometry.goalWidth + 1 && geometry.dockLeft >= 0 && geometry.dockRight <= width, JSON.stringify(geometry))
    assert.equal(geometry.fontSize, fontSize); assert.equal(geometry.theme, width === 1600 ? 'dark' : 'light'); assert.ok(geometry.headingSize > fontSize * 1.5)
    layouts.push({ fontSize, ...geometry })
    if (fontSize === 18) await shot(`reports-${width}-${fontSize}`)
  }
  pass('Report rings, charts and six-module Dock fit three widths and both font sizes')
  await page.getByRole('button', { name: '按周', exact: true }).click()
  assert.ok((await page.locator('.report-goals').innerText()).includes('2 小时 30 分钟'))
  await page.getByRole('button', { name: '自定义期间', exact: true }).click()
  await page.getByLabel('报表开始日期').fill(today); await page.getByLabel('报表结束日期').fill(today)
  assert.ok((await page.locator('.report-finance-total').innerText()).includes('1,500.25'))
  assert.equal(await page.locator('.report-goals').getByText('所选期间合计', { exact: true }).count(), 3)
  await page.locator('.report-ledger').filter({ hasText: '到账明细' }).locator('summary').click()
  await page.getByRole('button', { name: '编辑津贴 助研津贴', exact: true }).click()
  await page.getByLabel('津贴金额', { exact: true }).fill('1600.30'); await page.getByRole('button', { name: '保存津贴修改', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.report-finance-total').innerText.includes('1,600.30'))
  await app.close(); await launch(); await nav('研究报表')
  const restored = unwrap(await page.evaluate(() => window.workbench.researchReport()))
  assert.equal(restored.checkins[0].durationMinutes, 150); assert.equal(restored.stipends[0].amountCents, 160030); assert.equal(restored.readingDates[paperId], today)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.countdowns())).length, 1)
  await page.getByRole('button', { name: '研究打卡', exact: true }).click()
  await shot('manual-research-checkins')
  pass('Custom periods, cash edits and all independent records survive restart')
  await page.locator('#report-checkins .report-ledger summary').click()
  await page.getByRole('button', { name: `移除打卡 ${today}`, exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: '删除', exact: true }).click()
  await page.getByRole('dialog').waitFor({ state: 'hidden' })
  await page.getByRole('button', { name: '登记打卡', exact: true }).click()
  await page.getByLabel('打卡开始时间', { exact: true }).fill('09:00'); await page.getByLabel('打卡结束时间', { exact: true }).fill('09:01')
  await page.getByRole('button', { name: '保存打卡', exact: true }).click()
  await page.locator('#report-checkins .report-entry-form').waitFor({ state: 'hidden' })
  assert.ok((await page.locator('.report-checkin-totals').innerText()).includes('1 分钟'))
  assert.equal(unwrap(await page.evaluate(() => window.workbench.researchReport())).checkins[0].durationMinutes, 1)
  pass('Confirm removal updates totals and a one-minute check-in remains visibly nonzero')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ checks, layouts, errors, profile, databasePath: initial.databasePath }, null, 2))
} finally { await app?.close().catch(() => undefined) }
