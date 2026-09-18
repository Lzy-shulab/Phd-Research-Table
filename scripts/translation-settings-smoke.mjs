import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/current/translation-api-profiles', executablePath ? 'packaged' : 'development')
const profile = resolve(evidence, `profile-${Date.now()}`)
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
const app = await electron.launch(executablePath ? { executablePath, args: [], env } : { args: ['.'], env })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (error) => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ width: 1440, height: 980 }))
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  await page.getByRole('button', { name: '文献翻译设置', exact: true }).click()
  await page.getByRole('heading', { name: '文献翻译设置', exact: true }).waitFor()

  const initial = await page.evaluate(() => window.workbench.translationProfiles())
  assert.equal(initial.ok, true)
  assert.equal(initial.data.activeId, 'pdf2zh-free')
  assert.equal(initial.data.profiles.length, 4)
  assert.equal(initial.data.profiles.find((item) => item.id === 'pdf2zh-free').ready, true)

  await page.getByRole('button', { name: /OpenRouter 免费模型路由/ }).click()
  await page.getByLabel('API 密钥').fill('smoke-placeholder-key')
  await page.getByRole('button', { name: '保存配置', exact: true }).click()
  await page.getByText('已保存密钥；页面和接口均不会返回明文。').waitFor()
  await page.getByRole('button', { name: '使用此配置', exact: true }).click()
  await page.getByText('本地配置已就绪：OpenRouter 免费模型路由', { exact: true }).waitFor()

  const configured = await page.evaluate(() => window.workbench.translationProfiles())
  assert.equal(configured.ok, true)
  assert.equal(configured.data.activeId, 'openrouter-free')
  assert.equal(configured.data.profiles.find((item) => item.id === 'openrouter-free').hasApiKey, true)
  assert.equal(JSON.stringify(configured).includes('smoke-placeholder-key'), false)

  await page.getByRole('button', { name: /PDF2zh 公益免费服务/ }).click()
  await page.getByRole('button', { name: '使用此配置', exact: true }).click()
  await page.getByText('本地配置已就绪：PDF2zh 公益免费服务', { exact: true }).waitFor()
  await page.screenshot({ path: resolve(evidence, 'settings.png'), animations: 'disabled', scale: 'css' })

  assert.deepEqual(errors, [])
  const report = {
    presets: initial.data.profiles.map(({ id, name, provider, ready }) => ({ id, name, provider, ready })),
    encryptedKeyProfileReady: configured.data.profiles.find((item) => item.id === 'openrouter-free').ready,
    plaintextReturned: false,
    restoredActiveId: (await page.evaluate(() => window.workbench.translationProfiles())).data.activeId,
    rendererErrors: errors,
    executablePath: executablePath ?? 'development'
  }
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log('PASS Translation presets, encrypted key save, profile activation, free fallback, and renderer UI')
} finally { await app.close() }
