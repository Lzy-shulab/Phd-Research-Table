import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const exe = option('executable'), baseline = process.argv.includes('--baseline')
const out = resolve(option('output') || 'test-results/desktop-lifecycle')
mkdirSync(out, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(out, `profile-${Date.now()}`), WORKBENCH_DISABLE_LEGACY_TRANSLATION_ENGINE: '1', WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(exe || 'node_modules/electron/dist/electron.exe'), args: exe ? [] : ['.'], env })
app.context().setDefaultTimeout(15000)
const errors = [], timings = {}
app.on('window', page => page.on('pageerror', error => errors.push(error.message)))
const unwrap = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.data }
const pageWith = async needle => {
  for (let i = 0; i < 150; i++) { const p = app.windows().find(p => p.url().includes(needle)); if (p) return p; await new Promise(r => setTimeout(r, 100)) }
  throw Error('Missing window ' + needle)
}
try {
  const rail = await pageWith('rail.html')
  await rail.getByRole('button', { name: '论文阅读', exact: true }).waitFor()
  const topmost = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isAlwaysOnTop())
  if (!baseline) assert.equal(topmost, false)
  console.log('RAIL_TOPMOST', topmost)
  let started = performance.now()
  await rail.getByRole('button', { name: '论文阅读', exact: true }).click()
  const panel = await pageWith('panel=reading')
  await panel.getByRole('button', { name: '选择 PDF 文件' }).waitFor()
  timings.readingPanelMs = Math.round(performance.now() - started)
  const first = resolve('tests/fixtures/translation-check.pdf'), second = join(out, 'second-paper.pdf')
  writeFileSync(second, Buffer.concat([readFileSync(first), Buffer.from('\n% second fixture\n')]))
  unwrap(await panel.evaluate(paths => window.workbench.importDesktopPapers(paths, null), [first, second]))
  await panel.getByRole('button', { name: 'translation-check', exact: true }).waitFor()
  for (const title of ['translation-check', 'second-paper', 'translation-check']) {
    started = performance.now()
    await panel.getByRole('button', { name: title, exact: true }).click()
    const main = await pageWith('index.html')
    await main.waitForFunction(() => document.querySelector('.textLayer')?.textContent?.includes('Research'))
    if (!baseline) assert.equal(await main.locator('.paper-card').count(), 0)
    timings[title + '-' + Object.keys(timings).length] = Math.round(performance.now() - started)
    if (!baseline) assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('widget.html')).isVisible()), false)
    await main.getByRole('button', { name: '关闭对话框', exact: true }).click()
    await main.getByRole('dialog').waitFor({ state: 'hidden' })
    if (!baseline) {
      for (let i = 0; i < 30; i++) {
        if (await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('panel=reading')).isVisible())) break
        await new Promise(r => setTimeout(r, 50))
      }
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('panel=reading')).isVisible()), true)
    }
    const reopenStarted = performance.now()
    await panel.getByRole('button', { name: title === 'second-paper' ? 'translation-check' : 'second-paper', exact: true }).click()
    await main.waitForFunction(() => document.querySelector('.textLayer')?.textContent?.includes('Research'))
    timings['readerReturn-' + Object.keys(timings).length] = Math.round(performance.now() - reopenStarted)
    console.log('PASS close reader and open another paper')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('index.html')).close())
    await main.waitForEvent('close')
    console.log('PASS open and close', title)
  }
  if (!baseline) {
    const originalId = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('widget.html')).id)
    for (const [kind, name] of [['tasks', '任务总览'], ['submissions', '论文投稿'], ['checkin', '打卡记录'], ['reading', '论文阅读'], ['tasks', '任务总览']]) {
      started = performance.now()
      await rail.getByRole('button', { name, exact: true }).click()
      await panel.waitForFunction(name => document.querySelector('.desktop-header strong')?.textContent === name, name)
      timings['switch-' + kind + '-' + Object.keys(timings).length] = Math.round(performance.now() - started)
      assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('widget.html')).id), originalId)
    }
    await rail.screenshot({ path: join(out, 'rail.png') })
    await rail.getByRole('button', { name: '打卡记录', exact: true }).click()
    await panel.getByRole('button', { name: '填写打卡起止时间' }).click()
    await panel.getByLabel('开始时间', { exact: true }).fill('18:30')
    assert.equal(await panel.getByLabel('结束时间', { exact: true }).inputValue(), '06:30')
    assert.equal(await panel.getByLabel('结束于次日').isChecked(), true)
    assert.equal(await panel.getByLabel('到点提醒下班').isChecked(), true)
    await panel.screenshot({ path: join(out, 'checkin-auto-end.png') })
    await panel.getByLabel('结束时间', { exact: true }).fill('07:00')
    await panel.getByLabel('开始时间', { exact: true }).fill('19:00')
    assert.equal(await panel.getByLabel('结束时间', { exact: true }).inputValue(), '07:00')
    await panel.getByRole('button', { name: '保存打卡', exact: true }).click()
    await panel.getByRole('status').filter({ hasText: '已保存' }).waitFor()
    const saved = unwrap(await panel.evaluate(() => window.workbench.researchReport())).checkins[0]
    assert.equal(saved.reminderEnabled, true)
    console.log('PASS automatic twelve-hour end, overnight date and saved reminder')
    await panel.getByRole('button', { name: '关闭面板', exact: true }).click()
    await rail.getByRole('button', { name: '打开 PhD 工作台', exact: true }).click()
    const workbench = await pageWith('index.html')
    await workbench.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    await rail.waitForFunction(() => document.querySelector('#workbench').getAttribute('aria-busy') === 'false')
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && !w.webContents.isDestroyed() && w.webContents.getURL().includes('widget.html')).isVisible()), false)
    console.log('PASS launcher feedback and workbench arrival')
  }
  assert.deepEqual(errors, [])
  console.log('TIMINGS', JSON.stringify(timings))
} catch (error) {
  console.error(error)
  throw error
} finally {
  writeFileSync(join(out, 'report.json'), JSON.stringify({ timings, errors }, null, 2))
  await app.close()
}
