import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable')
const output = resolve(option('output') || 'test-results/rail-hover/interaction')
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, `profile-${Date.now()}`),
  WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(10000)
const errors = [], checks = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const pass = message => { checks.push(message); console.log('PASS', message) }
try {
  const rail = await app.firstWindow()
  rail.on('pageerror', error => errors.push(error.message))
  await rail.locator('#workbench').waitFor()
  await rail.mouse.move(1, 1)
  const geometry = () => rail.locator('button').evaluateAll(buttons => buttons.filter(button => !button.hidden).map(button => ({
    id: button.dataset.panel || button.id, left: button.getBoundingClientRect().left,
    opacity: Number(getComputedStyle(button.querySelector('.rail-copy')).opacity),
    duration: getComputedStyle(button).transitionDuration
  })))
  const settle = async (id, expanded) => {
    await rail.waitForFunction(({ id, expanded }) => {
      const button = document.querySelector(`[data-panel="${id}"]`) || document.getElementById(id)
      return Math.abs(button.getBoundingClientRect().left - (expanded ? 4 : 116)) < .25
    }, { id, expanded }, { timeout: 5000 })
  }
  const hover = async id => {
    const box = await rail.locator(id === 'workbench' ? '#workbench' : `[data-panel=${id}]`).boundingBox()
    await rail.mouse.move(150, box.y + box.height / 2)
    await settle(id, true)
  }
  await rail.waitForTimeout(450)
  assert.equal(app.windows().length, 1)
  assert.ok((await geometry()).every(button => button.left === 116 && button.opacity === 0))
  await rail.screenshot({ path: join(output, 'collapsed.png') })
  pass('startup keeps all seven entries folded with only their icon tabs visible')

  // Observe the native hit-testing calls while exercising real renderer mouse events.
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('rail.html'))
    const original = window.setIgnoreMouseEvents.bind(window)
    globalThis.railPointerStates = []
    window.setIgnoreMouseEvents = (ignore, options) => { globalThis.railPointerStates.push(ignore); original(ignore, options) }
  })
  await hover('tasks')
  let state = await geometry()
  assert.ok(state.filter(button => button.id !== 'tasks').every(button => button.left === 116))
  await rail.mouse.move(30, 112)
  await rail.waitForTimeout(150)
  await settle('tasks', true)
  assert.equal((await geometry()).find(button => button.id === 'tasks').opacity, 1)
  await rail.screenshot({ path: join(output, 'tasks-hover.png') })
  pass('hover reveals just one note and remains open while moving onto its title')

  await hover('reading')
  await settle('tasks', false)
  await rail.mouse.move(1, 1)
  await settle('reading', false)
  const pointerStates = await app.evaluate(() => globalThis.railPointerStates)
  assert.ok(pointerStates.includes(false) && pointerStates.at(-1) === true)
  pass('switching notes collapses the previous one; transparent space passes mouse input through')

  const tasks = rail.locator('[data-panel=tasks]')
  const taskBox = await tasks.boundingBox()
  await rail.mouse.move(150, taskBox.y + 32)
  await rail.waitForTimeout(80)
  await rail.mouse.move(1, 1)
  await rail.waitForTimeout(160)
  const partial = (await geometry()).find(button => button.id === 'tasks').left
  assert.ok(partial > 4 && partial < 116)
  await hover('tasks')
  const panelReady = app.waitForEvent('window')
  await tasks.click()
  const panel = await panelReady
  await panel.getByRole('button', { name: '收起面板', exact: true }).waitFor()
  assert.equal(await panel.locator('.desktop-header strong').innerText(), '任务总览')
  await rail.locator('[data-panel=reading]').click()
  await panel.locator('.desktop-header strong').filter({ hasText: '论文阅读' }).waitFor()
  await rail.waitForFunction(() => document.documentElement.dataset.panelOpen === 'true')
  for (const id of ['gpu', 'tasks', 'workbench']) {
    const button = rail.locator(id === 'workbench' ? '#workbench' : `[data-panel=${id}]`)
    const box = await button.boundingBox()
    await rail.mouse.move(150, box.y + box.height / 2)
    await rail.waitForTimeout(350)
    assert.ok((await geometry()).every(button => Math.abs(button.left - 116) < .25 && button.opacity === 0))
  }
  await rail.screenshot({ path: join(output, 'panel-open-hover.png') })
  assert.equal(await panel.locator('.desktop-header strong').innerText(), '论文阅读')
  await rail.locator('[data-panel=gpu]').click()
  await panel.locator('.desktop-header strong').filter({ hasText: 'GPU 监控' }).waitFor()
  assert.equal(app.windows().length, 2)
  pass('an open panel keeps every hovered note folded; clicking another icon still switches the panel')
  await panel.getByRole('button', { name: '收起面板', exact: true }).click()
  await panel.waitForTimeout(300)
  await rail.mouse.move(1, 1)
  await settle('tasks', false)
  assert.equal(await rail.locator('nav').evaluate(nav => nav.scrollLeft), 0)
  await hover('tasks')
  assert.equal((await geometry()).find(button => button.id === 'tasks').opacity, 1)
  await rail.mouse.move(1, 1)
  await settle('tasks', false)
  pass('closing the panel restores normal hover expansion')
  pass('interrupted transitions reverse naturally and clicking still opens the corresponding panel')

  await rail.keyboard.press('Tab')
  const focused = await rail.evaluate(() => document.activeElement?.getAttribute('data-panel') || document.activeElement?.id)
  assert.ok(focused)
  await settle(focused, true)
  await rail.evaluate(() => document.activeElement.blur())
  await settle(focused, false)
  const reading = rail.locator('[data-panel=reading]')
  await reading.dispatchEvent('dragover')
  await settle('reading', true)
  await reading.dispatchEvent('dragleave')
  await settle('reading', false)
  pass('keyboard focus and PDF drag hover reveal their individual notes')

  await rail.emulateMedia({ reducedMotion: 'reduce' })
  await hover('codex')
  state = await geometry()
  assert.ok(state.every(button => button.duration === '0s'))
  await rail.mouse.move(1, 1)
  await settle('codex', false)
  assert.ok((await geometry()).every(button => button.left === 116))
  pass('reduced motion switches directly between folded and expanded states')
  assert.deepEqual(errors, [])
} finally {
  await app.close()
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, errors }, null, 2))
}
