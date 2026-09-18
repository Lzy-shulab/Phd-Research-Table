import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/current/translation-engine-onboarding', executablePath ? 'packaged' : 'development')
const profile = resolve(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: profile,
  WORKBENCH_DISABLE_LEGACY_TRANSLATION_ENGINE: '1',
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch(executablePath ? { executablePath, args: [], env } : { args: ['.'], env })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 980 }))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()

  const imported = await page.evaluate((path) => window.workbench.importPapers([path], null, false), resolve('tests/fixtures/translation-check.pdf'))
  assert.equal(imported.ok, true)
  await page.getByTestId('paper-card').waitFor()
  await page.getByRole('button', { name: '文献翻译设置', exact: true }).click()
  await page.getByRole('heading', { name: '文献翻译设置', exact: true }).waitFor()
  await page.getByText('尚未安装 PDF2zh 引擎。可一键安装官方环境，或选择已有环境。', { exact: true }).waitFor()
  await page.getByRole('button', { name: '一键安装官方引擎', exact: true }).waitFor()
  await page.getByRole('button', { name: '选择已有环境', exact: true }).waitFor()
  await page.getByText('尚未选择', { exact: true }).waitFor()

  const initialHealth = await page.evaluate(() => window.workbench.translationHealth())
  assert.equal(initialHealth.ok, true)
  assert.equal(initialHealth.data.installed, false)
  assert.equal(initialHealth.data.serverDirectory, '')
  await page.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByTestId('paper-card').getByRole('button', { name: '翻译', exact: true }).click()
  await page.getByRole('heading', { name: '文献翻译设置', exact: true }).waitFor()
  const afterClick = await page.evaluate(() => window.workbench.librarySnapshot())
  assert.equal(afterClick.ok, true)
  assert.equal(afterClick.data.papers[0].translationStatus, 'idle')
  assert.equal(afterClick.data.papers[0].translationError, '')

  await page.screenshot({ path: resolve(evidence, 'missing-engine-onboarding.png'), animations: 'disabled', scale: 'css' })
  assert.deepEqual(errors, [])
  const report = { initialHealth: initialHealth.data, paperStateAfterTranslateClick: afterClick.data.papers[0].translationStatus,
    automaticInstallVisible: true, existingEnvironmentFallbackVisible: true, rendererErrors: errors, executablePath: executablePath ?? 'development' }
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log('PASS Missing-engine onboarding, safe preflight, one-click install entry and existing-environment fallback')
} finally { await app.close() }
