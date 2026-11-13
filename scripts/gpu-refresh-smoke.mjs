import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mockGpuCollection } from './test-helpers.mjs'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable')
const output = resolve(option('output') || 'test-results/gpu-refresh')
const profile = join(output, 'profile'), config = join(profile, '.ssh/config')
mkdirSync(join(profile, '.ssh'), { recursive: true })
const original = 'Host YunBensheng\n    HostName old.cpolar.cn\n    User researcher\n    Port 13771\n'
writeFileSync(config, original)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_CODEX_AUTO: '1',
  WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(15000)
const errors = [], checks = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const pageWith = async name => {
  for (let index = 0; index < 100; index++) {
    const page = app.windows().find(page => page.url().includes(name))
    if (page) return page
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw Error(`Missing page ${name}`)
}
try {
  await app.evaluate(async ({ session }, profilePath) => {
    const connection = session.fromPath(profilePath, { cache: false })
    globalThis.refreshFixture = { utilization: 11, liveUtilization: 88, port: 14001, failed: false, requests: [] }
    globalThis.gpuCollectionFixture = () => ({ server_id: 'compute', name: '测试服务器', collected_at: new Date().toISOString(),
      gpus: [{ index: 0, name: 'NVIDIA RTX A6000', utilization: globalThis.refreshFixture.liveUtilization, memory_used_mb: 128, memory_total_mb: 49152 }] })
    await connection.protocol.handle('https', async request => {
      const url = new URL(request.url), source = globalThis.refreshFixture
      source.requests.push({ path: url.pathname, method: request.method })
      if (url.origin !== 'https://shulab-gpu-monitor.netlify.app') return Response.json({}, { status: 404 })
      const now = new Date().toISOString()
      if (url.pathname === '/api/status') return Response.json({ server_now: now, servers: [{ server_id: 'compute', name: '测试服务器', collected_at: now,
        received_at: now, gpus: [{ index: 0, name: 'NVIDIA RTX A6000', utilization: source.utilization, memory_used_mb: 128, memory_total_mb: 49152 }] }] })
      if (url.pathname === '/api/cpolar' || url.pathname === '/api/cpolar/refresh') {
        const live = url.pathname.endsWith('/refresh')
        if (live && request.method !== 'POST') return Response.json({ error: 'Expected POST' }, { status: 405 })
        if (live && source.failed) return Response.json({ error: 'Refresh unavailable' }, { status: 503 })
        return Response.json({ checked_at: live ? now : '2026-11-01T00:00:00Z', tunnels: [{ id: 'ssh', name: 'ssh', protocol: 'tcp', status: 'online',
          url: `tcp://${live ? 'latest' : 'saved'}.cpolar.cn:${live ? source.port : 13771}` }] })
      }
      return Response.json({}, { status: 404 })
    })
    process.env.WORKBENCH_DISABLE_GPU_AUTO = '0'
  }, join(profile, 'gpu-monitor-session'))
  await mockGpuCollection(app)
  const rail = await pageWith('rail.html')
  await rail.getByRole('button', { name: 'GPU 监控', exact: true }).click()
  const panel = await pageWith('widget.html')
  await panel.getByRole('meter', { name: 'GPU 0 利用率', exact: true }).waitFor()
  assert.equal(await panel.getByRole('meter', { name: 'GPU 0 利用率', exact: true }).getAttribute('aria-valuenow'), '11')
  await panel.getByRole('button', { name: '刷新监控', exact: true }).click()
  await panel.waitForFunction(() => document.querySelector('[aria-label="GPU 0 利用率"]')?.getAttribute('aria-valuenow') === '88')
  assert.equal(await app.evaluate(() => globalThis.gpuCollectionCalls), 1)
  checks.push('GPU refresh triggers a new remote collection and displays it even when the dashboard still contains the old metrics')
  await panel.getByRole('tab', { name: 'Cpolar', exact: true }).click()
  await panel.getByText('saved.cpolar.cn:13771', { exact: true }).waitFor()
  await app.evaluate(() => { globalThis.refreshFixture.port = 15002 })
  await panel.getByRole('button', { name: '刷新地址并更新 SSH', exact: true }).click()
  await panel.getByText('latest.cpolar.cn:15002', { exact: true }).waitFor()
  await panel.waitForFunction(() => !document.querySelector('.gpu-refresh').disabled)
  assert.equal(readFileSync(config, 'utf8'), original.replace('old.cpolar.cn', 'latest.cpolar.cn').replace('13771', '15002'))
  checks.push('Cpolar refresh queries the live endpoint and writes that response to the isolated SSH config')
  await app.evaluate(() => { globalThis.refreshFixture.port = 16003 })
  await panel.getByRole('button', { name: '更新 SSH', exact: true }).click()
  await panel.getByText('latest.cpolar.cn:16003', { exact: true }).waitFor()
  await panel.waitForFunction(() => !document.querySelector('.gpu-refresh').disabled)
  assert.ok(readFileSync(config, 'utf8').includes('Port 16003'))
  assert.equal(readFileSync(config + '.cpolar-backup', 'utf8'), original)
  checks.push('Update SSH also queries the live endpoint before writing')
  await app.evaluate(() => { globalThis.refreshFixture.failed = true })
  await panel.getByRole('button', { name: '刷新地址并更新 SSH', exact: true }).click()
  await panel.getByText('未更新，保留原配置', { exact: false }).waitFor()
  assert.ok(readFileSync(config, 'utf8').includes('Port 16003'))
  checks.push('A failed live query is shown as a failure and leaves the existing SSH config intact')
  const requests = await app.evaluate(() => globalThis.refreshFixture.requests)
  assert.equal(requests.filter(r => r.path === '/api/status').length, 2)
  assert.equal(requests.filter(r => r.path === '/api/cpolar').length, 1)
  assert.equal(requests.filter(r => r.path === '/api/cpolar/refresh' && r.method === 'POST').length, 3)
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, requests, errors }, null, 2))
  console.log(JSON.stringify({ checks, errors }, null, 2))
} finally { await app.close() }
