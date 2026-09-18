import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

// Controlled API responses verify UI/IPC/persistence, not a live model's language accuracy.
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('验收记录/AI与透明度升级', executablePath ? 'packaged' : 'development')
mkdirSync(evidence, { recursive: true })
const tempRoot = realpathSync(tmpdir()), profile = mkdtempSync(join(tempRoot, 'workbench-assistant-ui-'))
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
let override, status = 200, requests = 0
const checkNames = [], errors = []
const check = (name) => { checkNames.push(name); console.log('PASS', name) }
const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const day = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
const server = createServer(async (req, res) => {
  let bytes = ''; for await (const part of req) bytes += part
  const body = JSON.parse(bytes); requests++
  assert.equal(req.url, '/v1/chat/completions')
  if (status !== 200) { res.writeHead(status); res.end('{"error":"fixture failure"}'); status = 200; return }
  let content = 'OK'
  if (body.messages.length > 1) {
    const context = JSON.parse(body.messages[1].content)
    const today = body.messages[0].content.match(/当前本地日期 (\d{4}-\d{2}-\d{2})/)[1]
    assert.ok(context.projects.length >= 1)
    const tomorrow = new Date(`${today}T12:00:00`); tomorrow.setDate(tomorrow.getDate() + 1)
    let task = { title: '开组会', projectId: context.selectedProjectId || context.projects[0].id, scheduledDate: today, startTime: '18:00', endTime: null }
    if (context.request.includes('明天上午')) task = { ...task, title: '整理实验记录', scheduledDate: day(tomorrow), startTime: '09:17' }
    content = JSON.stringify(context.request === '6点，讨论论文' ? { action: 'clarify', message: '请补充日期，以及上午还是下午6点。', tasks: [] } : { action: 'create_tasks', message: '已理解计划', tasks: [task] })
  }
  if (override !== undefined) { content = override; override = undefined }
  res.writeHead(200, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ choices: [{ message: { content }, finish_reason: 'stop' }] }))
})
await new Promise((done) => server.listen(0, '127.0.0.1', done))
const baseUrl = `http://127.0.0.1:${server.address().port}/v1`
let app, page
const nav = (name) => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
const snap = async () => unwrap(await page.evaluate(() => window.workbench.bootstrap()))
const screenshot = async (name) => page.screenshot({ path: join(evidence, name), animations: 'disabled' })
async function launch() {
  app = await electron.launch(executablePath ? { executablePath, args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setBounds({ width: 1600, height: 1000 }); win.webContents.setBackgroundThrottling(false); win.showInactive() })
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
}
try {
  await launch()
  const project = unwrap(await page.evaluate(() => window.workbench.createProject({ name: '组会', description: '隔离测试项目', colorKey: 'blue' })))
  await page.evaluate(() => window.workbench.createProject({ name: '实验研究', description: '隔离测试项目', colorKey: 'sage' }))
  await page.reload()
  await nav('设置')
  await page.getByRole('heading', { name: '设置', exact: true }).waitFor()
  await page.getByRole('button', { name: 'AI 助手', exact: true }).click()
  await page.getByRole('button', { name: '自定义 API', exact: true }).click()
  await page.getByLabel('AI API 地址', { exact: true }).fill(baseUrl)
  await page.getByLabel('AI 模型', { exact: true }).fill('controlled-test-model')
  await page.getByLabel('AI API Key', { exact: true }).fill('fixture-key-only')
  await page.getByRole('button', { name: '保存并测试连接', exact: true }).click()
  await page.getByText('连接成功，模型已返回回复。', { exact: true }).waitFor()
  const settings = unwrap(await page.evaluate(() => window.workbench.assistantSettings()))
  assert.equal(settings.activeProvider, 'custom')
  assert.equal(settings.profiles.find((item) => item.provider === 'custom').hasApiKey, true)
  assert.ok(!JSON.stringify(settings).includes('fixture-key-only'))
  await screenshot('AI配置.png')
  check('Settings save, encrypted key redaction and HTTP connection test')

  await nav('研究计划')
  const recognitionSwitch = page.getByRole('switch', { name: 'AI 识别', exact: true })
  await recognitionSwitch.waitFor()
  assert.equal(await recognitionSwitch.getAttribute('aria-checked'), 'true')
  assert.equal(await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).getAttribute('placeholder'), '描述安排，自动识别日期、时间和项目…')
  const requestsBeforeManual = requests
  await recognitionSwitch.click()
  assert.equal(await recognitionSwitch.getAttribute('aria-checked'), 'false')
  assert.equal(await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).getAttribute('placeholder'), '输入任务标题…')
  await page.getByLabel('新计划所属项目', { exact: true }).selectOption(project.id)
  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).fill('不经 AI 直接记录')
  await page.getByRole('button', { name: '直接添加任务', exact: true }).click()
  await waitForAsync(page, async () => { const result = await window.workbench.bootstrap(); return result.ok && result.data.tasks.some((task) => task.title === '不经 AI 直接记录') })
  assert.equal(requests, requestsBeforeManual)
  const manual = (await snap()).tasks.find((task) => task.title === '不经 AI 直接记录')
  assert.equal(manual.projectId, project.id); assert.equal(manual.startTime, null); assert.equal(manual.endTime, null)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.assistantSettings())).quickRecognitionEnabled, false)
  await page.evaluate((id) => window.workbench.deleteTask(id), manual.id)
  await page.reload(); await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  assert.equal(await page.getByRole('switch', { name: 'AI 识别', exact: true }).getAttribute('aria-checked'), 'false')
  await page.getByRole('switch', { name: 'AI 识别', exact: true }).click()
  await waitForAsync(page, async () => { const result = await window.workbench.assistantSettings(); return result.ok && result.data.quickRecognitionEnabled })
  check('Quick recognition switch persists, and off mode adds directly without an AI request')

  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).fill('今天晚上6点，开组会')
  await page.getByRole('button', { name: 'AI 识别并添加任务', exact: true }).click()
  await page.getByRole('dialog').getByText('已添加 1 项计划。', { exact: true }).waitFor()
  await screenshot('AI添加计划.png')
  let rows = (await snap()).tasks
  assert.equal(rows.length, 1); assert.equal(rows[0].startTime, '18:00'); assert.equal(rows[0].endTime, null)
  assert.equal(rows[0].scheduledDate, day(new Date()))
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  assert.equal(await page.getByTestId('schedule-block').filter({ hasText: '开组会' }).count(), 1)
  check('Quick capture creates a single dated task with 18:00 and unspecified end time in Today Plan')

  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).fill('明天上午9点17分，整理实验记录')
  await page.getByRole('button', { name: 'AI 识别并添加任务', exact: true }).click()
  await page.getByRole('dialog').getByText('已添加 1 项计划。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  assert.equal(await page.getByTestId('schedule-block').filter({ hasText: '整理实验记录' }).count(), 0)
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: /^全部任务/ }).click()
  assert.equal(await page.locator('.task-content').filter({ hasText: '开组会' }).count(), 1)
  assert.equal(await page.locator('.task-content').filter({ hasText: '整理实验记录' }).count(), 1)
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: '日历', exact: true }).click()
  assert.equal(await page.getByTestId('schedule-block').filter({ hasText: '开组会' }).count(), 1)
  assert.equal(await page.getByTestId('schedule-block').filter({ hasText: '整理实验记录' }).count(), 1)
  check('All Tasks and Calendar share the same tasks; tomorrow does not appear in Today Plan')

  await page.getByRole('button', { name: '打开 AI 助手', exact: true }).click()
  await page.getByLabel('告诉 AI 你的计划', { exact: true }).fill('6点，讨论论文')
  await page.getByRole('button', { name: '理解并添加', exact: true }).click()
  await page.getByText('请补充日期，以及上午还是下午6点。', { exact: true }).waitFor()
  assert.equal((await snap()).tasks.length, 2)
  await page.getByRole('button', { name: '放弃这条，开始新计划', exact: true }).click()
  override = '{not JSON'
  await page.getByLabel('告诉 AI 你的计划', { exact: true }).fill('今天晚上6点，开组会')
  await page.getByRole('button', { name: '理解并添加', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '无法识别' }).waitFor()
  assert.equal((await snap()).tasks.length, 2)
  assert.equal(await page.getByLabel('告诉 AI 你的计划', { exact: true }).inputValue(), '今天晚上6点，开组会')
  status = 429
  await page.getByRole('button', { name: '理解并添加', exact: true }).click()
  await page.getByRole('alert').filter({ hasText: '限流' }).waitFor()
  assert.equal((await snap()).tasks.length, 2)
  await page.getByRole('button', { name: '理解并添加', exact: true }).click()
  await page.getByRole('dialog').getByText('已添加 1 项计划。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '撤销本次添加', exact: true }).click()
  await page.getByText('本次添加的任务已移除。', { exact: true }).waitFor()
  assert.equal((await snap()).tasks.length, 2)
  await page.getByRole('button', { name: '关闭对话框', exact: true }).click()
  check('Clarification, malformed JSON and 429 preserve tasks/input; retry and undo work')

  const replayId = crypto.randomUUID()
  const first = unwrap(await page.evaluate(({ requestId, projectId }) => window.workbench.planWithAssistant({ requestId, projectId, text: '今天晚上6点，开组会' }), { requestId: replayId, projectId: project.id }))
  const again = unwrap(await page.evaluate(({ requestId, projectId }) => window.workbench.planWithAssistant({ requestId, projectId, text: '今天晚上6点，开组会' }), { requestId: replayId, projectId: project.id }))
  assert.equal(first.tasks[0].id, again.tasks[0].id)
  assert.equal((await snap()).tasks.length, 3)
  await page.evaluate((id) => window.workbench.deleteTask(id), first.tasks[0].id)

  await nav('设置')
  const wallpaperPath = join(profile, 'test-wallpaper.png')
  const wallpaper = await app.evaluate(({ nativeImage, dialog }, path) => {
    const width = 1600, height = 1000, buffer = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
      const at = (y * width + x) * 4, wave = Math.sin(x / 250 + y / 300) * 0.5 + 0.5
      buffer[at] = 145 + Math.round(wave * 90); buffer[at + 1] = 85 + Math.round(y / height * 125); buffer[at + 2] = 100 + Math.round(x / width * 105); buffer[at + 3] = 255
    }
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] })
    return nativeImage.createFromBitmap(buffer, { width, height }).toPNG().toString('base64')
  }, wallpaperPath)
  writeFileSync(wallpaperPath, Buffer.from(wallpaper, 'base64'))
  await page.getByRole('button', { name: '外观与显示', exact: true }).click()
  await page.getByRole('button', { name: '上传背景', exact: true }).click()
  await page.getByRole('button', { name: '自定义背景', exact: true }).waitFor()
  await page.getByRole('group', { name: '显示模式', exact: true }).getByRole('button', { name: '深色', exact: true }).click()
  const slider = page.getByRole('slider', { name: '页面透明度', exact: true })
  await slider.fill('15')
  await waitForAsync(page, async () => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.panelOpacity === 85 })
  await screenshot('透明度15.png')
  await slider.fill('65')
  await waitForAsync(page, async () => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.panelOpacity === 35 })
  await screenshot('透明度65.png')
  const material = await page.evaluate(() => ({ main: getComputedStyle(document.querySelector('.main-region')).backgroundColor, card: getComputedStyle(document.querySelector('.appearance-card')).backgroundColor, text: getComputedStyle(document.querySelector('h1')).opacity, sidebarOffset: document.querySelector('.sidebar-module').getBoundingClientRect().top - document.querySelector('.sidebar').getBoundingClientRect().top }))
  assert.equal(material.text, '1'); assert.ok(material.sidebarOffset < 40)
  assert.ok(material.main.includes('0.35')); assert.ok(!material.card.endsWith(', 1)'))
  check('Wallpaper upload and transparent main/sidebar/cards respond immediately without fading text')

  const defaultAlignment = await page.evaluate(() => {
    const assistant = document.querySelector('.assistant-launcher').getBoundingClientRect()
    const main = document.querySelector('.main-region').getBoundingClientRect()
    const appearance = document.querySelector('.appearance-switch').getBoundingClientRect()
    return { rightDelta: Math.abs(main.right - assistant.right), centerDelta: Math.abs((appearance.top + appearance.bottom) / 2 - (assistant.top + assistant.bottom) / 2) }
  })
  assert.ok(defaultAlignment.rightDelta <= 1, `Default launcher right alignment: ${JSON.stringify(defaultAlignment)}`)
  assert.ok(defaultAlignment.centerDelta <= 2, `Default launcher footer center alignment: ${JSON.stringify(defaultAlignment)}`)

  await page.getByRole('button', { name: '特大字号 18', exact: true }).click()
  await waitForAsync(page, async () => { const r = await window.workbench.interfacePreferences(); return r.ok && r.data.preferences.fontSize === 18 })
  await nav('研究计划')
  await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: '日历', exact: true }).click()
  const anytimeAxis = await page.locator('.anytime-axis').evaluate((element) => {
    const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
    return { width: bounds.width, whiteSpace: style.whiteSpace, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth }
  })
  assert.ok(anytimeAxis.width >= 75)
  assert.equal(anytimeAxis.whiteSpace, 'nowrap')
  assert.ok(anytimeAxis.scrollWidth <= anytimeAxis.clientWidth)
  await screenshot('日历大字号布局.png')
  check('Large-font calendar keeps the unspecified-time label on one line')

  for (const [width, height] of [[1100, 700], [1600, 1000]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setBounds(size), { width, height })
    for (const section of ['研究计划', '文献阅读', '科研成果', '论文投稿', '设置']) {
      await nav(section)
      assert.equal(await page.getByText('工作空间', { exact: true }).count(), 0)
      const layout = await page.evaluate(() => {
        const dock = document.querySelector('.dock').getBoundingClientRect(), assistant = document.querySelector('.assistant-launcher').getBoundingClientRect()
        const main = document.querySelector('.main-region').getBoundingClientRect(), appearance = document.querySelector('.appearance-switch').getBoundingClientRect()
        const appearanceCenter = (appearance.top + appearance.bottom) / 2, assistantCenter = (assistant.top + assistant.bottom) / 2
        return { overflow: document.documentElement.scrollWidth > innerWidth, overlap: assistant.left < dock.right && assistant.right > dock.left && assistant.top < dock.bottom && assistant.bottom > dock.top,
          rightDelta: Math.abs(main.right - assistant.right), appearanceCenter, assistantCenter, centerDelta: Math.abs(appearanceCenter - assistantCenter) }
      })
      assert.equal(layout.overflow, false, `${section} ${width} overflow`)
      assert.equal(layout.overlap, false, `${section} ${width} dock overlap`)
      assert.ok(layout.rightDelta <= 1, `${section} ${width} right alignment: ${JSON.stringify(layout)}`)
      assert.ok(layout.centerDelta <= 2, `${section} ${width} footer center alignment: ${JSON.stringify(layout)}`)
    }
  }
  check('Five page headers and launcher layout at 1100 and 1600 widths')
  await app.close(); app = null
  await launch()
  const restored = unwrap(await page.evaluate(() => window.workbench.interfacePreferences()))
  assert.equal(restored.preferences.panelOpacity, 35)
  assert.equal(restored.preferences.background, 'custom')
  assert.ok(restored.backgroundDataUrl)
  const restoredAi = unwrap(await page.evaluate(() => window.workbench.assistantSettings()))
  assert.equal(restoredAi.activeProvider, 'custom'); assert.equal(restoredAi.profiles.find((item) => item.provider === 'custom').hasApiKey, true)
  assert.equal(restoredAi.quickRecognitionEnabled, true)
  assert.equal((await snap()).tasks.length, 2)
  await nav('设置'); await page.getByRole('button', { name: '外观与显示', exact: true }).click()
  await screenshot('重启后设置.png')
  check('Restart preserves tasks, wallpaper, transparency and both API profiles')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ validation: 'controlled-local-api', packaged: !!executablePath, checks: checkNames, errors, requests, material }, null, 2))
  console.log(`ALL ${checkNames.length} ASSISTANT CHECKS PASSED`)
} catch (error) {
  writeFileSync(join(evidence, 'failure.json'), JSON.stringify({ message: String(error), checks: checkNames, errors }, null, 2))
  if (page && !page.isClosed()) await screenshot('failure.png').catch(() => undefined)
  throw error
} finally {
  if (app) await app.close().catch(() => undefined)
  server.closeAllConnections(); await new Promise((done) => server.close(done))
  const target = realpathSync(profile)
  if (target.startsWith(`${tempRoot}\\`) && basename(target).startsWith('workbench-assistant-ui-')) rmSync(target, { recursive: true, force: true })
}
