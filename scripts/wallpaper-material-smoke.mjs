import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve(`test-results/ui-redesign-${version}/wallpapers`, executablePath ? 'packaged' : 'development')
const profile = join(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(executablePath ? { executablePath: resolve(executablePath), args: [] } : { args: ['.'] }), env })
const matrix = [], errors = []
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
function contrast(first, second) {
  const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(value => color.startsWith('color(srgb ') ? value : value / 255)
    .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
  const a = luminance(first), b = luminance(second)
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05)
}
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 900); win.webContents.setBackgroundThrottling(false); win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const project = unwrap(await page.evaluate(() => window.workbench.createProject({ name: '研究任务', description: '隔离背景配色检查', colorKey: 'sage' })))
  const date = new Date(); date.setDate(date.getDate() - 1)
  const past = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  unwrap(await page.evaluate(input => window.workbench.createTask(input), { title: '核对实验图表', projectId: project.id, scheduledDate: past }))
  for (const background of ['default', 'mist', 'sage', 'dusk', 'midnight', 'klein', 'orange', 'yellow', 'red', 'pink']) {
    for (const appearance of ['light', 'dark']) {
      unwrap(await page.evaluate(background => window.workbench.updateInterfacePreferences({ background, fontSize: 14, panelOpacity: 95 }), background))
      unwrap(await page.evaluate(appearance => window.workbench.setAppearance(appearance), appearance))
      await page.reload()
      await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
      await page.waitForFunction(({ background, appearance }) => document.documentElement.dataset.background === background && document.documentElement.dataset.theme === appearance, { background, appearance })
      await page.locator('.overdue-actions .action-warm').waitFor()
      await page.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector('.overdue-panel')).opacity) > .999)
      const measure = await page.evaluate(() => {
        const root = getComputedStyle(document.documentElement)
        return { companion: root.getPropertyValue('--action-companion').trim(), accent: root.getPropertyValue('--accent').trim(),
          warm: root.getPropertyValue('--action-warm').trim(), shell: getComputedStyle(document.querySelector('.sidebar')).backgroundColor,
          dockBackground: getComputedStyle(document.querySelector('.dock')).backgroundImage,
          overflow: document.documentElement.scrollWidth > innerWidth,
          buttons: [...document.querySelectorAll('.overdue-actions button')].map(button => ({ label: button.textContent, color: getComputedStyle(button).color, background: getComputedStyle(button).backgroundColor })) }
      })
      assert.equal(measure.overflow, false)
      assert.notEqual(measure.companion, measure.accent)
      assert.notEqual(measure.warm, measure.accent)
      assert.ok(measure.dockBackground.includes('gradient'))
      for (const button of measure.buttons) assert.ok(contrast(button.color, button.background) >= 4.5, `${background}/${appearance}/${button.label}: contrast`)
      matrix.push({ background, appearance, ...measure })
      if ([['orange', 'light'], ['klein', 'dark'], ['red', 'light']].some(([b, a]) => b === background && a === appearance))
        await page.screenshot({ path: join(evidence, `${background}-${appearance}.png`), animations: 'disabled', scale: 'css' })
    }
  }
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ background: 'sage', panelOpacity: 20 })))
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const transparent = await page.locator('.sidebar').evaluate(element => getComputedStyle(element).backgroundColor)
  assert.ok(Number(transparent.match(/[\d.]+/g).at(-1)) < .3, 'Panel opacity affects the glass shell')
  await page.emulateMedia({ contrast: 'more' })
  const accessible = await page.locator('.sidebar').evaluate(element => ({ color: getComputedStyle(element).backgroundColor, filter: getComputedStyle(element).backdropFilter }))
  assert.equal(accessible.filter, 'none')
  assert.ok(!accessible.color.startsWith('rgba'), 'Increased contrast uses an opaque shell')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ matrix, transparent, accessible, errors }, null, 2))
  console.log(JSON.stringify({ combinations: matrix.length, semanticActionContrast: 'passed', panelOpacity: 'passed', increasedContrast: 'passed', errors, evidence }, null, 2))
} finally { await app.close() }
