import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable'), login = option('login-profile')
if (!login) throw Error('Provide an isolated authenticated login profile')
const output = resolve(option('output') || 'test-results/gpu-live-collection'), profile = join(output, 'profile')
mkdirSync(join(profile, 'gpu-monitor-session/Network'), { recursive: true })
for (const file of ['Local State', 'gpu-monitor-session/Network/Cookies']) copyFileSync(join(login, file), join(profile, file))
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_CODEX_AUTO: '1',
  WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(40000)
try {
  await app.evaluate(() => {
    const childProcess = process.getBuiltinModule('node:child_process')
    const original = childProcess.execFile
    globalThis.liveSshCalls = 0
    childProcess.execFile = (file, ...args) => {
      if (/ssh(?:\.exe)?$/i.test(file)) globalThis.liveSshCalls++
      return original(file, ...args)
    }
    process.getBuiltinModule('node:module').syncBuiltinESMExports()
    process.env.WORKBENCH_DISABLE_GPU_AUTO = '0'
  })
  const rail = await app.firstWindow()
  await rail.locator('[data-panel=gpu]').click()
  await waitForAsync(rail, () => Boolean(document.querySelector('[data-panel=gpu][aria-pressed=true]')))
  const panel = app.windows().find(page => page.url().includes('widget.html'))
  await panel.waitForFunction(() => !document.querySelector('[aria-label="刷新监控"]')?.disabled)
  const started = Date.now()
  await panel.getByRole('button', { name: '刷新监控', exact: true }).click()
  await panel.waitForFunction(() => !document.querySelector('[aria-label="刷新监控"]')?.disabled)
  const result = await panel.evaluate(() => window.workbench.gpuMonitor())
  assert.equal(result.ok, true)
  assert.equal(result.data.error, null)
  const server = result.data.servers.find(server => server.id === 'yunbensheng')
  assert.ok(server)
  assert.equal(server.devices.length, 4)
  assert.ok(Date.parse(server.collectedAt) >= started - 1000, 'The capture must belong to this click')
  assert.equal(await app.evaluate(() => globalThis.liveSshCalls), 1)
  const report = { liveSshRequests: 1, devices: server.devices.length, collectedAt: server.collectedAt,
    elapsedMs: Date.now() - started, currentCollectionDisplayed: true }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await app.close() }
