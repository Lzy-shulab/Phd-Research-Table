import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'
import { readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { waitForAsync } from './test-helpers.mjs'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results/reader-selection', executablePath ? 'packaged' : 'development')
const profile = join(evidence, 'isolated-' + Date.now())
mkdirSync(profile, { recursive: true })
const locator = join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json')
const production = new DatabaseSync(JSON.parse(readFileSync(locator, 'utf8')).databasePath, { readOnly: true })
const reference = production.prepare("SELECT source_path, translated_path FROM papers WHERE title LIKE 'All in One%' AND translated_path IS NOT NULL LIMIT 1").get()
production.close()
assert.ok(reference, 'Expected the reference paper from the supplied screenshot')
const source = join(evidence, 'original.pdf'), translated = join(evidence, 'bilingual.pdf')
copyFileSync(reference.source_path, source); copyFileSync(reference.translated_path, translated)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const results = [], errors = []
let app, page, paperId
const unwrap = result => { if (!result.ok) throw Error(result.error.message); return result.data }
async function launch() {
  app = await electron.launch({ ...(executablePath ? { executablePath, args: [] } : { args: ['.'] }), env })
  page = await app.firstWindow()
  page.on('pageerror', error => errors.push(error.message))
  await app.evaluate(({ BrowserWindow }) => { const w=BrowserWindow.getAllWindows()[0]; w.setContentSize(1600,1000); w.showInactive(); w.webContents.setBackgroundThrottling(false) })
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
}
const nav = name => page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name, exact: true }).click()
try {
  await launch()
  unwrap(await page.evaluate(source => window.workbench.importPapers([source], null, false), source))
  const bootstrap = unwrap(await page.evaluate(() => window.workbench.bootstrap()))
  assert.ok(bootstrap.databasePath.startsWith(profile + '\\'))
  paperId = unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers[0].id
  unwrap(await page.evaluate(id => window.workbench.updatePaper(id, { notes: '已有笔记保留，不再在阅读器中编辑。' }), paperId))
  const managedSource=unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers[0].sourcePath
  const managedTranslated=join(dirname(managedSource),'bilingual.pdf')
  copyFileSync(translated,managedTranslated)
  const isolatedDb = new DatabaseSync(bootstrap.databasePath)
  isolatedDb.prepare("UPDATE papers SET translated_path=?, translation_status='ready' WHERE id=?").run(managedTranslated, paperId)
  isolatedDb.close()
  unwrap(await page.evaluate(() => window.workbench.updateInterfacePreferences({ fontSize: 18, dockAutoHide: false })))
  await page.reload(); await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  await nav('文献阅读')
  await page.getByTestId('paper-card').getByRole('button', { name: '原文', exact: true }).click()
  for (const [mode, variant] of [['light','source'], ['dark','translated']]) {
    if (variant === 'translated') await page.getByRole('button', { name: '中英对照', exact: true }).click()
    // Change appearance through the renderer-owned state via the settings UI before reopening.
    if (mode === 'dark') {
      await page.getByRole('button', { name: '返回文献库', exact: true }).click()
      await page.getByRole('button', { name: '深色模式', exact: true }).click()
      await page.getByTestId('paper-card').getByRole('button', { name: '已翻译', exact: true }).click()
    }
    await page.waitForFunction(()=>document.querySelector('.pdf-page[data-rendered="true"]'))
    if (variant === 'translated') {
      const chinese=await page.locator('.textLayer').evaluate(layer=>{
        const el=[...layer.querySelectorAll('span')].find(el=>/[\u4e00-\u9fff]/.test(el.textContent)&&el.textContent.length>14&&el.getBoundingClientRect().width>60)
        el.scrollIntoView({block:'center',behavior:'instant'});const r=el.getBoundingClientRect()
        return {x:r.left+r.width*.85,endX:r.left+r.width*.15,y:r.top+r.height/2}
      })
      await page.mouse.move(chinese.x,chinese.y);await page.mouse.down();await page.mouse.move(chinese.endX,chinese.y,{steps:25});await page.mouse.up()
      assert.match(await page.evaluate(()=>window.getSelection()?.toString()),/[\u4e00-\u9fff]/)
      await page.getByRole('toolbar',{name:'选择划线颜色'}).waitFor()
      await page.getByRole('heading',{name:'阅读批注',exact:true}).click()
      assert.equal(await page.locator('.highlight-palette').count(),0)
    }
    await page.waitForFunction(() => [...document.querySelectorAll('.pdf-page[data-rendered="true"] .textLayer span')].some(el => el.textContent.trim().length > 14 && el.getBoundingClientRect().width > 60))
    const input=page.getByRole('textbox', { name: '文献页码', exact: true })
    await input.fill('4'); await input.press('Enter')
    await page.getByTestId('pdf-page').filter({ has: page.locator('canvas[aria-label="PDF 第 4 页"]') }).waitFor()
    await page.waitForFunction(() => [...document.querySelectorAll('.pdf-page[data-rendered="true"] .textLayer span')].some(el => el.textContent.trim().length > 14 && el.getBoundingClientRect().width > 60))
    for (const [index,label] of ['重点','方法','证据','疑问'].entries()) {
      const geometry = await page.locator('.textLayer').evaluate((layer, index) => {
        const spans=[...layer.querySelectorAll('span')].filter(el => el.textContent.trim().length>14 && el.getBoundingClientRect().width>60)
        const el=spans[index + 8]; el.scrollIntoView({ block:'center', behavior:'instant' })
        const r=el.getBoundingClientRect(), style=getComputedStyle(el)
        layer.dataset.mutations='0'
        if (!layer._observer) {
          layer._observer=new MutationObserver(records => { layer.dataset.mutations=String(Number(layer.dataset.mutations)+records.filter(record => record.type==='childList').length) })
          layer._observer.observe(layer,{childList:true,subtree:true})
        }
        return { x:r.left+r.width*.15, y:r.top+r.height/2, endX:r.left+r.width*.9, font:style.fontFamily, size:style.fontSize, transform:style.transform }
      }, index)
      await page.mouse.move(geometry.x,geometry.y); await page.mouse.down()
      await page.mouse.move(geometry.endX,geometry.y,{steps:30})
      const selected = await page.locator('.textLayer').evaluate(layer => {
        const node=window.getSelection()?.anchorNode?.parentElement
        const s=getComputedStyle(node), selectionStyle=getComputedStyle(node,'::selection')
        return { text:window.getSelection()?.toString(), parentText:node.textContent, font:s.fontFamily, size:s.fontSize, transform:s.transform, selectedColor:selectionStyle.color, mutations:Number(layer.dataset.mutations), userSelect:s.userSelect, role:node.getAttribute('role'), offset:window.getSelection()?.anchorOffset, end:window.getSelection()?.focusOffset, same:window.getSelection()?.anchorNode===window.getSelection()?.focusNode }
      })
      assert.ok(selected.text?.trim().length>3, JSON.stringify({mode,variant,index,geometry,selected}))
      assert.deepEqual([selected.font, selected.size, selected.transform],[geometry.font,geometry.size,geometry.transform])
      assert.equal(selected.selectedColor,'rgba(0, 0, 0, 0)')
      assert.equal(selected.mutations,0, 'Text layer changed while selecting')
      await page.mouse.up()
      await page.getByRole('toolbar', { name:'选择划线颜色' }).getByRole('button', { name:label+'划线', exact:true }).click()
      await waitForAsync(page, async expected => {
        const snapshot = await window.workbench.librarySnapshot()
        return snapshot.ok && snapshot.data.papers[0].highlights.length === expected
      }, (variant === 'source' ? 0 : 4) + index + 1)
      assert.equal(await page.locator('.reader-category-toggle[aria-expanded="true"]').innerText(), label + '\n' + (variant === 'source' ? 1 : 2))
      results.push({ mode,variant,label,selectedLength:selected.text.length,layerRebuilds:selected.mutations })
    }
    assert.equal(await page.getByRole('textbox', { name:'阅读笔记', exact:true }).count(), 0)
    await input.fill('1'); await input.press('Enter')
    await page.waitForFunction(() => document.querySelector('.pdf-page[data-rendered="true"] canvas')?.getAttribute('aria-label') === 'PDF 第 1 页')
    await page.getByRole('button',{name:/跳到第 4 页批注/}).last().click()
    await page.waitForFunction(() => document.querySelector('.pdf-page[data-rendered="true"] canvas')?.getAttribute('aria-label') === 'PDF 第 4 页' && document.querySelector('.pdf-highlight.is-located')?.getAnimations().length > 0)
    const located = await page.locator('.pdf-highlight.is-located').first().evaluate(element => {
      const bounds = element.getBoundingClientRect(), viewport = element.closest('.reader-scroll').getBoundingClientRect()
      return { inView: bounds.top >= viewport.top && bounds.bottom <= viewport.bottom, outline: getComputedStyle(element).outlineStyle }
    })
    assert.deepEqual(located, { inView: true, outline: 'none' })
    await page.screenshot({path:join(evidence,mode+'-'+variant+'.png'),animations:'disabled',scale:'css'})
  }
  assert.equal(unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers[0].highlights.length,8)
  await page.getByRole('button',{name:/跳到第 4 页批注/}).first().click()
  await page.getByRole('button',{name:'原文',exact:true}).filter({hasNot:page.locator('svg')}).waitFor()
  await page.waitForFunction(()=>document.querySelector('[aria-label="文献版本"] button')?.getAttribute('aria-pressed')==='true')
  await page.locator('.pdf-highlight.is-located').first().waitFor()
  await page.getByRole('button',{name:/跳到第 4 页批注/}).last().click()
  await page.waitForFunction(()=>document.querySelector('[aria-label="文献版本"] button:last-child')?.getAttribute('aria-pressed')==='true')
  await page.locator('.pdf-highlight.is-located').first().waitFor()
  const beforeWidth=await page.locator('.pdf-page canvas').evaluate(el=>el.width)
  await page.getByRole('button',{name:'放大文献',exact:true}).click()
  await page.getByRole('button',{name:'放大文献',exact:true}).click()
  await page.waitForFunction(width=>document.querySelector('.pdf-page[data-rendered="true"] canvas')?.width>width*1.3,beforeWidth)
  const edge=await page.locator('.reader-scroll').evaluate(viewport=>{
    viewport.scrollTop=0;const bounds=viewport.getBoundingClientRect()
    const el=[...viewport.querySelectorAll('.textLayer span')].find(el=>{const r=el.getBoundingClientRect();return el.textContent.length>14&&r.top>bounds.top+40&&r.bottom<bounds.bottom-100&&r.width>60})
    const r=el.getBoundingClientRect();return {x:r.left+r.width*.15,y:r.top+r.height/2,bottom:bounds.bottom-2}
  })
  await page.mouse.move(edge.x,edge.y);await page.mouse.down();await page.mouse.move(edge.x,edge.bottom,{steps:30})
  await page.waitForFunction(()=>document.querySelector('.reader-scroll').scrollTop>60)
  await page.mouse.up()
  assert.ok((await page.evaluate(()=>window.getSelection()?.toString())).length>20)
  await page.getByRole('heading',{name:'阅读批注',exact:true}).click()
  await page.locator('.reader-fit').click()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1100,720))
  await page.waitForFunction(() => innerWidth === 1100 && document.querySelector('.pdf-page[data-rendered="true"]'))
  const compactReader = await page.evaluate(() => {
    const back = document.querySelector('.reader-back-button').getBoundingClientRect()
    const versions = document.querySelector('.reader-center-tools').getBoundingClientRect()
    const tools = document.querySelector('.reader-tools').getBoundingClientRect()
    const panel = document.querySelector('.reader-notes-panel').getBoundingClientRect()
    return { backWidth: back.width, controlsFit: back.right <= versions.left && versions.right <= tools.left, panelFits: panel.right <= innerWidth, documentFits: document.documentElement.scrollWidth <= innerWidth }
  })
  assert.ok(compactReader.backWidth < 210 && compactReader.controlsFit && compactReader.panelFits && compactReader.documentFits, JSON.stringify(compactReader))
  await page.screenshot({path:join(evidence,'compact-dark-reader.png'),animations:'disabled',scale:'css'})
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setContentSize(1600,1000))
  await page.getByRole('button',{name:'返回文献库',exact:true}).click()
  await nav('设置')
  assert.equal(await page.getByRole('heading',{name:'工作台风格',exact:true}).count(),0)
  assert.equal(unwrap(await page.evaluate(() => window.workbench.interfacePreferences())).preferences.visualStyle,'classic')
  const surfaces=[]
  for (const [label,id] of [['暖橙','orange'],['克莱因蓝','klein'],['青绿','sage']]) {
    await page.getByRole('button',{name:label+'背景',exact:true}).click()
    await page.waitForFunction(id => document.documentElement.dataset.background===id,id)
    surfaces.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--surface-raised')))
    assert.equal(unwrap(await page.evaluate(() => window.workbench.interfacePreferences())).preferences.visualStyle,'classic')
  }
  assert.equal(new Set(surfaces).size,3)
  await page.getByRole('button',{name:'浅色',exact:true}).click()
  await page.getByRole('button',{name:'暖橙背景',exact:true}).click()
  await page.screenshot({path:join(evidence,'classic-orange.png'),animations:'disabled',scale:'css'})
  const button=page.getByRole('button',{name:'上传背景',exact:true})
  await page.keyboard.press('Tab')
  await button.focus()
  assert.notEqual(await button.evaluate(el=>getComputedStyle(el).outlineStyle),'none')
  await app.evaluate(({dialog},imagePath)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[imagePath]})},join(evidence,'classic-orange.png'))
  await button.click()
  await page.waitForFunction(()=>document.documentElement.dataset.background==='custom')
  assert.equal(await page.locator('[class*="wilds"]').count(),0)
  await page.screenshot({path:join(evidence,'classic-custom-background.png'),animations:'disabled',scale:'css'})
  await nav('文献阅读')
  const primary=page.getByRole('button',{name:'添加文献',exact:true})
  await primary.hover()
  await page.emulateMedia({reducedMotion:'reduce'})
  assert.equal(await page.locator('[class*="wilds"]').count(),0)
  await app.close(); app=null
  await launch(); await nav('文献阅读')
  await page.getByTestId('paper-card').getByRole('button',{name:'原文',exact:true}).click()
  assert.equal(await page.getByRole('textbox',{name:'阅读笔记',exact:true}).count(),0)
  assert.equal(await page.locator('.reader-annotation').count(),0)
  await page.getByRole('button',{name:'方法 2',exact:true}).click()
  assert.equal(await page.locator('.reader-annotation').count(),2)
  await page.getByRole('button',{name:'关闭对话框',exact:true}).click()
  assert.equal(unwrap(await page.evaluate(() => window.workbench.librarySnapshot())).papers[0].notes,'已有笔记保留，不再在阅读器中编辑。')
  assert.deepEqual(errors,[])
  writeFileSync(join(evidence,'result.json'),JSON.stringify({results,styleAndBackgroundIndependent:true,customBackgroundSupported:true,chineseReverseSelection:true,selectionScrollsAtPageEdge:true,variantAnnotationJump:true,crossPageLocateAfterRender:true,verticalAccordion:true,existingNotesPreserved:true,motionRespectsPreference:true,errors},null,2))
  console.log('PASS real source/bilingual PDF selections, vertical categories, cross-page sentence focus, existing notes and background combinations')
} catch(error) { if(page) await page.screenshot({path:join(evidence,'failure.png'),animations:'disabled'}).catch(()=>{}); console.log(JSON.stringify({errors,results})); throw error } finally { if(app) await app.close() }

