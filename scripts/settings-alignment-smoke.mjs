import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const evidence = resolve('test-results/fixes-0.8.25/settings')
mkdirSync(evidence, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(evidence, 'data'), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(process.env.WORKBENCH_TEST_EXECUTABLE), env })
const results = [], errors = []
try {
  const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message))
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '设置', exact: true }).click()
  await page.getByRole('heading', { name: '软件更新', exact: true }).waitFor()
  for (const [width, fontSize, appearance] of [[1600, 14, 'light'], [1100, 18, 'light'], [1100, 18, 'dark']]) {
    await app.evaluate(({ BrowserWindow }, width) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(width, 1000); win.showInactive(); win.webContents.setBackgroundThrottling(false) }, width)
    const changed = await page.evaluate(input => window.workbench.updateInterfacePreferences(input), { fontSize }); assert.equal(changed.ok, true)
    await page.getByRole('button', { name: appearance === 'dark' ? '深色模式' : '浅色模式', exact: true }).click()
    await page.locator('.translation-settings-entry').scrollIntoViewIfNeeded()
    const geometry = await page.evaluate(() => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, right: r.right, center: r.y + r.height / 2, width: r.width } }
      const cards = [...document.querySelectorAll('.settings-action-card')].map(el => ({
        card: rect(el), icon: rect(el.querySelector('.settings-heading-icon')), heading: rect(el.querySelector('h2')), action: rect(el.querySelector('.button'))
      }))
      const overflow = [...document.querySelectorAll('.settings-action-card, .storage-row, .storage-database, .assistant-panel, .appearance-setting')]
        .filter(el => el.scrollWidth > el.clientWidth + 1).map(el => el.className)
      return { cards, overflow, pageWidth: innerWidth, documentWidth: document.documentElement.scrollWidth }
    })
    const [translation, update] = geometry.cards
    assert.ok(Math.abs(translation.icon.x - update.icon.x) <= 1)
    assert.ok(Math.abs(translation.heading.x - update.heading.x) <= 1)
    assert.ok(Math.abs(translation.action.right - update.action.right) <= 1)
    for (const card of geometry.cards) assert.ok(Math.abs(card.icon.center - card.action.center) <= 1)
    assert.deepEqual(geometry.overflow, [])
    assert.ok(geometry.documentWidth <= geometry.pageWidth)
    results.push({ width, fontSize, appearance, geometry })
    await page.screenshot({ path: join(evidence, `${width}-${fontSize}-${appearance}.png`), animations: 'disabled' })
  }
  await page.getByRole('button', { name: '打开全文翻译设置', exact: true }).click()
  await page.getByRole('dialog').waitFor()
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ results, errors }, null, 2))
  console.log('SETTINGS ALIGNMENT PASSED: shared insets, vertical centers, large text, dark mode, translation dialog')
} finally { await app.close() }
