import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const evidence = resolve(option('evidence') || 'test-results/widget-size/runtime')
const profile = join(evidence, `isolated-data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const exe = option('executable')
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
let app, widget
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
async function launch() {
  app = await electron.launch({ executablePath: resolve(exe || 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : ['.']), '--desktop-widget'], env })
  widget = await app.firstWindow()
  widget.on('pageerror', error => errors.push(error.message))
  await widget.waitForFunction(() => document.querySelector('.widget-today') && !document.querySelector('.widget-today').disabled)
}
async function geometry() {
  return widget.evaluate(() => {
    const bounds = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height } }
    return { shell: bounds(document.querySelector('.widget-shell')), buttons: [...document.querySelectorAll('.widget-actions > button')].map(bounds),
      clock: bounds(document.querySelector('.widget-clock')), viewport: { width: innerWidth, height: innerHeight },
      dialog: document.querySelector('dialog[open]') ? bounds(document.querySelector('dialog[open]')) : null }
  })
}
async function sized(scale, compact = false) {
  await widget.waitForFunction(({ scale, compact }) => {
    const shell = document.querySelector('.widget-shell').getBoundingClientRect()
    return Math.abs(shell.width - 420 * scale) < 0.1 && Math.abs(shell.height - (compact ? 192 : 614) * scale) < 0.1
      && Math.abs(innerHeight - Math.ceil((compact ? 216 : 638) * scale)) <= 1
  }, { scale, compact })
  const value = await geometry()
  assert.ok(Math.abs(value.viewport.width - Math.ceil(444 * scale)) <= 1)
  for (const button of value.buttons) assert.ok(button.width >= 150 * scale && button.height >= 44 * scale)
  return value
}
try {
  await launch()
  const initial = unwrap(await widget.evaluate(() => window.workbench.widgetSnapshot()))
  assert.equal(initial.preferences.scale, null)
  assert.ok(initial.scale <= 0.75)
  const automatic = await sized(initial.scale)
  await widget.screenshot({ path: join(evidence, 'automatic.png'), omitBackground: true })
  const cornerAlpha = await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).toBitmap()[3], join(evidence, 'automatic.png'))
  assert.equal(cornerAlpha, 0)
  pass('automatic proportional sizing fits the work area and the rendered outer corner is transparent')
  await widget.getByRole('button', { name: '面板设置', exact: true }).click()
  let layout = await geometry()
  assert.ok(Math.abs(layout.dialog.width - automatic.shell.width) < 0.1)
  assert.ok(Math.abs(layout.dialog.x - automatic.shell.x) < 0.1)
  await widget.getByRole('switch', { name: '自动适配屏幕', exact: true }).uncheck()
  await widget.getByRole('slider', { name: '面板大小', exact: true }).focus()
  await widget.getByRole('slider', { name: '面板大小', exact: true }).press('Home')
  await sized(0.6)
  await widget.getByRole('slider', { name: '面板大小', exact: true }).press('ArrowUp')
  await sized(0.65)
  await widget.getByRole('slider', { name: '面板大小', exact: true }).press('ArrowDown')
  await sized(0.6)
  layout = await geometry()
  assert.ok(Math.abs(layout.dialog.width - 252) < 0.1)
  await widget.screenshot({ path: join(evidence, 'size-settings.png'), omitBackground: true })
  await widget.getByRole('button', { name: '关闭面板', exact: true }).click()
  await widget.screenshot({ path: join(evidence, 'manual-60.png'), omitBackground: true })
  pass('size slider scales the panel, all controls and the settings sheet together')
  await widget.getByRole('button', { name: '填写打卡起止时间', exact: true }).click()
  const inputLayout = await geometry()
  assert.ok(inputLayout.dialog.x >= 0 && inputLayout.dialog.x + inputLayout.dialog.width <= inputLayout.viewport.width)
  await widget.getByLabel('开始时间', { exact: true }).fill('09:00')
  await widget.getByLabel('结束时间', { exact: true }).fill('10:00')
  await widget.getByRole('button', { name: '保存打卡', exact: true }).click()
  await widget.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await widget.getByRole('button', { name: '关闭面板', exact: true }).click()
  const beforeFocus = unwrap(await widget.evaluate(() => window.workbench.researchReport()))
  await widget.getByRole('button', { name: '心流模式', exact: true }).click()
  await sized(0.6, true)
  await widget.screenshot({ path: join(evidence, 'focus-60.png'), omitBackground: true })
  assert.deepEqual(unwrap(await widget.evaluate(() => window.workbench.researchReport())), beforeFocus)
  await widget.keyboard.press('Escape')
  await sized(0.6)
  pass('scaled manual entry and focus animation remain functional without changing attendance')
  await app.close(); app = null
  await launch()
  await sized(0.6)
  assert.equal(unwrap(await widget.evaluate(() => window.workbench.widgetSnapshot())).preferences.scale, 0.6)
  unwrap(await widget.evaluate(() => window.workbench.updateWidgetPreferences({ scale: null })))
  await sized(initial.scale)
  pass('manual size survives restart and automatic sizing can be restored')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, automatic }, null, 2))
  if (process.argv.includes('--inspect')) {
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].show(); BrowserWindow.getAllWindows()[0].focus() })
    console.log('INSPECTION_READY', join(profile, 'inspection-done'))
    await new Promise(resolve => { const started = Date.now(); const timer = setInterval(() => {
      if (existsSync(join(profile, 'inspection-done')) || Date.now() - started > 120000) { clearInterval(timer); resolve() }
    }, 500) })
  }
} finally { if (app) await app.close() }
