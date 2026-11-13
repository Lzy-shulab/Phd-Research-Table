import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const exe = option('executable'), profile = option('profile')
const output = resolve(option('output') || 'test-results/desktop-gpu')
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, `profile-${Date.now()}`), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', ...(profile ? { WORKBENCH_GPU_PROFILE: resolve(profile) } : {}) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(exe || 'node_modules/electron/dist/electron.exe'), args: exe ? [] : ['.'], env })
app.context().setDefaultTimeout(20000)
const errors = [], checks = []
app.on('window', page => page.on('pageerror', e => errors.push(e.message)))
const unwrap = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data }
const pageWith = async text => {
  for (let i = 0; i < 100; i++) { const page = app.windows().find(p => p.url().includes(text)); if (page) return page; await new Promise(r => setTimeout(r, 100)) }
  throw Error('Missing page ' + text)
}
const pass = text => { checks.push(text); console.log('PASS', text) }
try {
  const rail = await pageWith('rail.html')
  await rail.getByRole('button', { name: 'GPU 监控', exact: true }).click()
  const panel = await pageWith('widget.html')
  const snapshot = unwrap(await panel.evaluate(() => window.workbench.gpuMonitor()))
  if (profile) {
    assert.equal(snapshot.auth, 'ready', JSON.stringify({ error: snapshot.error, cpolar: snapshot.cpolar.error }))
    assert.ok(snapshot.total > 0)
    assert.equal(snapshot.total, snapshot.idle + snapshot.busy + snapshot.unknown)
    await panel.locator('.gpu-device').first().waitFor()
    assert.equal(await panel.locator('.gpu-device').count(), snapshot.total)
    await rail.waitForFunction(({ idle, total }) => document.querySelector('#gpu-status').textContent === `${idle} / ${total} 空闲`, snapshot)
    await panel.waitForTimeout(350)
    await panel.screenshot({ path: join(output, 'gpu.png'), scale: 'css' })
    await rail.screenshot({ path: join(output, 'rail.png'), scale: 'css' })
    pass('authenticated GPU data and idle counts agree between rail and panel')
    await panel.getByRole('tab', { name: 'Cpolar', exact: true }).click()
    assert.equal(await panel.locator('.gpu-tunnel').count(), snapshot.cpolar.tunnels.length)
    await panel.screenshot({ path: join(output, 'cpolar.png'), scale: 'css' })
    const tcp = snapshot.cpolar.tunnels.find(t => t.protocol === 'tcp')
    // Observe the native clipboard call without replacing the user's clipboard contents.
    if (tcp) {
      await app.evaluate(({ clipboard }) => { globalThis.savedGpuClipboard = clipboard.writeText; clipboard.writeText = value => { globalThis.gpuCopiedValue = value } })
      try {
        await panel.getByRole('button', { name: `复制 ${tcp.name} TCP 地址`, exact: true }).click()
        assert.equal(await app.evaluate(() => globalThis.gpuCopiedValue), tcp.url.replace(/^tcp:\/\//, ''))
      } finally { await app.evaluate(({ clipboard }) => { clipboard.writeText = globalThis.savedGpuClipboard }) }
    }
    pass('Cpolar statuses, full addresses and TCP host-port copy are usable')
    console.log('LIVE', JSON.stringify({ total: snapshot.total, idle: snapshot.idle, busy: snapshot.busy, unknown: snapshot.unknown, tunnels: snapshot.cpolar.tunnels.length }))
  } else {
    assert.equal(snapshot.auth, 'required')
    await panel.getByRole('button', { name: '登录 GPU 看板', exact: true }).waitFor()
    pass('fresh profiles display the real login entry instead of invented GPU counts')
  }
  await rail.getByRole('button', { name: '打卡记录', exact: true }).click()
  await panel.getByRole('button', { name: '填写打卡起止时间' }).waitFor()
  await panel.waitForTimeout(350)
  const controls = await panel.evaluate(() => {
    const box = document.querySelector('.desktop-panel').getBoundingClientRect()
    const buttons = [...document.querySelectorAll('.desktop-checkin-actions button')].map(b => ({ text: b.textContent, height: b.getBoundingClientRect().height, width: b.getBoundingClientRect().width, font: getComputedStyle(b).fontSize }))
    return { buttons, focusBottom: document.querySelector('.desktop-focus-start').getBoundingClientRect().bottom, bottom: box.bottom, overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.ok(controls.buttons.every(button => button.height >= 55 && parseFloat(button.font) >= 16))
  assert.ok(Math.max(...controls.buttons.map(b => b.width)) - Math.min(...controls.buttons.map(b => b.width)) < 1)
  assert.ok(controls.focusBottom <= controls.bottom + 1, JSON.stringify(controls))
  assert.equal(controls.overflow, false)
  await panel.screenshot({ path: join(output, 'checkin-controls.png'), scale: 'css' })
  for (const [button, file] of [['出差', 'trip'], ['休假', 'leave'], ['面板设置', 'settings']]) {
    await panel.getByRole('button', { name: button, exact: true }).click()
    await panel.getByRole('dialog').waitFor()
    await panel.waitForTimeout(350)
    await panel.screenshot({ path: join(output, file + '.png'), scale: 'css' })
    await panel.getByRole('button', { name: '关闭面板', exact: true }).click()
  }
  pass('equal-sized attendance actions and secondary panels fit their viewport')
  assert.deepEqual(errors, [])
} catch (error) { console.error(error); throw error } finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2))
  await app.close()
}
