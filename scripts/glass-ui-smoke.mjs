import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const baseline = process.argv.includes('--baseline')
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const evidence = resolve(`test-results/ui-redesign-${version}`, baseline ? 'baseline' : executablePath ? 'packaged' : 'development')
const profile = join(evidence, `data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ ...(executablePath ? { executablePath: resolve(executablePath), args: ['--seed-demo'] } : { args: ['.', '--seed-demo'] }), env })
const errors = [], checks = [], geometry = []
const unwrap = result => { assert.equal(result.ok, true, result.error?.message); return result.data }
try {
  const page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0]
    win.setContentSize(1440, 900)
    win.webContents.setBackgroundThrottling(false)
    win.showInactive()
  })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ background: 'sage', fontSize: 14, dockAutoHide: false })))
  unwrap(await page.evaluate(() => window.workbench.setAppearance('light')))
  await page.evaluate(async () => {
    const result = await window.workbench.bootstrap()
    if (!result.ok) throw Error(result.error.message)
    if (result.data.projects.length) return
    const project = await window.workbench.createProject({ name: '空间光谱融合研究', description: '隔离界面检查示例', colorKey: 'sage' })
    if (!project.ok) throw Error(project.error.message)
    const date = new Date()
    const today = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    for (const title of ['梳理论文方法与实验条件', '整理本周实验结果', '准备导师组会材料']) {
      const task = await window.workbench.createTask({ title, projectId: project.data.id, scheduledDate: today })
      if (!task.ok) throw Error(task.error.message)
    }
  })
  await page.evaluate(async () => {
    const snapshot = await window.workbench.bootstrap()
    if (!snapshot.ok) throw Error(snapshot.error.message)
    const date = new Date(); date.setDate(date.getDate() - 3)
    const past = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const task = await window.workbench.createTask({ title: '复核实验与论文图表', projectId: snapshot.data.projects[0].id, scheduledDate: past })
    if (!task.ok) throw Error(task.error.message)
    const folder = await window.workbench.createFolder({ name: '光谱重建', parentId: null })
    if (!folder.ok) throw Error(folder.error.message)
  })
  unwrap(await page.evaluate(path => window.workbench.importPapers([path], null, false), resolve('tests/fixtures/translation-check.pdf')))
  const paper = unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers[0]
  unwrap(await page.evaluate(id => window.workbench.updatePaper(id, { title: '跨尺度空间光谱融合：研究阅读示例', authors: 'Research Group', journal: 'Imaging Research', year: '2026' }), paper.id))
  unwrap(await page.evaluate(() => window.workbench.createPublication(null, { title: 'Spatial–Spectral Reconstruction for Hyperspectral Images', authors: 'Research Group', journal: 'Imaging Research', publishedDate: '2026-10-01', doi: '', casPartition: '', jcrQuartile: '', notes: '' })))
  await page.reload()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const capture = async name => {
    await page.waitForTimeout(350)
    await page.waitForFunction(() => [...document.querySelectorAll('.workspace-header > div, .quick-capture, .all-task-overview, .overdue-panel, .today-scope-summary')].every(element => parseFloat(getComputedStyle(element).opacity) > .999))
    const measure = await page.evaluate(() => {
      const dock = document.querySelector('.dock').getBoundingClientRect()
      const quote = document.querySelector('.daily-encouragement').getBoundingClientRect()
      const selected = document.querySelector('.dock-item.selected').getBoundingClientRect()
      const indicator = document.querySelector('.dock-selection').getBoundingClientRect()
      const clip = getComputedStyle(document.querySelector('.dock-wrap'), '::before').content
      const header = document.querySelector('.workspace-header > div')?.getBoundingClientRect()
      const body = document.querySelector('.workspace-body, .library-toolbar, .submissions-body, .settings-body')
      const bodyLeft = body ? body.getBoundingClientRect().left + parseFloat(getComputedStyle(body).paddingLeft) : null
      const footerCovered = [...document.querySelectorAll('.appearance-switch button')].some(button => {
        const rect = button.getBoundingClientRect()
        return rect.width > 0 && rect.left < dock.right && rect.right > dock.left && rect.top < dock.bottom && rect.bottom > dock.top
      })
      return { viewport: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1,
        quoteOffset: Math.abs(quote.left + quote.width / 2 - innerWidth / 2), quoteWidth: quote.width,
        dockOffset: Math.abs(dock.left + dock.width / 2 - innerWidth / 2), dockLeft: dock.left, dockRight: dock.right,
        indicatorOffset: Math.abs(selected.left - indicator.left), indicatorWidth: indicator.width, selectedWidth: selected.width,
        silhouette: clip, footerCovered, headerOffset: header && bodyLeft !== null ? Math.abs(header.left - bodyLeft) : 0, radius: parseFloat(getComputedStyle(document.querySelector('.dock')).borderRadius),
        buttons: [...document.querySelectorAll('.dock-item')].map(button => ({ text: button.textContent, width: button.clientWidth, scrollWidth: button.scrollWidth, height: button.clientHeight })) }
    })
    geometry.push({ name, ...measure })
    if (!baseline) {
      assert.equal(measure.overflow, false, `${name}: viewport overflow`)
      assert.ok(measure.quoteOffset < 2, `${name}: quote offset ${measure.quoteOffset}`)
      assert.ok(measure.dockOffset < 2 && measure.dockLeft >= 0 && measure.dockRight <= measure.viewport, `${name}: dock containment`)
      assert.ok(measure.indicatorOffset < 2 && Math.abs(measure.indicatorWidth - measure.selectedWidth) < 2, `${name}: selected pill alignment`)
      assert.equal(measure.silhouette, 'none')
      assert.ok(measure.radius > 100)
      assert.equal(measure.footerCovered, false, `${name}: dock obscures appearance controls`)
      assert.ok(measure.headerOffset < 2, `${name}: title/content alignment ${measure.headerOffset}`)
      for (const button of measure.buttons) assert.ok(button.scrollWidth <= button.width + 1 && button.height >= 40, `${name}: ${button.text}`)
    }
    await page.screenshot({ path: join(evidence, `${name}.png`), animations: 'disabled', scale: 'css' })
  }
  const nav = page.getByRole('navigation', { name: '科研工作空间' })
  if (!baseline) {
    const quote = page.locator('.daily-encouragement')
    const before = await quote.boundingBox()
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2)
    await page.mouse.down(); await page.waitForTimeout(800)
    const held = await quote.boundingBox()
    assert.ok(Math.abs(before.x - held.x) < 1 && Math.abs(before.y - held.y) < 1, 'Holding the daily quote must not change its position')
    await page.mouse.move(before.x - 20, before.y); await page.mouse.up()
    checks.push('The daily quote stays centered during a sustained press')
  }
  const modules = [['研究计划', '.planner-workspace'], ['文献阅读', '.literature-workspace'], ['科研成果', '.outputs-workspace'], ['论文投稿', '.submissions-workspace'], ['研究报表', '.reports-workspace'], ['设置', '.settings-workspace']]
  for (const [label, selector] of modules) {
    await nav.getByRole('button', { name: label, exact: true }).click()
    await page.locator(selector).waitFor()
    await capture(`light-${label}`)
  }
  checks.push('All six workspaces render with centered quote, contained dock and aligned selection')
  if (!baseline) {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1920, 1080))
    for (const label of ['研究计划', '研究报表']) {
      await nav.getByRole('button', { name: label, exact: true }).click()
      await capture(`wide-${label}`)
    }
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1440, 900))
    checks.push('At 1920 × 1080, planner and report titles keep the same left edge as their content')
  }
  await nav.getByRole('button', { name: '研究计划', exact: true }).click()
  for (const view of ['全部任务', '日历']) {
    await page.getByRole('navigation', { name: '研究计划视图' }).getByRole('button', { name: new RegExp(`^${view}`) }).click()
    await capture(`light-${view}`)
  }
  await nav.getByRole('button', { name: '文献阅读', exact: true }).click()
  if (!baseline) {
    const counts = await page.locator('.folder-name small').evaluateAll(elements => elements.map(element => element.getBoundingClientRect().right))
    assert.ok(counts.length >= 2 && Math.max(...counts) - Math.min(...counts) < 2, 'Arvix and ordinary folder counts share one column')
    checks.push('Arvix and ordinary folder counts align')
  }
  await page.getByRole('button', { name: /Arxiv Daily/ }).first().click()
  await capture('light-arxiv-discovery')
  if (!baseline) {
    assert.equal(await page.getByTestId('paper-card').count(), 0)
    await page.getByRole('button', { name: /^Arvix/ }).click()
    await page.getByRole('heading', { name: 'Arvix', exact: true }).waitFor()
    assert.equal(await page.getByRole('button', { name: '立即检索', exact: true }).count(), 0)
    await capture('light-arvix-reading')
    checks.push('Discovery and Arvix reading are separate views')
  }
  await nav.getByRole('button', { name: '设置', exact: true }).click()
  await page.locator('#assistant-settings').waitFor()
  for (const label of ['AI 助手', '文件保存']) {
    await page.getByRole('navigation', { name: '设置分类' }).getByRole('button', { name: label, exact: true }).click()
    await capture(`light-settings-${label}`)
  }
  await nav.getByRole('button', { name: '研究报表', exact: true }).click()
  await page.locator('#report-trends').waitFor()
  for (const label of ['研究趋势', '研究打卡', '津贴到账']) {
    await page.getByRole('navigation', { name: '研究报表分类' }).getByRole('button', { name: label, exact: true }).click()
    await page.waitForTimeout(300)
    await capture(`light-reports-${label}`)
  }
  if (!baseline) {
    unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18 })))
    unwrap(await page.evaluate(() => window.workbench.setAppearance('dark')))
    await page.reload()
    await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark' && document.documentElement.dataset.textSize === '18')
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100, 720))
    for (const [label, selector] of modules) {
      await nav.getByRole('button', { name: label, exact: true }).click()
      await page.locator(selector).waitFor()
      if (label === '文献阅读') {
        assert.ok(await page.locator('.folder-name > span').filter({ hasText: /^Arvix$/ }).evaluate(element => element.scrollWidth <= element.clientWidth), 'Arvix remains readable at 18px in the minimum window')
      }
      await capture(`compact-dark-${label}`)
    }
    unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ sidebarCollapsed: true })))
    await page.reload()
    await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    await page.waitForFunction(() => document.documentElement.dataset.sidebar === 'collapsed')
    await capture('compact-dark-collapsed-sidebar')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await nav.getByRole('button', { name: '研究计划', exact: true }).click()
    await capture('reduced-motion-planner')
    checks.push('1100 × 720, 18px text, dark appearance, sidebar collapse, and reduced motion remain usable')
  }
  assert.deepEqual(errors, [])
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ checks, geometry, errors, profile }, null, 2))
  console.log(JSON.stringify({ checks, screenshots: geometry.length, errors, evidence }, null, 2))
} finally { await app.close() }
