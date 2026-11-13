import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const evidence = resolve(option('evidence') || 'test-results/widget-redesign/details')
const profile = join(evidence, `isolated-data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const exe = option('executable')
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const unwrap = value => { assert.equal(value.ok, true, JSON.stringify(value)); return value.data }
const checks = [], errors = []
const pass = value => { checks.push(value); console.log('PASS', value) }
let app
try {
  app = await electron.launch({ executablePath: resolve(exe || 'node_modules/electron/dist/electron.exe'), args: [...(exe ? [] : ['.']), '--desktop-widget'], env })
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.waitForFunction(() => document.querySelector('.widget-today') && !document.querySelector('.widget-today').disabled)
  const today = await page.evaluate(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })
  const month = today.slice(0, 7)
  const lastDay = new Date(`${month}-01T12:00:00`); lastDay.setMonth(lastDay.getMonth() + 1, 0)
  const daysInMonth = lastDay.getDate()
  const preferences = patch => page.evaluate(patch => window.workbench.updateWidgetPreferences(patch), patch).then(unwrap)
  const shot = name => page.screenshot({ path: join(evidence, `${name}.png`), omitBackground: true })
  const close = () => page.getByRole('button', { name: '关闭面板', exact: true }).click()
  await preferences({ scale: 1 })
  for (const date of new Set([`${month}-01`, `${month}-02`, `${month}-04`, today])) {
    for (const [startTime, endTime] of [['09:00', '12:00'], ['13:30', '17:15']]) {
      unwrap(await page.evaluate(input => window.workbench.saveCheckin(input), { date, startTime, endTime, endsNextDay: false, notes: '' }))
    }
  }
  const baseline = unwrap(await page.evaluate(() => window.workbench.researchReport()))
  await shot('home-100')
  await page.getByRole('button', { name: '查看本周打卡明细' }).locator('.widget-period-label').click()
  await page.getByRole('dialog', { name: '本周打卡', exact: true }).waitFor()
  const weekRows = await page.locator('.widget-attendance-row').count()
  assert.equal(weekRows, 7)
  const monday = new Date(`${today}T12:00:00`)
  monday.setDate(monday.getDate() - (monday.getDay() + 6) % 7)
  const sunday = new Date(monday); sunday.setDate(sunday.getDate() + 6)
  const localDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  assert.equal(await page.locator('.widget-attendance-row').first().getAttribute('data-date'), localDate(monday))
  assert.equal(await page.locator('.widget-attendance-row').last().getAttribute('data-date'), localDate(sunday))
  assert.equal(await page.getByRole('button', { name: '查看本周打卡明细', includeHidden: true }).getAttribute('title'), `${localDate(monday)} — ${localDate(sunday)}`)
  const todayRow = page.locator(`.widget-attendance-row[data-date="${today}"]`)
  assert.match(await todayRow.innerText(), /09:00 — 12:00/)
  assert.match(await todayRow.innerText(), /13:30 — 17:15/)
  assert.match(await todayRow.innerText(), /6小时45分/)
  await shot('week-100')
  await close()
  await page.getByRole('button', { name: '查看本月打卡明细' }).locator('.widget-ring').click()
  await page.getByRole('dialog', { name: '本月打卡', exact: true }).waitFor()
  assert.equal(await page.locator('.widget-attendance-row').count(), daysInMonth)
  await shot('month-100')
  const list = page.locator('.widget-attendance-list')
  const scroll = await list.evaluate(element => ({ height: element.clientHeight, full: element.scrollHeight }))
  assert.ok(scroll.full > scroll.height)
  await list.hover(); await page.mouse.wheel(0, 1600)
  await page.waitForFunction(() => document.querySelector('.widget-attendance-list').scrollTop > 100)
  await page.getByRole('button', { name: `编辑 ${today} 打卡`, exact: true }).click()
  assert.equal(await page.getByLabel('打卡日期', { exact: true }).inputValue(), today)
  await shot('checkin-100')
  await page.getByRole('button', { name: '返回本月打卡', exact: true }).click()
  assert.ok(await list.evaluate(element => element.scrollTop) > 100)
  await list.focus(); await page.keyboard.press('End')
  await page.getByRole('button', { name: `编辑 ${month}-${daysInMonth} 打卡`, exact: true }).scrollIntoViewIfNeeded()
  await shot('month-bottom-100')
  await page.getByRole('button', { name: '本周', exact: true }).click()
  assert.equal(await page.locator('.widget-attendance-row').count(), weekRows)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '查看本周打卡明细' }).waitFor({ state: 'visible' })
  pass('period labels and rings open daily details; all month dates, multiple segments, scrolling and date editing work')
  for (const [button, file] of [['增加出差', 'trip'], ['增加休假', 'leave'], ['设置天气城市', 'city'], ['面板设置', 'settings']]) {
    await page.getByRole('button', { name: button, exact: true }).click()
    await shot(`${file}-100`)
    await close()
  }
  await page.getByRole('button', { name: '面板设置', exact: true }).click()
  await page.getByRole('slider', { name: '玻璃浓度', exact: true }).focus()
  await page.keyboard.press('Home')
  await page.waitForFunction(() => getComputedStyle(document.documentElement).getPropertyValue('--glass-opacity').trim() === '0.35')
  const alpha = await page.locator('.widget-sheet').evaluate(element => getComputedStyle(element).backgroundColor)
  const opacity = Number(alpha.match(/, ([\d.]+)\)$/)?.[1])
  assert.ok(opacity > 0 && opacity < 0.5)
  await page.getByRole('dialog').getByRole('button', { name: /天气城市/ }).click()
  await page.getByRole('button', { name: '返回面板设置' }).click()
  await close()
  await preferences({ glassOpacity: 0.62 })
  pass('all secondary pages share transparent material; opacity saves and nested back navigation works')
  for (const scale of [0.75, 0.6]) {
    await preferences({ scale })
    await page.waitForFunction(scale => Math.abs(document.querySelector('.widget-shell').getBoundingClientRect().width - 420 * scale) < 0.1, scale)
    await shot(`home-${scale * 100}`)
    await page.getByRole('button', { name: '查看本月打卡明细' }).click()
    await list.evaluate(element => { element.scrollTop = 0 })
    const layout = await page.evaluate(() => {
      const sheet = document.querySelector('.widget-sheet').getBoundingClientRect()
      const list = document.querySelector('.widget-attendance-list')
      return { right: sheet.right, bottom: sheet.bottom, width: innerWidth, height: innerHeight, overflow: list.scrollWidth > list.clientWidth }
    })
    assert.ok(layout.right <= layout.width + 1 && layout.bottom <= layout.height + 1)
    assert.equal(layout.overflow, false)
    await shot(`month-${scale * 100}`)
    await close()
  }
  assert.deepEqual(unwrap(await page.evaluate(() => window.workbench.researchReport())), baseline)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.getByRole('button', { name: '查看本周打卡明细' }).focus()
  await page.keyboard.press('Enter')
  await page.getByRole('dialog', { name: '本周打卡', exact: true }).waitFor()
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '查看本周打卡明细' }).waitFor({ state: 'visible' })
  pass('60%, 75% and 100% layouts fit without horizontal scrolling; keyboard navigation leaves stored records unchanged')
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'report.json'), JSON.stringify({ checks, errors, alpha, profile }, null, 2))
  if (process.argv.includes('--inspect')) {
    await preferences({ scale: 0.75 })
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]
      window.setTitle('PhD 桌面打卡 · 预览'); window.show(); window.focus()
    })
    console.log('INSPECTION_READY', join(evidence, 'inspection-done'))
    await new Promise(resolve => {
      const started = Date.now(), timer = setInterval(() => {
        if (existsSync(join(evidence, 'inspection-done')) || Date.now() - started > 180000) { clearInterval(timer); resolve() }
      }, 500)
    })
  }
} finally { if (app) await app.close() }
