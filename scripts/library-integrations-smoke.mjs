import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable'), output = resolve(option('output') || 'test-results/library-integrations/ui')
const profile = join(output, 'profile')
mkdirSync(profile, { recursive: true })
const source = join(profile, 'source.pdf')
copyFileSync(resolve('tests/fixtures/translation-check.pdf'), source)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_WIDGET_AUTO: '1', WORKBENCH_DISABLE_GPU_AUTO: '1',
  WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? ['--workbench'] : ['.', '--workbench'], env })
const errors = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.setContentSize(1600, 1000); window.hide(); window.webContents.setBackgroundThrottling(false) })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const bootstrap = await page.evaluate(() => window.workbench.bootstrap())
  assert.ok(bootstrap.ok)
  assert.ok(bootstrap.data.databasePath.startsWith(profile))
  const db = new DatabaseSync(bootstrap.data.databasePath)
  try {
    const row = Object.fromEntries(db.prepare('PRAGMA table_info(papers)').all().filter(column => column.notnull && column.dflt_value === null).map(column => [column.name, 'isolated-fixture']))
    Object.assign(row, { id: 'journal-fixture', title: 'Scientific translation and journal metadata', authors: 'Isolated test author',
      journal: 'IEEE Transactions on Geoscience and Remote Sensing', year: '2026', original_name: 'source.pdf', source_path: source,
      metadata_status: 'ready', added_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    db.prepare(`INSERT INTO papers (${Object.keys(row).map(key => `"${key}"`).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
  } finally { db.close() }
  await app.evaluate(({ session }) => {
    const site = session.fromPartition('workbench-translation-engine-network', { cache: false }), original = site.fetch.bind(site)
    globalThis.rankQueries = 0
    site.fetch = async (url, init) => {
      if (!String(url).startsWith('https://www.easyscholar.cc/open/getPublicationRank')) return original(url, init)
      globalThis.rankQueries++
      return Response.json({ code: 200, data: { officialRank: { all: { sciUp: '1区', sci: 'Q1', sciif: '8.4', ccf: 'A' } } } })
    }
  })
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  await page.getByRole('button', { name: '文献翻译设置', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '文献翻译设置', exact: true })
  await dialog.locator('.translation-profile-option').filter({ hasText: '本地 Codex CLI' }).click()
  assert.equal(await dialog.getByLabel('API 密钥', { exact: true }).count(), 0)
  await dialog.getByLabel('模型名称', { exact: true }).fill('gpt-6-luna')
  await dialog.getByLabel('Codex 推理程度').selectOption('low')
  await dialog.getByRole('button', { name: '保存配置', exact: true }).click()
  await dialog.getByRole('button', { name: '使用此配置', exact: true }).click()
  await waitForAsync(page, async () => { const result = await window.workbench.translationProfiles(); return result.ok && result.data.activeId === 'codex-cli' })
  await dialog.evaluate(element => { element.scrollTop = 0 })
  await dialog.screenshot({ path: join(output, 'codex-settings.png') })
  const selected = await page.evaluate(() => window.workbench.translationProfiles())
  assert.ok(selected.ok)
  assert.equal(selected.data.profiles.find(profile => profile.id === 'codex-cli').reasoningEffort, 'low')
  await dialog.getByLabel('easyScholar Secret Key').fill('isolated-fixture-key')
  await dialog.getByRole('button', { name: '保存密钥', exact: true }).click()
  await waitForAsync(page, async () => { const result = await window.workbench.librarySnapshot(); return result.ok && Object.keys(result.data.journalRanks?.entries || {}).length === 1 })
  assert.equal(await dialog.getByLabel('easyScholar Secret Key').inputValue(), '')
  await dialog.getByRole('button', { name: '完成', exact: true }).click()
  await page.getByRole('button', { name: '列表', exact: true }).click()
  await page.locator('.paper-list-journal .journal-ranks').waitFor()
  assert.ok((await page.locator('.paper-list-journal .journal-ranks').innerText()).includes('JCR Q1'))
  await page.screenshot({ path: join(output, 'journal-list.png') })
  await page.getByRole('button', { name: '卡片', exact: true }).click()
  await page.locator('.paper-card-body > .journal-ranks').waitFor()
  await page.screenshot({ path: join(output, 'journal-card.png') })
  for (const width of [1600, 1100]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 900), width)
    await page.getByRole('button', { name: '文献翻译设置', exact: true }).click()
    const layout = await dialog.evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, right: element.getBoundingClientRect().right, viewport: innerWidth }))
    assert.ok(layout.scrollWidth <= layout.width + 1 && layout.right <= layout.viewport)
    await dialog.getByRole('button', { name: '完成', exact: true }).click()
  }
  assert.equal(await app.evaluate(() => globalThis.rankQueries), 1)
  assert.deepEqual(errors, [])
  const report = { codexProfileSaved: true, modelAndEffortSelectable: true, noModelApiKeyRequired: true,
    journalListAndCards: true, journalRequests: 1, layouts: [1600, 1100], errors }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await app.close() }
