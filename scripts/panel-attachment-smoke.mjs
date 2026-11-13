import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable'), baseline = process.argv.includes('--baseline')
const output = resolve(option('output') || 'test-results/panel-attachment')
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, 'profile'), WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_CODEX_AUTO: '1',
  WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(15000)
const errors = [], positions = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
try {
  const rail = await app.firstWindow()
  await rail.locator('[data-panel=tasks]').click()
  let panel
  await waitForAsync(rail, () => Boolean(document.querySelector('[data-panel=tasks][aria-pressed=true]')))
  panel = app.windows().find(page => page.url().includes('widget.html'))
  assert.ok(panel)
  await panel.getByRole('button', { name: '收起面板', exact: true }).waitFor()
  const position = async () => {
    const native = await app.evaluate(({ BrowserWindow }) => {
      const all = BrowserWindow.getAllWindows()
      return { panel: all.find(w => w.webContents.getURL().includes('widget.html')).getBounds(),
        rail: all.find(w => w.webContents.getURL().includes('rail.html')).getBounds() }
    })
    const gap = native.rail.x + native.rail.width - 60 - native.panel.x - native.panel.width
    positions.push({ ...native, gap })
    if (!baseline) assert.ok(Math.abs(gap - 8) <= 1, `Visible tab gap: ${gap}`)
  }
  await position()
  await panel.getByRole('button', { name: '收起面板', exact: true }).click()
  await waitForAsync(rail, () => !document.querySelector('[data-panel=tasks][aria-pressed=true]'))
  await panel.evaluate(() => {
    window.panelFrames = []; window.rootAnimationFrames = 0; window.childAnimationFrames = 0
    let start, previous
    const tick = time => {
      start ??= time
      if (previous) window.panelFrames.push(time - previous)
      previous = time
      const root = document.querySelector('.desktop-panel')
      if (root?.style.transform) window.rootAnimationFrames++
      if ([...(root?.children ?? [])].some(child => child.style.transform)) window.childAnimationFrames++
      if (time - start < 500) requestAnimationFrame(tick)
      else window.panelProbeDone = true
    }
    requestAnimationFrame(tick)
  })
  await rail.locator('[data-panel=tasks]').click()
  await panel.waitForFunction(() => window.panelProbeDone)
  const motion = await panel.evaluate(() => {
    const frames = window.panelFrames.sort((a, b) => a - b)
    return { p95FrameMs: frames[Math.floor(frames.length * .95)], maxFrameMs: Math.max(...frames),
      rootAnimationFrames: window.rootAnimationFrames, childAnimationFrames: window.childAnimationFrames }
  })
  if (!baseline) {
    assert.ok(motion.rootAnimationFrames > 0)
    assert.equal(motion.childAnimationFrames, 0)
  }
  await panel.screenshot({ path: join(output, 'panel.png') })
  await rail.screenshot({ path: join(output, 'rail.png') })
  for (const scale of [.6, 1]) {
    await panel.evaluate(scale => window.workbench.updateWidgetPreferences({ scale }), scale)
    await position()
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
  }
  await panel.emulateMedia({ reducedMotion: 'reduce' })
  await panel.getByRole('button', { name: '收起面板', exact: true }).click()
  await waitForAsync(rail, () => !document.querySelector('[data-panel=tasks][aria-pressed=true]'))
  await rail.locator('[data-panel=tasks]').click()
  await waitForAsync(rail, () => Boolean(document.querySelector('[data-panel=tasks][aria-pressed=true]')))
  await panel.waitForTimeout(50)
  if (!baseline) assert.equal(await panel.locator('.desktop-panel').evaluate(root => root.style.transform), '')
  for (const [kind, title] of [['submissions', '论文投稿'], ['checkin', '打卡记录'], ['gpu', 'GPU 监控']]) {
    await rail.locator(`[data-panel=${kind}]`).click()
    await panel.locator('.desktop-header strong').filter({ hasText: title }).waitFor()
    assert.equal(app.windows().length, 2)
    await position()
  }
  assert.deepEqual(errors, [])
  const report = { baseline, positions, motion, reducedMotion: true, errors }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { await app.close() }
