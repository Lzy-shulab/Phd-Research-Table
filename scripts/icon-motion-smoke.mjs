import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const evidence = resolve(process.env.WORKBENCH_TEST_EVIDENCE || `test-results/icon-motion-${version}/review`)
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
let page
const errors = [], checks = [], layouts = []
const modules = ['研究计划', '文献阅读', '科研成果', '论文投稿', '研究报表', '设置']
const headings = ['今日计划', '文献库', '科研成果', '论文投稿', '研究报表', '外观与显示']
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
const nav = label => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: label, exact: true })
const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
async function settle() {
  await page.waitForFunction(() => {
    const stages = document.querySelectorAll('.workspace-stage')
    const active = document.querySelector('.dock-item[aria-current="page"]')?.getBoundingClientRect()
    const selection = document.querySelector('.dock-selection')?.getBoundingClientRect()
    return stages.length === 1 && Number(getComputedStyle(stages[0]).opacity) > .99 && active && selection && Math.abs(active.x - selection.x) < 1 && Math.abs(active.y - selection.y) < 1
  })
}
async function go(index) {
  await nav(modules[index]).click()
  await page.getByRole('heading', { name: headings[index], exact: true }).waitFor()
  await settle()
}
async function geometry(name) {
  const result = await page.evaluate(() => {
    const dock = document.querySelector('.dock').getBoundingClientRect()
    const active = document.querySelector('.dock-item[aria-current="page"]').getBoundingClientRect()
    const selection = document.querySelector('.dock-selection').getBoundingClientRect()
    return { width: innerWidth, scrollWidth: document.documentElement.scrollWidth, dock: { left: dock.left, right: dock.right },
      alignment: { x: Math.abs(active.x - selection.x), y: Math.abs(active.y - selection.y), width: Math.abs(active.width - selection.width), height: Math.abs(active.height - selection.height) },
      overflow: [...document.querySelectorAll('.dock-item, .sidebar-module, .workspace-header')].filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className) }
  })
  assert.ok(result.scrollWidth <= result.width + 1, name)
  assert.ok(result.dock.left >= 0 && result.dock.right <= result.width, name)
  assert.deepEqual(result.overflow, [], name)
  for (const value of Object.values(result.alignment)) assert.ok(value < 1.5, JSON.stringify(result))
  layouts.push({ name, ...result })
}
try {
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1600, 1000); win.showInactive(); win.webContents.setBackgroundThrottling(false) })
  const boot = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.ok(boot.databasePath.startsWith(profile))
  const fixture = unwrap(await page.evaluate(async () => {
    const project = await window.workbench.createProject({ name: '光谱材料研究', colorKey: 'sage', description: '' })
    if (!project.ok) return project
    const date = new Date(), day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const tasks = []
    for (const title of ['整理矿物颜料光谱数据', '核对论文图表与引用', '安排下一轮重建实验']) {
      const task = await window.workbench.createTask({ title, projectId: project.data.id, scheduledDate: day })
      if (!task.ok) return task
      tasks.push(task.data.id)
    }
    return { ok: true, data: { tasks } }
  }))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  assert.equal(await page.locator('.app-brand-icon').evaluate(image => image.complete && image.naturalWidth > 0), true)
  assert.equal(await page.locator('.dock-item .workspace-glyph').count(), 6)
  for (const icon of await page.locator('.dock-item .workspace-glyph').all()) assert.equal(await icon.getAttribute('aria-hidden'), 'true')
  for (let index = 0; index < modules.length; index++) {
    await go(index)
    await geometry(`desktop-${index}`)
    await shot(`desktop-${index}`)
  }
  pass('six workspaces render with consistent vector icons, decorative semantics and aligned Dock selection')
  const frames = await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('.dock-item')]
    buttons[0].click()
    const result = [], start = performance.now()
    while (performance.now() - start < 650) {
      await new Promise(requestAnimationFrame)
      const stages = [...document.querySelectorAll('.workspace-stage')]
      result.push({ ms: performance.now() - start, opacity: stages.map(el => Number(getComputedStyle(el).opacity)), inert: stages.map(el => el.inert), indicatorX: document.querySelector('.dock-selection').getBoundingClientRect().x })
    }
    return result
  })
  assert.ok(frames.some(frame => frame.opacity.length === 2 && frame.inert.includes(true)), 'Outgoing page should remain inert during the handoff')
  assert.ok(frames.every(frame => Math.max(...frame.opacity) >= .3), 'Page handoff should not fade the whole view to blank')
  assert.equal(frames.at(-1).opacity.length, 1)
  const gaps = frames.slice(1).map((frame, index) => frame.ms - frames[index].ms).sort((a, b) => a - b)
  const timing = { medianFrameMs: gaps[Math.floor(gaps.length / 2)], p95FrameMs: gaps[Math.floor(gaps.length * .95)] }
  writeFileSync(join(evidence, 'motion-frames.json'), JSON.stringify({ timing, frames }, null, 2))
  await page.evaluate(async () => {
    const buttons = [...document.querySelectorAll('.dock-item')]
    for (const index of [1, 4, 2, 0, 5, 3, 4, 0]) { buttons[index].click(); await new Promise(resolve => setTimeout(resolve, 45)) }
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor(); await settle()
  await geometry('rapid-navigation')
  assert.equal(await page.locator('.workspace-stage[inert]').count(), 0)
  pass('page handoff stays visible, old content is inert, and rapid navigation settles on the final selection')
  await page.getByRole('button', { name: '编辑 整理矿物颜料光谱数据', exact: true }).click()
  await page.getByRole('complementary', { name: '任务详情', exact: true }).waitFor()
  await page.getByLabel('任务标题', { exact: true }).fill('整理矿物颜料光谱数据与采集参数')
  await page.getByLabel('任务标题', { exact: true }).blur()
  await page.getByRole('button', { name: '关闭任务详情', exact: true }).click()
  await page.getByRole('complementary', { name: '任务详情', exact: true }).waitFor({ state: 'detached' })
  const row = page.locator('[data-testid="task-row"]').filter({ hasText: '整理矿物颜料光谱数据与采集参数' })
  await row.locator('.task-checkbox').click()
  await page.waitForFunction(() => [...document.querySelectorAll('[data-testid="task-row"]')].some(el => el.textContent.includes('整理矿物颜料光谱数据与采集参数') && el.classList.contains('completed')))
  const saved = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.equal(saved.tasks.find(task => task.id === fixture.tasks[0]).status, 'completed')
  pass('task details still save edits and completion while using the new motion feedback')
  await page.keyboard.press('Control+k')
  await page.getByRole('dialog', { name: '全局搜索' }).waitFor()
  assert.equal(await page.getByRole('dialog').evaluate(el => getComputedStyle(el).animationName), 'craft-dialog-in')
  await shot('dialog-desktop')
  await page.keyboard.press('Escape')
  await page.getByRole('dialog').waitFor({ state: 'detached' })
  assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).pointerEvents), 'auto')
  pass('dialog opening and dismissal retain keyboard operation and release pointer access')
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720))
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  for (let index = 0; index < modules.length; index++) {
    await go(index); await geometry(`compact-${index}`)
    if ([0, 1, 4, 5].includes(index)) await shot(`compact-${index}`)
  }
  await page.getByRole('button', { name: '收起侧栏', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.sidebar === 'collapsed')
  await geometry('collapsed-sidebar'); await shot('collapsed-sidebar')
  await page.getByRole('button', { name: '展开侧栏', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.sidebar !== 'collapsed')
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  await go(0); await geometry('compact-dark'); await shot('compact-dark')
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await go(4); await geometry('reduced-motion')
  assert.equal(await page.locator('.dock-item.selected .workspace-glyph').evaluate(el => getComputedStyle(el).transform), 'none')
  await page.keyboard.press('Control+k'); await page.getByRole('dialog', { name: '全局搜索' }).waitFor()
  const reducedDialog = await page.getByRole('dialog').evaluate(el => ({ name: getComputedStyle(el).animationName, duration: Number.parseFloat(getComputedStyle(el).animationDuration) }))
  assert.equal(reducedDialog.name, 'workspace-overlay-in'); assert.ok(reducedDialog.duration <= .1)
  await page.keyboard.press('Escape'); await page.getByRole('dialog').waitFor({ state: 'detached' })
  pass('all six compact workspaces support large text, collapsed sidebar, dark mode and reduced motion')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ version, checks, layouts, timing, errors }, null, 2))
} catch (error) {
  if (page) await shot('failure').catch(() => {})
  throw error
} finally { await app.close() }
