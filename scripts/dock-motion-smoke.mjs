import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/dock-motion', executablePath ? 'packaged' : 'development')
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
const app = await electron.launch(executablePath ? { executablePath, args: [], env } : { args: ['.'], env })
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 860)
    win.webContents.setBackgroundThrottling(false)
    win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  assert.equal(await page.locator('html').getAttribute('data-dock'), 'pinned')
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '外观与显示', exact: true }).waitFor()
  const toggle = page.getByRole('button', { name: '自动隐藏 Dock' })
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false')
  await toggle.click()
  await page.waitForFunction(() => document.documentElement.dataset.dock === 'auto-hide' && document.querySelector('.dock-wrap')?.getAttribute('data-revealed') === 'false')
  await page.waitForTimeout(420)
  const hidden = await page.evaluate(() => {
    const wrap = document.querySelector('.dock-wrap')
    const dock = document.querySelector('.dock')
    if (!(wrap instanceof HTMLElement) || !(dock instanceof HTMLElement)) throw Error('Dock missing')
    const rect = wrap.getBoundingClientRect()
    const before = getComputedStyle(wrap, '::before')
    return {
      top: rect.top,
      bottom: rect.bottom,
      viewportHeight: innerHeight,
      clipPath: before.clipPath,
      silhouette: before.content,
      radius: parseFloat(getComputedStyle(dock).borderRadius),
      transitionDuration: getComputedStyle(wrap).transitionDuration,
      dockHeight: dock.getBoundingClientRect().height
    }
  })
  assert.ok(hidden.top >= hidden.viewportHeight - 13, JSON.stringify(hidden))
  assert.ok(hidden.bottom > hidden.viewportHeight, JSON.stringify(hidden))
  assert.equal(hidden.clipPath, 'none', JSON.stringify(hidden))
  assert.equal(hidden.silhouette, 'none', JSON.stringify(hidden))
  assert.ok(hidden.radius > 100, JSON.stringify(hidden))
  assert.notEqual(hidden.transitionDuration, '0s')
  await page.screenshot({ path: join(evidence, 'dock-hidden.png'), animations: 'disabled', scale: 'css' })

  await page.mouse.move(720, 859)
  await page.waitForFunction(() => document.querySelector('.dock-wrap')?.getAttribute('data-revealed') === 'true')
  await page.waitForTimeout(420)
  const shown = await page.locator('.dock-wrap').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, viewportHeight: innerHeight }
  })
  assert.ok(shown.top < shown.viewportHeight - hidden.dockHeight, JSON.stringify(shown))
  assert.ok(Math.abs(shown.bottom - shown.viewportHeight) <= 1, JSON.stringify(shown))
  await page.screenshot({ path: join(evidence, 'dock-revealed.png'), animations: 'disabled', scale: 'css' })

  // Leaving sideways along the bottom edge must hide just like leaving upward.
  await page.mouse.move(20, 859)
  await page.waitForFunction(() => document.querySelector('.dock-wrap')?.getAttribute('data-revealed') === 'false')
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.waitForFunction(() => document.documentElement.dataset.dock === 'auto-hide')
  await page.locator('.dock-item').first().focus()
  await page.waitForFunction(() => document.querySelector('.dock-wrap')?.getAttribute('data-revealed') === 'true')
  await page.keyboard.press('Tab')
  await page.mouse.move(720, 859)
  await page.mouse.move(20, 859)
  await page.waitForTimeout(350)
  assert.equal(await page.locator('.dock-wrap').getAttribute('data-revealed'), 'true', 'Keyboard focus keeps Dock available after pointer leaves')
  await page.evaluate(async () => {
    const result = await window.workbench.setAppearance('dark')
    if (!result.ok) throw Error(result.error.message)
  })
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.locator('.dock-item').first().focus()
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.querySelector('.dock-wrap')?.getAttribute('data-revealed') === 'true')
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 700))
  const compact = await page.locator('.dock-wrap').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, width: innerWidth, scrollWidth: document.documentElement.scrollWidth }
  })
  assert.ok(compact.left >= 0 && compact.right <= compact.width, JSON.stringify(compact))
  assert.ok(compact.scrollWidth <= compact.width + 1, JSON.stringify(compact))
  await page.screenshot({ path: join(evidence, 'dock-minimum-dark.png'), animations: 'disabled', scale: 'css' })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const reducedDuration = await page.locator('.dock-wrap').evaluate((element) => Number.parseFloat(getComputedStyle(element).transitionDuration))
  assert.ok(reducedDuration <= 0.001, String(reducedDuration))
  assert.deepEqual(errors, [])
  const result = {
    checks: ['floating-capsule-shape', 'auto-hide-setting', 'bottom-edge-reveal', 'delayed-hide', 'restart-persistence', 'keyboard-focus-reveal', 'minimum-dark-layout', 'reduced-motion'],
    hidden,
    shown,
    compact,
    errors
  }
  writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
  console.log('PASS floating Dock capsule, auto-hide reveal, persistence and keyboard access')
} finally {
  await app.close()
}
