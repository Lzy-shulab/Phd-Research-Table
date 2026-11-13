import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const executable = option('executable')
const output = resolve(option('output') || `test-results/ui-copy-tour-${Date.now()}`)
const profile = resolve(option('profile') || join(output, 'profile'))
mkdirSync(output, { recursive: true })
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_WIDGET_AUTO: '1',
  WORKBENCH_DISABLE_GPU_AUTO: '1', WORKBENCH_DISABLE_CODEX_AUTO: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(executable || 'node_modules/electron/dist/electron.exe'), args: executable ? ['--workbench'] : ['.', '--workbench'], env })
const page = await app.firstWindow(), errors = [], visited = []
page.on('pageerror', error => errors.push(error.message))
page.setDefaultTimeout(10000)
const button = (name, root = page) => root.getByRole('button', { name, exact: true })
const nav = async name => { await button(name, page.getByRole('navigation', { name: '科研工作空间' })).click(); await page.getByRole('heading', { name: name === '文献阅读' ? '文献库' : name, exact: true }).waitFor() }
const shot = async name => {
  await page.waitForTimeout(350)
  const png = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true }).then(image => image.toPNG().toString('base64')))
  writeFileSync(join(output, `${String(visited.length + 1).padStart(2, '0')}-${name}.png`), Buffer.from(png, 'base64'))
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), name)
  visited.push(name); console.log('CHECKED', name)
}
const close = async () => { const id = await page.getByRole('dialog').last().getAttribute('id'); await page.keyboard.press('Escape'); await page.locator(`[id="${id}"]`).waitFor({ state: 'hidden' }) }
try {
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.hide(); window.setContentSize(1600, 1000); window.webContents.setBackgroundThrottling(false) })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  if (option('profile')) {
    await shot('today')
    await page.locator('.task-content').first().click(); await shot('task-detail')
    for (const name of ['选择安排到', '选择开始时间']) { await button(name).click(); await page.getByRole('dialog').waitFor(); await shot(name); await close() }
    await button('关闭任务详情').click()
    const planner = page.getByRole('navigation', { name: '研究计划视图' })
    await planner.getByRole('button', { name: /^全部任务/ }).click(); await page.getByRole('heading', { name: '全部任务', exact: true }).waitFor(); await shot('all-tasks')
    await planner.getByRole('button', { name: '日历', exact: true }).click(); await page.getByRole('heading', { name: '日历', exact: true }).waitFor()
    for (const name of ['周视图', '日视图']) { await button(name).click(); await shot(name) }
    await nav('文献阅读'); await button('卡片', page.getByRole('group', { name: '文献显示方式' })).click(); await shot('library-cards')
    await button('中英摘要').click(); await page.getByText('高光谱图像重建', { exact: true }).waitFor(); await shot('bilingual-summary'); await close()
    await button('原文').click(); await page.getByTestId('pdf-page').first().waitFor(); await shot('pdf-reader'); await close()
    await button('列表', page.getByRole('group', { name: '文献显示方式' })).click(); await shot('library-list')
    await nav('科研成果'); await button('抽出论文 Spectral Image Reconstruction').click(); await page.getByTestId('publication-detail').waitFor(); await shot('publication-detail')
    await button('编辑发表信息').click(); await page.getByRole('dialog').waitFor(); await shot('publication-editor'); await close()
    await nav('论文投稿'); await shot('submissions')
    await button('更新投稿 Hyperspectral Reconstruction').click(); await page.getByRole('dialog').waitFor(); await shot('submission-editor'); await close()
    await button('新增投稿').first().click(); await page.getByRole('dialog').waitFor(); await shot('submission-create'); await close()
  }
  await nav('研究报表'); await shot('reports')
  await button('目标与项目').click(); await page.getByText('统计规则', { exact: true }).click(); await shot('report-goals-and-rules'); await button('取消').click(); await page.getByText('统计规则', { exact: true }).waitFor({ state: 'hidden' })
  for (const [action, name] of [['登记打卡', 'checkin'], ['登记出差', 'trip'], ['登记休假', 'leave']]) {
    await button(action).click(); await page.locator('.report-entry-form').waitFor(); await shot(`report-${name}`); await button('取消', page.locator('.report-entry-form')).click(); await page.locator('.report-entry-form').waitFor({ state: 'hidden' })
  }
  await page.locator('#report-finance').scrollIntoViewIfNeeded(); await shot('report-finance')
  await page.locator('#report-finance').getByRole('button', { name: /登记|添加/ }).click(); await page.locator('.report-entry-form').waitFor(); await shot('report-stipend'); await button('取消').click()
  await nav('设置'); await shot('settings-appearance')
  for (const id of ['assistant-settings', 'storage-settings', 'desktop-widget-settings']) {
    const section = page.locator(`#${id}`); if (await section.count()) { await section.scrollIntoViewIfNeeded(); await shot(id) }
  }
  await page.locator('.storage-metadata').scrollIntoViewIfNeeded(); await shot('settings-storage-and-metadata')
  await page.getByRole('heading', { name: '软件更新', exact: true }).scrollIntoViewIfNeeded(); await shot('settings-update')
  await button('打开全文翻译设置').click(); await page.getByRole('dialog', { name: '文献翻译设置' }).waitFor(); await shot('translation-settings')
  await page.getByRole('button', { name: /^本地 Codex CLI/ }).click(); await shot('translation-codex')
  await button('新增自定义 API 配置').click(); await shot('translation-custom'); await close()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 950))
  await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 }))
  await button('深色模式').click()
  for (const name of ['设置', '研究报表', '论文投稿', '科研成果']) { await nav(name); await shot(`${name}-dark-large`) }
  await button('添加成果').first().click(); await page.getByRole('dialog').waitFor(); await shot('publication-form-dark-large'); await close()
  await nav('文献阅读'); await page.getByRole('heading', { name: '文献库', exact: true }).waitFor(); await shot('library-dark-large')
  assert.deepEqual(errors, [])
  writeFileSync(join(output, 'report.json'), JSON.stringify({ visited, errors, viewportWidths: [1600, 1100] }, null, 2))
} finally { await app.close() }
