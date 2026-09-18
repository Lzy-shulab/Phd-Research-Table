import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const live = process.env.WORKBENCH_UPDATE_LIVE === '1'
const directory = resolve(`test-results/current/update-${executablePath ? 'packaged' : 'development'}`)
const dataDirectory = join(directory, `data-${Date.now()}`)
mkdirSync(directory, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: dataDirectory, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', ...(!executablePath && !live ? { WORKBENCH_UPDATE_TEST_NODE_FETCH: '1' } : {}) }
delete env.ELECTRON_RUN_AS_NODE
let app
let page
const errors = []
try {
  app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  if (!live) await app.evaluate(() => {
      globalThis.fetch = async (input) => {
        const url = String(input)
        if (url === 'https://api.github.com/repos/Lzy-shulab/Phd-Research-Table/releases/latest') return new Response(JSON.stringify({
          tag_name: 'v0.7.4', name: 'PhD 科研工作台 0.7.4',
          html_url: 'https://github.com/Lzy-shulab/Phd-Research-Table/releases/tag/v0.7.4',
          published_at: '2026-09-10T00:00:00Z', draft: false, prerelease: false,
          assets: [{ name: 'PhD-Research-Workbench-0.7.4-Setup.exe', size: 10,
            browser_download_url: 'https://github.com/Lzy-shulab/Phd-Research-Table/releases/download/v0.7.4/PhD-Research-Workbench-0.7.4-Setup.exe',
            digest: `sha256:${'a'.repeat(64)}` }]
        }), { status: 200 })
        return new Response('', { status: 404 })
      }
    })
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '软件更新', exact: true }).waitFor()
  assert.equal(await page.getByText(/仅在你点击后连接固定的 GitHub 仓库/).count(), 0)
  assert.equal(await page.getByText(/更新包不会操作工作台数据库/).count(), 0)
  await page.getByRole('button', { name: '检查并下载更新', exact: true }).click()
  if (live) await page.getByText(/当前版本 0\.7\.4 高于 GitHub 正式版|当前已是最新版 0\.7\.4/).waitFor()
  else await page.getByText('当前已是最新版 0.7.4。', { exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '安装更新', exact: true }).count(), 0)
  await page.screenshot({ path: join(directory, 'settings-update.png'), animations: 'disabled', scale: 'css' })
  assert.deepEqual(errors, [])
  writeFileSync(join(directory, 'report.json'), JSON.stringify({ checks: ['concise settings update control', 'fixed GitHub latest request', 'up-to-date branch'], errors, dataDirectory, executablePath: executablePath ?? 'development', boundary: live ? 'Live GitHub Latest Release metadata check; no installer was downloaded or launched because the local version was current or newer.' : 'GitHub response stubbed in the Electron main process; no installer was downloaded or launched.' }, null, 2))
  console.log('ALL 3 UPDATE SETTINGS CHECKS PASSED')
} catch (error) {
  if (page) {
    await page.screenshot({ path: join(directory, 'settings-update-failure.png'), animations: 'disabled', scale: 'css' }).catch(() => {})
    const visibleText = await page.locator('body').innerText().catch(() => '')
    writeFileSync(join(directory, 'failure.txt'), `${error instanceof Error ? error.stack : String(error)}\n\nVISIBLE UI\n${visibleText}\n`)
    console.error(visibleText)
  }
  throw error
} finally { if (app) await app.close() }
