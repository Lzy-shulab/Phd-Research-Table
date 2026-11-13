import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable'), output = resolve(option('output') || `test-results/widget-copy-tour-${Date.now()}`)
const profile = join(output, 'profile')
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_WIDGET_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1',
  WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? ['--workbench'] : ['.', '--workbench'], env })
const visited = [], errors = []
try {
  const main = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await main.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  for (const panel of ['checkin', 'tasks', 'submissions', 'reading', 'gpu', 'codex', 'more']) {
    const result = await main.evaluate(id => window.workbench.openDesktopPanel(id), panel); assert.ok(result.ok)
    let page
    for (let attempt = 0; attempt < 50; attempt++) { page = app.windows().find(value => value.url().includes(`panel=${panel}`)); if (page) break; await main.waitForTimeout(100) }
    assert.ok(page, panel)
    page.setDefaultTimeout(10000); page.on('pageerror', error => errors.push(error.message))
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.locator('.desktop-panel').waitFor()
    await app.evaluate(({ BrowserWindow }, panel) => { const win = BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes(`panel=${panel}`)); win.hide(); win.webContents.setBackgroundThrottling(false) }, panel)
    const shot = async name => {
      await page.waitForTimeout(350)
      const bytes = await app.evaluate(({ BrowserWindow }, panel) => BrowserWindow.getAllWindows().find(win => win.webContents.getURL().includes(`panel=${panel}`)).webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => image.toPNG().toString('base64')), panel)
      writeFileSync(join(output, `${name}.png`), Buffer.from(bytes, 'base64')); visited.push(name)
      console.log('CHECKED', name)
    }
    await shot(panel)
    if (panel === 'checkin') {
      for (const name of ['填写打卡起止时间', '出差', '休假', '面板设置', '设置天气城市']) {
        await page.getByRole('button', { name, exact: true }).click(); await page.getByRole('dialog').waitFor(); await shot(`checkin-${name}`)
        await page.getByRole('button', { name: '返回桌面面板', exact: true }).click(); await page.getByRole('dialog').waitFor({ state: 'hidden' })
      }
    }
    if (panel === 'gpu') { await page.getByRole('tab', { name: 'Cpolar', exact: true }).click(); await shot('gpu-cpolar') }
  }
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ visited, errors }, null, 2))
} finally { await app.close() }
