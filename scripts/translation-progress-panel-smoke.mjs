import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable'), output = resolve(option('output') || 'test-results/translation-progress-panel')
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
  const bootstrap = await page.evaluate(async () => { await window.workbench.librarySnapshot(); return window.workbench.bootstrap() })
  assert.ok(bootstrap.ok && bootstrap.data.databasePath.startsWith(profile))
  const db = new DatabaseSync(bootstrap.data.databasePath)
  try {
    for (let index = 0; index < 3; index++) {
      const row = Object.fromEntries(db.prepare('PRAGMA table_info(papers)').all().filter(column => column.notnull && column.dflt_value === null).map(column => [column.name, `progress-fixture-${index}`]))
      Object.assign(row, { id: `progress-${index}`, title: index === 0 ? 'AXS-Net: Interpretable Deep Unfolding for Hyperspectral Image Denoising' : `Waiting research paper ${index}`,
        authors: 'Isolated test author', journal: 'arXiv', year: '2026', original_name: 'source.pdf', source_path: source,
        metadata_status: 'ready', translation_status: index === 0 ? 'translating' : 'queued', translation_order: index,
        added_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      db.prepare(`INSERT INTO papers (${Object.keys(row).map(key => `"${key}"`).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row))
    }
  } finally { db.close() }
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('library:changed'))
  await page.getByRole('button', { name: '深色模式', exact: true }).click()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  const queue = page.getByTestId('translation-queue')
  await queue.waitFor()
  const startedAt = new Date(Date.now() - 138000).toISOString()
  const progress = async (step, stage, percent, current, total) => {
    await app.evaluate(({ BrowserWindow }, value) => BrowserWindow.getAllWindows()[0].webContents.send('library:translation-progress', value),
      { paperId: 'progress-0', step, stage, percent, current, total, startedAt, rateWindow: { startedAt: Date.now() - 30000, completedAtStart: 0, unit: stage === '正在翻译正文' ? '段' : '项' }, updatedAt: new Date().toISOString() })
    await page.getByRole('status').filter({ hasText: stage }).waitFor()
  }
  await progress('translate', '正在翻译正文', 49, 109, 454)
  assert.match(await queue.locator('[aria-label=当前翻译速度]').innerText(), /\d+.*段\/分/)
  assert.match(await queue.locator('[aria-label=预计剩余时间]').innerText(), /正文剩余约/)
  assert.equal(await queue.getByRole('button', { name: '展开翻译详情' }).getAttribute('aria-expanded'), 'false')
  assert.equal(await queue.getByRole('list', { name: '翻译阶段' }).count(), 0)
  await queue.getByRole('button', { name: '展开翻译详情' }).click()
  await queue.getByRole('list', { name: '翻译阶段' }).waitFor()
  assert.equal(await queue.locator('.translation-step-list > li[data-state=done]').count(), 2)
  assert.ok((await queue.locator('[aria-current=step]').innerText()).includes('翻译正文'))
  assert.ok((await queue.innerText()).includes('109 / 454'))
  assert.equal(await queue.locator('.translation-expandable > .translation-queue-list > div').count(), 2)
  await page.screenshot({ path: join(output, 'expanded-dark.png') })
  await progress('typeset', '正在排版译文', 87, 5, 10)
  assert.ok((await queue.locator('[aria-current=step]').innerText()).includes('排版与字体'))
  await queue.getByRole('button', { name: '收起翻译详情' }).click()
  await progress('write', '正在生成中英对照 PDF', 96, 1, 1)
  assert.equal(await queue.getByRole('button', { name: '展开翻译详情' }).getAttribute('aria-expanded'), 'false')
  await page.screenshot({ path: join(output, 'collapsed-dark.png') })
  await queue.getByRole('button', { name: '展开翻译详情' }).click()
  for (const width of [1600, 1100]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setContentSize(width, 950), width)
    if (width === 1100) await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 }))
    const layout = await queue.evaluate(element => ({ scrollWidth: element.scrollWidth, width: element.clientWidth, right: element.getBoundingClientRect().right, viewport: innerWidth }))
    assert.ok(layout.scrollWidth <= layout.width + 1 && layout.right <= layout.viewport)
  }
  await page.screenshot({ path: join(output, 'expanded-narrow.png') })
  await page.reload()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  await page.getByTestId('translation-queue').waitFor()
  assert.equal(await page.getByRole('button', { name: '收起翻译详情' }).getAttribute('aria-expanded'), 'true')
  assert.deepEqual(errors, [])
  const report = { speedAndRemaining: true, collapsedByDefault: true, expandAndCollapse: true, fiveRealPhases: true, stageUpdatesWithoutReopening: true,
    queuedPapersVisibleWhenExpanded: true, expansionRemembered: true, layouts: [1600, 1100], errors }
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await app.close() }
