import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const packagedExecutable = option('executable') || process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve(option('evidence') || process.env.WORKBENCH_TEST_EVIDENCE || 'test-results/desktop-widget/runtime')
const profile = join(evidence, `isolated-data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const executablePath = resolve(packagedExecutable || 'node_modules/electron/dist/electron.exe')
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const checks = [], errors = []
let app, main, widget
const unwrap = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.data }
const pass = name => { checks.push(name); console.log('PASS', name) }
const shot = name => widget.screenshot({ path: join(evidence, `${name}.png`), scale: 'css' })
async function launch(widgetOnly = false) {
  app = await electron.launch({ executablePath, args: [...(packagedExecutable ? [] : ['.']), ...(widgetOnly ? ['--desktop-widget'] : [])], env })
  for (let attempt = 0; attempt < 100 && !app.windows().some(page => page.url().endsWith('widget.html')); attempt++) await new Promise(resolve => setTimeout(resolve, 100))
  widget = app.windows().find(page => page.url().endsWith('widget.html'))
  assert.ok(widget, 'Desktop widget window opened')
  widget.on('pageerror', error => errors.push(error.message))
  await widget.getByRole('button', { name: '填写打卡起止时间', exact: true }).waitFor()
  await widget.waitForFunction(() => !document.querySelector('.widget-today').disabled)
  main = app.windows().find(page => page !== widget)
  if (main) {
    main.on('pageerror', error => errors.push(error.message))
    await main.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  }
}
async function addSegment(start, end) {
  await widget.getByLabel('开始时间', { exact: true }).fill(start)
  await widget.getByLabel('结束时间', { exact: true }).fill(end)
  await widget.getByRole('button', { name: '保存打卡', exact: true }).click()
  await widget.getByRole('status').filter({ hasText: '已保存' }).waitFor()
}
try {
  await launch()
  const boot = unwrap(await main.evaluate(() => window.workbench.bootstrap()))
  assert.ok(boot.databasePath.startsWith(profile))
  const initial = unwrap(await widget.evaluate(() => window.workbench.widgetSnapshot()))
  assert.equal(initial.startupManaged, false)
  unwrap(await widget.evaluate(() => window.workbench.updateWidgetPreferences({ scale: 1 })))
  const db = new DatabaseSync(boot.databasePath)
  db.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
    .run('desktop.widget.weather', JSON.stringify({ cityId: 1808926, temperature: 23, code: 2, isDay: true, fetchedAt: Date.now() }))
  db.close()
  unwrap(await widget.evaluate(() => window.workbench.updateWidgetPreferences({ city: { id: 1808926, name: '杭州', region: '浙江', country: '中国', latitude: 30.274, longitude: 120.155 } })))
  await widget.waitForFunction(() => document.querySelector('.widget-weather')?.textContent.includes('23°C'))
  pass('isolated local data, cached weather, startup registration disabled during tests')
  await main.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '研究报表', exact: true }).click()
  await main.getByRole('heading', { name: '研究打卡', exact: true }).waitFor()
  await widget.getByRole('button', { name: '填写打卡起止时间', exact: true }).click()
  await addSegment('09:00', '12:00')
  await addSegment('13:00', '16:30')
  await shot('checkin-editor')
  await widget.getByRole('button', { name: '关闭面板', exact: true }).click()
  await main.waitForFunction(() => document.querySelector('#report-checkins .report-checkin-totals')?.textContent.includes('6 小时 30 分钟'))
  pass('two manually entered segments update the main report immediately')
  const editBefore = unwrap(await widget.evaluate(() => window.workbench.researchReport()))
  const edited = editBefore.checkins.find(entry => entry.startTime === '09:00')
  const prior = new Date(`${edited.date}T12:00:00`); prior.setDate(prior.getDate() - 1)
  const priorDate = `${prior.getFullYear()}-${String(prior.getMonth() + 1).padStart(2, '0')}-${String(prior.getDate()).padStart(2, '0')}`
  await widget.getByRole('button', { name: '填写打卡起止时间', exact: true }).click()
  await widget.getByRole('button', { name: `编辑打卡 ${edited.id}`, exact: true }).click()
  await widget.getByLabel('打卡日期', { exact: true }).fill(priorDate)
  await widget.getByRole('button', { name: '保存修改', exact: true }).click()
  await widget.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  let editAfter = unwrap(await widget.evaluate(() => window.workbench.researchReport()))
  assert.equal(editAfter.checkins.length, 2)
  assert.equal(editAfter.checkins.find(entry => entry.id === edited.id).date, priorDate)
  await widget.getByRole('button', { name: `编辑打卡 ${edited.id}`, exact: true }).click()
  await widget.getByLabel('打卡日期', { exact: true }).fill(edited.date)
  await widget.getByRole('button', { name: '保存修改', exact: true }).click()
  await widget.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  editAfter = unwrap(await widget.evaluate(() => window.workbench.researchReport()))
  assert.deepEqual(editAfter.checkins.map(entry => entry.id), editBefore.checkins.map(entry => entry.id))
  const overnight = unwrap(await widget.evaluate(date => window.workbench.saveCheckin({ date, startTime: '23:00', endTime: '01:00', endsNextDay: true, notes: '' }), priorDate))
  await widget.getByText('前日 23:00 — 01:00', { exact: true }).waitFor()
  unwrap(await widget.evaluate(id => window.workbench.deleteCheckin(id), overnight.id))
  await widget.getByRole('button', { name: '关闭面板', exact: true }).click()
  pass('editing the date preserves record identity; midnight segments show the correct day prefix')
  unwrap(await main.evaluate(async () => {
    const result = await window.workbench.researchReport()
    if (!result.ok) return result
    const entry = result.data.checkins.find(item => item.startTime === '13:00')
    return window.workbench.saveCheckin({ date: entry.date, startTime: '13:00', endTime: '17:00', endsNextDay: false, notes: '主窗口修改' }, entry.id)
  }))
  await widget.waitForFunction(() => document.querySelector('.widget-today-value strong').textContent === '7小时')
  pass('main-window edits update the desktop widget immediately')
  const geometry = await widget.evaluate(() => {
    const shell = document.querySelector('.widget-shell').getBoundingClientRect()
    return { width: shell.width, height: shell.height, buttons: [...document.querySelectorAll('.widget-actions > button')].map(button => {
      const rect = button.getBoundingClientRect(); return { width: rect.width, height: rect.height }
    }), overflow: document.documentElement.scrollWidth > innerWidth }
  })
  assert.equal(geometry.width, 420); assert.equal(geometry.height, 614)
  assert.equal(geometry.overflow, false)
  for (const button of geometry.buttons) assert.ok(button.width >= 150 && button.height >= 44)
  await shot('normal')
  const beforeFocus = unwrap(await widget.evaluate(() => window.workbench.researchReport()))
  await widget.getByRole('button', { name: '心流模式', exact: true }).click()
  const transition = await widget.evaluate(() => new Promise(resolve => {
    const samples = [], start = performance.now()
    const sample = time => {
      const shell = document.querySelector('.widget-shell').getBoundingClientRect()
      const clock = document.querySelector('.widget-clock').getBoundingClientRect()
      samples.push({ at: Math.round(time - start), height: shell.height, clockX: clock.x, clockY: clock.y,
        clockOpacity: getComputedStyle(document.querySelector('.widget-clock')).opacity })
      if (time - start < 650) requestAnimationFrame(sample); else resolve(samples)
    }
    requestAnimationFrame(sample)
  }))
  assert.ok(transition.length >= 5)
  assert.ok(transition.every(frame => frame.clockOpacity === '1'))
  assert.ok(transition.every((frame, index) => !index || frame.height <= transition[index - 1].height + 1))
  writeFileSync(join(evidence, 'focus-transition.json'), JSON.stringify(transition, null, 2))
  await widget.waitForFunction(() => innerHeight === 216)
  await widget.waitForFunction(() => document.querySelector('.widget-elapsed').textContent !== '00:00:00')
  await widget.getByLabel('专注事项', { exact: true }).fill('阅读论文')
  await widget.getByLabel('专注事项', { exact: true }).press('Enter')
  await widget.mouse.move(2, 2)
  await shot('focus')
  assert.deepEqual(unwrap(await widget.evaluate(() => window.workbench.researchReport())), beforeFocus)
  await widget.keyboard.press('Escape')
  await widget.waitForFunction(() => Math.abs(innerHeight - 638) <= 1 && Math.abs(document.querySelector('.widget-shell').getBoundingClientRect().height - 614) < 1)
  pass('focus resizes to 420×192, counts elapsed time and never changes attendance')
  await widget.emulateMedia({ reducedMotion: 'reduce' })
  await widget.getByRole('button', { name: '心流模式', exact: true }).click()
  await widget.waitForFunction(() => innerHeight === 216)
  await widget.keyboard.press('Escape')
  await widget.waitForFunction(() => Math.abs(innerHeight - 638) <= 1 && Math.abs(document.querySelector('.widget-shell').getBoundingClientRect().height - 614) < 1)
  pass('reduced-motion entry and exit settle at the correct size')
  await widget.emulateMedia({ reducedMotion: 'no-preference' })
  await widget.getByRole('button', { name: '增加出差', exact: true }).click()
  await widget.getByRole('button', { name: '保存出差', exact: true }).click()
  await widget.getByRole('status').filter({ hasText: '已保存' }).waitFor()
  await widget.getByRole('button', { name: '关闭面板', exact: true }).click()
  await widget.waitForFunction(() => document.querySelector('.widget-absence-state')?.textContent.includes('出差') && document.querySelector('.widget-today-value strong').textContent === '0分钟')
  assert.equal(unwrap(await main.evaluate(() => window.workbench.researchReport())).checkins.length, 2)
  pass('trip dates share the existing target deduction while retaining check-in entries')
  unwrap(await widget.evaluate(() => window.workbench.updateWidgetPreferences({ alwaysOnTop: true })))
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(window => window.getTitle() === 'PhD 桌面打卡').isAlwaysOnTop()), true)
  unwrap(await widget.evaluate(() => window.workbench.updateWidgetPreferences({ alwaysOnTop: false })))
  const persisted = unwrap(await widget.evaluate(() => window.workbench.researchReport()))
  await app.close(); app = null
  await launch(true)
  assert.equal(app.windows().length, 1)
  assert.deepEqual(unwrap(await widget.evaluate(() => window.workbench.researchReport())), persisted)
  assert.equal(unwrap(await widget.evaluate(() => window.workbench.widgetSnapshot())).preferences.focusText, '阅读论文')
  assert.equal(await widget.locator('.widget-shell').getAttribute('data-mode'), 'normal')
  pass('login-mode launches only the widget and local records/preferences survive restart')
  if (process.argv.includes('--live-weather')) {
    const cities = unwrap(await widget.evaluate(() => window.workbench.searchWidgetCities('杭州')))
    assert.ok(cities.length)
    unwrap(await widget.evaluate(city => window.workbench.updateWidgetPreferences({ city }), cities[0]))
    const liveWeather = unwrap(await widget.evaluate(() => window.workbench.widgetWeather(true)))
    assert.equal(liveWeather.stale, false, liveWeather.error)
    assert.ok(Number.isFinite(liveWeather.weather.temperature))
    pass('live Open-Meteo city search and current-weather request returned successfully')
  }
  if (process.argv.includes('--inspect')) {
    for (const entry of persisted.absences) unwrap(await widget.evaluate(id => window.workbench.deleteCheckinAbsence(id), entry.id))
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows().find(window => window.getTitle() === 'PhD 桌面打卡'); window.show(); window.focus() })
    console.log('INSPECTION_READY', join(profile, 'inspection-done'))
    await new Promise(resolve => {
      const started = Date.now()
      const timer = setInterval(() => {
        if (existsSync(join(profile, 'inspection-done')) || Date.now() - started > 180000) { clearInterval(timer); resolve() }
      }, 500)
    })
  }
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, geometry, profile }, null, 2))
} finally {
  if (app) await app.close()
  writeFileSync(join(evidence, 'checks.json'), JSON.stringify({ checks, errors }, null, 2))
}

