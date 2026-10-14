import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const baseline = process.argv.includes('--baseline')
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/capture-project-0.8.21', baseline ? 'baseline' : executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['.'] }), env })
const errors = [], geometry = []
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1600, 900)
    win.webContents.setBackgroundThrottling(false)
    win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ background: 'sage', fontSize: 14, dockAutoHide: false })))
  unwrap(await page.evaluate(() => window.workbench.setAppearance('light')))
  const title = page.getByLabel('添加一个研究任务')
  const select = page.getByLabel('新计划所属项目')
  if (!baseline) {
    await title.fill('给导师发送实验材料')
    await select.selectOption({ label: '新建项目…' })
    const dialog = page.getByRole('dialog', { name: '新建项目', exact: true })
    await dialog.getByRole('textbox', { name: '项目名称', exact: true }).fill('矿物颜料研究')
    await dialog.getByRole('button', { name: '创建项目', exact: true }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await select.locator('option:checked').innerText(), '矿物颜料研究')
    assert.equal(await title.inputValue(), '给导师发送实验材料')
  } else {
    unwrap(await page.evaluate(() => window.workbench.createProject({ name: '矿物颜料研究', description: '', colorKey: 'sage' })))
  }
  unwrap(await page.evaluate(() => window.workbench.createProject({ name: '论文修订', description: '', colorKey: 'blue' })))
  unwrap(await page.evaluate(async () => {
    const snapshot = await window.workbench.bootstrap()
    if (!snapshot.ok) return snapshot
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1)
    const scheduledDate = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`
    return window.workbench.createTask({ title: '开题报告 PPT', projectId: snapshot.data.projects[0].id, scheduledDate })
  }))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  if (!baseline) {
    await select.selectOption({ label: '矿物颜料研究' })
    const previous = await select.inputValue()
    await select.selectOption({ label: '新建项目…' })
    const dialog = page.getByRole('dialog', { name: '新建项目', exact: true })
    await dialog.getByRole('button', { name: '关闭对话框' }).click()
    await dialog.waitFor({ state: 'detached' })
    assert.equal(await select.inputValue(), previous)
    assert.equal(await title.inputValue(), '给导师发送实验材料')
    await select.selectOption({ label: '新建项目…' })
    await page.getByRole('dialog').getByRole('textbox', { name: '项目名称', exact: true }).fill('壁画光谱分析')
    await page.getByRole('dialog').getByRole('button', { name: '创建项目', exact: true }).click()
    await page.getByRole('dialog').waitFor({ state: 'detached' })
    const selectedId = await select.inputValue()
    assert.equal(await select.locator('option:checked').innerText(), '壁画光谱分析')
    await page.getByRole('button', { name: '直接添加任务' }).click()
    await page.getByTestId('task-row').filter({ hasText: '给导师发送实验材料' }).waitFor()
    const state = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
    assert.equal(state.tasks.find(task => task.title === '给导师发送实验材料').projectId, selectedId)
    await title.fill('整理下一阶段实验安排')
  }
  for (const [name, width, height, fontSize] of [['wide', 2560, 1380, 14], ['compact-large-text', 1100, 720, 18]]) {
    await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), [width, height])
    unwrap(await page.evaluate(fontSize => window.workbench.updateInterfacePreferences({ fontSize }), fontSize))
    await page.reload()
    await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    await page.waitForFunction(fontSize => document.documentElement.dataset.textSize === String(fontSize), fontSize)
    await page.waitForFunction(size => Math.abs(innerWidth - size[0]) <= 4 && Math.abs(innerHeight - size[1]) <= 4, [width, height])
    await page.waitForFunction(() => [...document.querySelectorAll('.quick-capture, .overdue-panel')].every(el => Number(getComputedStyle(el).opacity) > .999))
    const summary = page.locator('.capture-more > summary')
    if (!await page.locator('.capture-more').evaluate(el => el.open)) await summary.click()
    const measure = await page.locator('.capture-more-controls').evaluate(menu => {
      const bounds = menu.getBoundingClientRect()
      const sample = [...menu.children].map(element => {
        const rect = element.getBoundingClientRect()
        const hit = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
        return { text: element.textContent.trim(), visible: menu.contains(hit) }
      })
      return { bounds: bounds.toJSON(), viewport: [innerWidth, innerHeight], fontSize: getComputedStyle(document.documentElement).fontSize, sample, overflow: document.documentElement.scrollWidth > innerWidth }
    })
    geometry.push({ name, ...measure })
    await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
    if (!baseline) {
      assert.ok(measure.sample.every(item => item.visible), `${name}: options obscured ${JSON.stringify(measure.sample)}`)
      assert.ok(measure.bounds.left >= 0 && measure.bounds.right <= width && measure.bounds.bottom <= height, `${name}: options outside viewport`)
      assert.equal(measure.overflow, false)
      assert.equal(await page.locator('.capture-more-controls').getByRole('button', { name: '新建项目', exact: true }).count(), 0)
      const repeat = page.locator('.capture-repeat input[type=checkbox]')
      await repeat.check()
      await page.getByLabel('重复次数').fill('3')
      await repeat.uncheck()
      const ai = page.getByRole('switch', { name: 'AI 识别日期时间和项目' })
      await ai.click()
      await page.waitForFunction(() => document.querySelector('.capture-ai-toggle').getAttribute('aria-checked') === 'true')
      assert.equal(await select.locator('option').filter({ hasText: '自动识别项目' }).count(), 1)
      await ai.click()
      await page.waitForFunction(() => document.querySelector('.capture-ai-toggle').getAttribute('aria-checked') === 'false')
    }
    await summary.click()
  }
  if (baseline) assert.ok(geometry.some(item => item.sample.some(sample => !sample.visible)), 'Baseline did not reproduce the obstruction')
  else {
    await page.reload()
    await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    assert.equal(await select.locator('option').filter({ hasText: '壁画光谱分析' }).count(), 1)
    await page.getByTestId('task-row').filter({ hasText: '给导师发送实验材料' }).waitFor()
  }
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ baseline, geometry, errors, projectCreationAndTaskAssignment: !baseline }, null, 2))
  console.log(baseline ? 'PASS reproduced options obstruction in the prior release' : 'PASS options layering, project creation and cancellation, draft retention, task assignment, persistence, 2560px and 1100px/18px layouts')
} finally { await app.close() }
