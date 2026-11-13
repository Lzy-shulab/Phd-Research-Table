import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
const executable = resolve(process.argv.find(arg => arg.startsWith('--executable='))?.slice(13) || 'release/win-unpacked/PhD 科研工作台.exe')
const output = resolve(process.argv.find(arg => arg.startsWith('--output='))?.slice(9) || 'test-results/performance-attendance/before')
mkdirSync(output, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, `profile-${Date.now()}`), WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: executable, args: [], env })
app.context().setDefaultTimeout(15000)
const samples = []
const findPage = async text => {
  for (let index = 0; index < 100; index++) {
    const page = app.windows().find(page => page.url().includes(text))
    if (page) return page
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error(`Missing ${text}`)
}
const sample = async name => {
  await app.evaluate(({ app }) => { app.getAppMetrics() })
  await new Promise(resolve => setTimeout(resolve, 1500))
  const value = await app.evaluate(({ app, BrowserWindow }) => {
    const processes = app.getAppMetrics()
    return { privateMiB: Math.round(processes.reduce((sum, item) => sum + (item.memory.privateBytes ?? 0), 0) / 1024 * 10) / 10,
      cpu: Math.round(processes.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0) * 100) / 100,
      processes: processes.length, windows: BrowserWindow.getAllWindows().map(window => ({ kind: window.webContents.getURL().includes('index.html') ? 'workbench' : window.webContents.getURL().includes('rail.html') ? 'rail' : 'panel', visible: window.isVisible() })) }
  })
  samples.push({ name, ...value }); console.log(name, JSON.stringify(value))
}
try {
  const rail = await findPage('rail.html')
  await rail.locator('#workbench').waitFor()
  await sample('rail')
  await rail.evaluate(() => window.workbench.openDesktopPanel('checkin'))
  const panel = await findPage('widget.html')
  await panel.getByRole('progressbar', { name: '本周研究进度' }).waitFor()
  await sample('attendance')
  const frames = await panel.evaluate(() => new Promise(resolve => {
    const intervals = []; let previous = performance.now(), start = previous
    const frame = now => { intervals.push(now - previous); previous = now; if (now - start < 1800) requestAnimationFrame(frame); else { const sorted = intervals.slice(1).sort((a,b) => a-b); resolve({ fps: Math.round((intervals.length - 1) * 1000 / sorted.reduce((a,b) => a+b, 0)), p95FrameMs: Math.round(sorted[Math.floor(sorted.length * .95)] * 10) / 10 }) } }
    requestAnimationFrame(frame)
  }))
  await rail.evaluate(() => window.workbench.openWorkbench())
  const main = await findPage('index.html')
  await main.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await sample('workbench-open')
  await main.evaluate(() => window.workbench.returnToDesktop()).catch(() => {})
  await sample('returned-to-panel')
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().find(window => window.webContents.getURL().includes('index.html'))?.close() })
  await sample('workbench-closed')
  writeFileSync(join(output, 'profile.json'), JSON.stringify({ samples, frames, externalAutoServices: false }, null, 2))
  console.log('frames', JSON.stringify(frames))
} finally { await app.close() }
