import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { ensureTestProject, waitForAsync } from './test-helpers.mjs'

const dir = resolve('test-results', `failures-${Date.now()}`)
mkdirSync(dir, { recursive: true })
const env = { ...process.env, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DATA_DIR: dir }
delete env.ELECTRON_RUN_AS_NODE
let app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await page.getByRole('heading', { name: 'Today Plan', exact: true }).waitFor()
  await ensureTestProject(page)
  await page
    .getByRole('textbox', { name: '添加一个研究任务', exact: true })
    .fill('Save recovery test')
  await page.getByRole('textbox', { name: '添加一个研究任务', exact: true }).press('Enter')
  await page.locator('.task-content').filter({ hasText: 'Save recovery test' }).click()
  await page.getByLabel('开始时间', { exact: true }).fill('10:00')
  await waitForAsync(page, async () => {
    const r = await window.workbench.bootstrap()
    return r.ok && r.data.tasks[0]?.endTime === '11:00'
  })
  await page.getByLabel('结束时间', { exact: true }).fill('09:00')
  await page.getByRole('button', { name: '撤销未保存的修改', exact: true }).waitFor()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await page.getByText('任务尚未保存 · 查看修改', { exact: true }).waitFor()
  const r = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(r.data.tasks[0].endTime, '11:00')
  assert.equal(page.isClosed(), false)
  await page.getByRole('button', { name: '撤销未保存的修改', exact: true }).click()
  assert.equal(await page.getByLabel('结束时间', { exact: true }).inputValue(), '11:00')
  await app.close()
  app = null
  console.log(
    'PASS Invalid edit stays unsaved, SQLite is unchanged, native close is canceled, revert recovers'
  )
} finally {
  if (app) await app.close()
}

const corruptDir = resolve(dir, 'corrupt')
mkdirSync(corruptDir)
const path = resolve(corruptDir, 'workbench.sqlite')
const original = Buffer.from('Deliberately invalid SQLite test data. Do not reset or overwrite.')
writeFileSync(path, original)
app = await electron.launch({ args: ['.'], env: { ...env, WORKBENCH_DATA_DIR: corruptDir } })
try {
  const page = await app.firstWindow()
  await page
    .getByRole('heading', { name: '无法打开本地工作区', exact: true })
    .waitFor()
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await page
    .getByRole('heading', { name: '无法打开本地工作区', exact: true })
    .waitFor()
  assert.deepEqual(readFileSync(path), original)
  await page.screenshot({ path: resolve(dir, 'database-error.png'), animations: 'disabled' })
  console.log('PASS Database initialization error shows retry and never replaces the existing file')
} finally {
  await app.close()
}
