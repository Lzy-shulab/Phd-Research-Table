import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const evidence = resolve('test-results/refinement-0.8.8/submission-before')
const profile = join(evidence, 'isolated-data')
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('release/win-unpacked/PhD 科研工作台.exe'), args: [], env })
const page = await app.firstWindow(), errors = []
page.on('console', message => { if (message.type() === 'error') errors.push(message.text()) })
page.on('pageerror', error => errors.push(error.message))
try {
  await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1440, 940); win.webContents.setBackgroundThrottling(false); win.showInactive() })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const created = await page.evaluate(() => window.workbench.createSubmission({ title: 'Submission rendering fixture', journal: 'Fixture Journal', manuscriptId: 'TEST-001', stages: [{ name: 'With editor', occurredOn: '2026-09-10' }], revisionDueDate: null, reminderEnabled: false, reminderDays: 3, notes: '' }))
  assert.equal(created.ok, true)
  await page.reload()
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '论文投稿', exact: true }).click()
  await page.getByRole('button', { name: '更新投稿 Submission rendering fixture', exact: true }).click()
  await page.getByRole('heading', { name: '工作区暂时无法显示。', exact: true }).waitFor()
  await page.screenshot({ path: join(evidence, 'crash.png') })
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ reproduced: true, errors }, null, 2))
  console.log('REPRODUCED', errors.filter(error => /snapshot|depth|render/i.test(error)).join('\n'))
} finally {
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()))
  await app.close()
}
