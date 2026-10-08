import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results', 'theme-removal', executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: profile,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE

const errors = []
const checks = []
const pass = (message) => { checks.push(message); console.log('PASS', message) }
const unwrap = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const app = await electron.launch({ ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['.'] }), env })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]
    window.setContentSize(1280, 860)
    window.showInactive()
    window.webContents.setBackgroundThrottling(false)
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const preferences = unwrap(await page.evaluate(() => window.workbench.interfacePreferences())).preferences
  assert.equal(preferences.visualStyle, 'classic')
  assert.equal(await page.locator('html').getAttribute('data-visual-style'), null)
  assert.equal(await page.locator('[class*="wilds"]').count(), 0)
  pass('the runtime opens in the geometric research-notes style without a theme marker or themed ornament')

  const rejected = await page.evaluate(() => window.workbench.updateInterfacePreferences({ visualStyle: 'wilds' }))
  assert.equal(rejected.ok, false)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.interfacePreferences())).preferences.visualStyle, 'classic')
  pass('the removed style cannot be selected through the interface API')

  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '外观与显示', exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: '工作台风格', exact: true }).count(), 0)
  assert.equal(await page.getByRole('group', { name: '工作台风格', exact: true }).count(), 0)
  assert.equal(await page.getByText('旷野遗迹', { exact: true }).count(), 0)
  assert.equal(await page.getByText(/塞尔达传说灵感/).count(), 0)
  await page.getByRole('button', { name: '青绿背景', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.background === 'sage')
  await page.getByRole('button', { name: '深色', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark')
  assert.equal(unwrap(await page.evaluate(() => window.workbench.interfacePreferences())).preferences.visualStyle, 'classic')
  await page.screenshot({ path: join(evidence, 'settings-single-style.png'), animations: 'disabled', scale: 'css' })
  pass('appearance settings contain no style card while background and display controls remain usable')

  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ checks, errors, profile, executablePath: executablePath ?? 'development' }, null, 2))
  console.log(`ALL ${checks.length} THEME REMOVAL CHECKS PASSED`)
} finally {
  await app.close()
}
