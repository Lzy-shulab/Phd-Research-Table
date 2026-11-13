import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { mockGpuCollection } from './test-helpers.mjs'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable')
const output = resolve(option('output') || 'test-results/gpu-owners')
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, 'profile'), WORKBENCH_DISABLE_GPU_AUTO: '1',
  WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? [] : ['.'], env })
app.context().setDefaultTimeout(15000)
const errors = [], checks = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pageWith = async name => {
  for (let index = 0; index < 100; index++) { const page = app.windows().find(page => page.url().includes(name)); if (page) return page; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw Error(`Missing page ${name}`)
}
try {
  await app.evaluate(async ({ session }, profilePath) => {
    const connection = session.fromPath(profilePath)
    globalThis.ownerFixture = { team_members: ['研究员甲', '同事乙', '团队成员丙'], servers: [{ server_id: 'compute', name: '测试计算服务器',
      gpus: [{ index: 0, uuid: 'GPU-A6000', name: 'NVIDIA RTX A6000', utilization: 96, memory_used_mb: 24000, memory_total_mb: 49152,
        processes: [{ command: 'python train.py', process_type: 'C' }], user_names: ['研究员甲'] },
      { index: 1, name: 'NVIDIA RTX A6000', utilization: 0, memory_used_mb: 128, memory_total_mb: 49152, user_names: [] }] }] }
    globalThis.gpuCollectionFixture = () => ({ ...globalThis.ownerFixture.servers[0], collected_at: new Date().toISOString() })
    globalThis.ownerPosts = []; globalThis.ownerFailure = false; globalThis.ownerRequests = []
    await connection.protocol.handle('https', async request => {
      const url = new URL(request.url)
      globalThis.ownerRequests.push(url.pathname)
      if (url.origin !== 'https://shulab-gpu-monitor.netlify.app') return new Response('Unexpected origin', { status: 404 })
      if (url.pathname === '/api/status') {
        const now = new Date().toISOString()
        return Response.json({ ...globalThis.ownerFixture, server_now: now, servers: globalThis.ownerFixture.servers.map(server => ({ ...server, collected_at: now, received_at: now })) })
      }
      if (url.pathname === '/api/cpolar') return Response.json({ tunnels: [] })
      if (url.pathname === '/api/usage') {
        const body = await request.json(); globalThis.ownerPosts.push(body)
        await new Promise(resolve => setTimeout(resolve, 350))
        if (globalThis.ownerFailure) return Response.json({ error: '看板暂时无法保存，请重试。' }, { status: 503 })
        if (request.method !== 'POST' || request.headers.get('Origin') !== url.origin) return Response.json({ error: 'Unexpected write request' }, { status: 400 })
        const server = globalThis.ownerFixture.servers.find(server => server.server_id === body.server_id)
        const gpu = server?.gpus.find(gpu => (gpu.uuid || `index:${gpu.index}`) === body.gpu_key)
        if (!gpu) return Response.json({ error: 'Unknown GPU' }, { status: 404 })
        gpu.user_names = body.user_names
        return Response.json({ user_names: gpu.user_names })
      }
      return new Response('Unexpected path', { status: 404 })
    })
    process.env.WORKBENCH_DISABLE_GPU_AUTO = '0'
  }, join(env.WORKBENCH_DATA_DIR, 'gpu-monitor-session'))
  await mockGpuCollection(app)
  const rail = await pageWith('rail.html')
  await rail.getByRole('button', { name: 'GPU 监控', exact: true }).click()
  const panel = await pageWith('widget.html')
  const device = panel.locator('.gpu-device').first()
  const edit = device.getByRole('button', { name: '设置 GPU 0 使用人', exact: true })
  await edit.waitFor()
  assert.equal((unwrap(await panel.evaluate(() => window.workbench.gpuMonitor()))).teamMembers.length, 3)
  await edit.click()
  await panel.getByRole('checkbox', { name: '同事乙', exact: true }).check()
  await panel.evaluate(() => window.workbench.gpuMonitor(true))
  assert.equal(await panel.getByRole('checkbox', { name: '同事乙', exact: true }).isChecked(), true)
  await panel.screenshot({ path: join(output, 'owner-editor.png'), scale: 'css' })
  await panel.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(await app.evaluate(() => globalThis.ownerPosts.length), 0)
  checks.push('cancel preserves website state; refresh preserves the edit draft')

  await edit.click()
  await panel.getByRole('checkbox', { name: '同事乙', exact: true }).check()
  await panel.getByRole('button', { name: '保存并同步', exact: true }).click()
  assert.equal(await panel.getByRole('button', { name: '同步中…', exact: true }).isDisabled(), true)
  await panel.getByText('使用人已同步到网页', { exact: true }).waitFor()
  assert.deepEqual(await app.evaluate(() => globalThis.ownerFixture.servers[0].gpus[0].user_names), ['研究员甲', '同事乙'])
  assert.deepEqual(await app.evaluate(() => globalThis.ownerPosts[0]), { server_id: 'compute', gpu_key: 'GPU-A6000', user_names: ['研究员甲', '同事乙'] })
  assert.ok((await edit.textContent()).includes('研究员甲、同事乙'))
  checks.push('desktop selection reaches the website API and updates shared owner state')

  await edit.click(); await panel.getByRole('button', { name: '清空', exact: true }).click()
  await panel.getByRole('button', { name: '保存并同步', exact: true }).click()
  await panel.waitForFunction(() => !document.querySelector('.gpu-owner-form'))
  assert.deepEqual((unwrap(await panel.evaluate(() => window.workbench.gpuMonitor()))).servers[0].devices[0].owners, [])
  assert.ok((await edit.textContent()).includes('设置使用人'))
  await app.evaluate(() => { globalThis.ownerFailure = true })
  await edit.click(); await panel.getByRole('checkbox', { name: '同事乙', exact: true }).check()
  await panel.getByRole('button', { name: '保存并同步', exact: true }).click()
  await panel.getByRole('alert').filter({ hasText: '看板暂时无法保存，请重试。' }).waitFor()
  await panel.waitForFunction(() => document.querySelector('.gpu-owner-actions').getBoundingClientRect().bottom <= document.querySelector('.gpu-content').getBoundingClientRect().bottom + 1)
  assert.equal(await panel.getByRole('checkbox', { name: '同事乙', exact: true }).isChecked(), true)
  assert.deepEqual((unwrap(await panel.evaluate(() => window.workbench.gpuMonitor()))).servers[0].devices[0].owners, [])
  await panel.screenshot({ path: join(output, 'owner-retry.png'), scale: 'css' })
  await app.evaluate(() => { globalThis.ownerFailure = false })
  await panel.getByRole('button', { name: '保存并同步', exact: true }).click()
  await panel.waitForFunction(() => !document.querySelector('.gpu-owner-form'))
  checks.push('clear, failure with retained draft, and retry work through the real IPC/service path')

  await app.evaluate(() => { globalThis.ownerFixture.servers[0].gpus[0].user_names = ['研究员甲'] })
  await panel.getByRole('button', { name: '刷新监控', exact: true }).click()
  await panel.waitForFunction(() => document.querySelector('.gpu-owner-edit')?.textContent === '研究员甲')
  await edit.click()
  const geometry = await panel.locator('.gpu-owner-form').evaluate(form => {
    const box = form.getBoundingClientRect(), content = document.querySelector('.gpu-content').getBoundingClientRect()
    return { overflow: document.documentElement.scrollWidth > innerWidth, fits: box.left >= content.left && box.right <= content.right,
      actionHeight: form.querySelector('button[type="submit"]').getBoundingClientRect().height }
  })
  assert.equal(geometry.overflow, false); assert.equal(geometry.fits, true); assert.ok(geometry.actionHeight >= 48)
  await panel.getByRole('checkbox', { name: '研究员甲', exact: true }).press('Escape')
  assert.equal(await panel.locator('.gpu-owner-form').count(), 0)
  assert.equal(await edit.evaluate(button => document.activeElement === button), true)
  await panel.screenshot({ path: join(output, 'gpu-owners.png'), scale: 'css' })
  checks.push('website changes return on refresh; keyboard cancel restores focus; controls fit the panel')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ checks, errors, geometry }, null, 2))
} catch (error) {
  console.error(JSON.stringify({ requests: await app.evaluate(() => globalThis.ownerRequests), windows: app.windows().map(page => page.url()), errors }))
  const panel = app.windows().find(page => page.url().includes('widget.html'))
  if (panel) { console.error(JSON.stringify(await panel.evaluate(() => window.workbench.gpuMonitor()))); await panel.screenshot({ path: join(output, 'failure.png'), scale: 'css' }) }
  throw error
} finally {
  writeFileSync(join(output, 'report.json'), JSON.stringify({ checks, errors }, null, 2))
  await app.close()
}
