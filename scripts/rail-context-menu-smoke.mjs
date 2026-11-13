import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executable = process.argv.find(arg => arg.startsWith('--executable='))?.slice(13)
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-results/rail-context-menu/ui')
mkdirSync(output, { recursive: true })
const profile = join(output, `profile-${Date.now()}`)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(15000)
const errors = [], checks = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const pass = text => { checks.push(text); console.log('PASS', text) }
const pageWith = async text => {
  for (let index = 0; index < 100; index++) {
    const page = app.windows().find(page => page.url().includes(text))
    if (page) return page
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Missing ${text}`)
}
try {
  const rail = await pageWith('rail.html')
  await rail.getByRole('button', { name: '打开 PhD 工作台', exact: true }).waitFor()
  assert.equal(await rail.locator('[data-panel=more]').count(), 0)
  assert.equal(await rail.locator('nav button:visible').count(), 7)
  assert.equal(await rail.evaluate(() => innerHeight), 536)
  await rail.screenshot({ path: join(output, 'rail.png'), scale: 'css' })
  // Capture the native menu so its actions can be exercised without OS input.
  await app.evaluate(({ Menu }) => { Menu.prototype.popup = function () { globalThis.railContextMenu = this } })
  await rail.locator('#workbench').click({ button: 'right' })
  assert.deepEqual(await app.evaluate(() => globalThis.railContextMenu.items.map(item => item.label)), ['便签管理'])
  await app.evaluate(() => globalThis.railContextMenu.getMenuItemById('manage-shortcuts').click())
  const panel = await pageWith('panel=more')
  await panel.getByRole('switch', { name: '在桌面显示Codex 额度', exact: true }).waitFor()
  assert.equal(await panel.getByRole('switch').count(), 6)
  assert.equal(await panel.locator('.desktop-header strong').innerText(), '便签管理')
  pass('More is removed; right-click opens management directly')
  await panel.getByRole('switch', { name: '在桌面显示Codex 额度', exact: true }).uncheck()
  await panel.waitForFunction(() => !document.querySelector('.desktop-more-list input:disabled'))
  await panel.getByRole('button', { name: '上移任务总览', exact: true }).click()
  await panel.waitForFunction(() => !document.querySelector('.desktop-more-list input:disabled'))
  assert.equal(await rail.locator('[data-panel=codex]').isVisible(), false)
  assert.equal(await rail.locator('#rail-shortcuts button:visible').first().getAttribute('data-panel'), 'tasks')
  await panel.screenshot({ path: join(output, 'manage.png'), scale: 'css' })
  await panel.getByRole('button', { name: '完成', exact: true }).click()
  await rail.locator('#workbench').click({ button: 'right' })
  assert.deepEqual(await app.evaluate(() => globalThis.railContextMenu.items.filter(item => item.type !== 'separator').map(item => item.label)), ['Codex 额度', '便签管理'])
  await app.evaluate(() => globalThis.railContextMenu.getMenuItemById('open-codex').click())
  await panel.getByRole('button', { name: '刷新额度', exact: true }).waitFor()
  pass('ordering and hiding still work; hidden quota opens from the context menu')
  const saved = await panel.evaluate(() => window.workbench.widgetSnapshot())
  assert.equal(saved.ok, true)
  assert.deepEqual(saved.data.preferences.hiddenPanels, ['codex'])
  assert.equal(saved.data.preferences.railOrder[0], 'tasks')
  assert.equal(await rail.evaluate(() => [...document.querySelectorAll('nav button:not([hidden])')].every(button => button.getBoundingClientRect().bottom <= innerHeight)), true)
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'result.json'), JSON.stringify({ checks, errors, height: 536, entries: 7 }, null, 2))
} finally { await app.close() }
