import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3)
const exe = option('executable')
const output = resolve(option('output') || 'test-results/cpolar-ssh-ui')
const profile = join(output, 'profile')
mkdirSync(join(profile, '.ssh'), { recursive: true })
const configPath = join(profile, '.ssh', 'config')
const original = 'Host YunBensheng\r\n    HostName old.cpolar.cn\r\n    User ss\r\n    Port 13771\r\n    ForwardX11 yes\r\n    IdentityFile "C:\\test\\id_rsa"\r\n\r\nHost Chengyuan\r\n    HostName other.cpolar.top\r\n    Port 11804\r\n'
writeFileSync(configPath, original)
const loginProfile = option('login-profile')
if (loginProfile) {
  mkdirSync(join(profile, 'gpu-monitor-session', 'Network'), { recursive: true })
  copyFileSync(join(loginProfile, 'Local State'), join(profile, 'Local State'))
  copyFileSync(join(loginProfile, 'gpu-monitor-session', 'Network', 'Cookies'), join(profile, 'gpu-monitor-session', 'Network', 'Cookies'))
}
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(exe || 'node_modules/electron/dist/electron.exe'), args: exe ? [] : ['.'], env })
app.context().setDefaultTimeout(25000)
const errors = []
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
const waitPage = async name => {
  for (let i = 0; i < 150; i++) { const page = app.windows().find(page => page.url().includes(name)); if (page) return page; await new Promise(resolve => setTimeout(resolve, 100)) }
  throw new Error(`Missing window: ${name}`)
}
try {
  const rail = await waitPage('rail.html')
  await rail.getByRole('button', { name: 'GPU 监控', exact: true }).click()
  const panel = await waitPage('widget.html')
  await panel.waitForFunction(async () => { const r = await window.workbench.gpuMonitor(); return r.ok && r.data.sshSync.checkedAt && !r.data.sshSync.syncing })
  const snapshot = unwrap(await panel.evaluate(() => window.workbench.gpuMonitor()))
  assert.equal(snapshot.sshSync.configPath, configPath)
  assert.equal(snapshot.sshSync.error, null)
  assert.equal(snapshot.sshSync.result, 'updated')
  const tunnel = snapshot.cpolar.tunnels.find(t => t.name.toLowerCase() === 'ssh')
  const endpoint = new URL(tunnel.url)
  assert.equal(readFileSync(configPath, 'utf8'), original.replace('old.cpolar.cn', endpoint.hostname).replace('13771', endpoint.port))
  assert.equal(readFileSync(configPath + '.cpolar-backup', 'utf8'), original)
  await panel.getByRole('tab', { name: 'Cpolar', exact: true }).click()
  await panel.getByRole('button', { name: '更新 SSH', exact: true }).waitFor()
  await panel.screenshot({ path: join(output, 'cpolar-ssh.png'), scale: 'css' })
  const layout = await panel.evaluate(() => {
    const section = document.querySelector('.gpu-ssh-sync').getBoundingClientRect()
    const button = document.querySelector('.gpu-ssh-action button').getBoundingClientRect()
    return { overflow: document.documentElement.scrollWidth > innerWidth, buttonHeight: button.height, buttonRight: button.right, sectionRight: section.right }
  })
  assert.equal(layout.overflow, false)
  assert.ok(layout.buttonHeight >= 40 && layout.buttonRight <= layout.sectionRight + 1)
  // Replace the network response only inside this isolated test process.
  await app.evaluate(({ session }, payload) => {
    const site = session.fromPath(payload.profile, { cache: false })
    const realFetch = site.fetch.bind(site)
    globalThis.cpolarTest = { calls: 0, fail: false }
    site.fetch = async (input, init) => {
      if (!String(input).endsWith('/api/cpolar/refresh')) return realFetch(input, init)
      if (init?.method !== 'POST') throw new Error('Expected a live Cpolar refresh')
      globalThis.cpolarTest.calls++
      if (globalThis.cpolarTest.fail) throw new Error('看板暂时无法连接')
      return new Response(JSON.stringify(payload.source))
    }
  }, { profile: join(profile, 'gpu-monitor-session'), source: { checked_at: new Date().toISOString(), tunnels: [{ id: tunnel.id, name: 'ssh', protocol: 'tcp', status: 'online', url: 'tcp://updated.cpolar.cn:14001' }] } })
  await panel.getByRole('button', { name: '更新 SSH', exact: true }).click()
  await panel.waitForFunction(async () => { const r = await window.workbench.gpuMonitor(); return r.ok && r.data.sshSync.address === 'updated.cpolar.cn:14001' && !r.data.sshSync.syncing })
  assert.equal(readFileSync(configPath, 'utf8'), original.replace('old.cpolar.cn', 'updated.cpolar.cn').replace('13771', '14001'))
  await app.evaluate(() => { globalThis.cpolarTest.fail = true })
  await panel.getByRole('button', { name: '刷新地址并更新 SSH', exact: true }).click()
  await panel.getByText('未更新，保留原配置', { exact: false }).waitFor()
  assert.equal(readFileSync(configPath, 'utf8'), original.replace('old.cpolar.cn', 'updated.cpolar.cn').replace('13771', '14001'))
  assert.equal(await app.evaluate(() => globalThis.cpolarTest.calls), 2)
  assert.deepEqual(errors, [])
  const report = { automaticStartup: true, manualRefresh: true, failurePreservesConfig: true, isolatedConfig: true, layout, errors }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log('PASS', JSON.stringify(report))
} finally { await app.close() }
