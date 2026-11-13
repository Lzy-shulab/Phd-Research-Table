import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
const exe=process.argv.find(a=>a.startsWith('--executable='))?.slice(13)
const fixtureEngine=process.env.WORKBENCH_TEST_TRANSLATION_ENGINE
const output=resolve(process.argv.find(a=>a.startsWith('--output='))?.slice(9)||'test-results/desktop-reading')
mkdirSync(output,{recursive:true})
const env={...process.env,WORKBENCH_DATA_DIR:join(output,`profile-${Date.now()}`),WORKBENCH_DISABLE_LEGACY_TRANSLATION_ENGINE:'1',WORKBENCH_DISABLE_ARXIV_AUTO:'1',WORKBENCH_DISABLE_METADATA_AUTO:'1',WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO:'1',WORKBENCH_DISABLE_NOTIFICATIONS:'1'}
delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(exe||'node_modules/electron/dist/electron.exe'),args:exe?[]:['.'],env})
app.context().setDefaultTimeout(15000)
const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data}
const errors=[],checks=[]
app.on('window',page=>page.on('pageerror',e=>errors.push(e.message)))
const pass=x=>{checks.push(x);console.log('PASS',x)}
const pageWith=async text=>{for(let i=0;i<100;i++){const p=app.windows().find(p=>p.url().includes(text));if(p)return p;await new Promise(r=>setTimeout(r,100))}throw Error('Missing '+text)}
try {
  const rail=await pageWith('rail.html')
  await rail.getByRole('button',{name:'论文阅读',exact:true}).waitFor()
  assert.equal(app.windows().length,1)
  const point=await rail.locator('[data-panel="reading"]').evaluate(button=>{
    const box=button.getBoundingClientRect(), slot=button.parentElement.getBoundingClientRect()
    return {x:(Math.max(0,box.left,slot.left)+Math.min(innerWidth,box.right,slot.right))/2,y:box.y+box.height/2}
  })
  const cdp=await app.context().newCDPSession(rail)
  const drag={items:[],files:[resolve('tests/fixtures/translation-check.pdf')],dragOperationsMask:1}
  for(const type of ['dragEnter','dragOver','drop']) await cdp.send('Input.dispatchDragEvent',{type,...point,data:drag})
  const reading=await pageWith('panel=reading')
  await reading.getByRole('button',{name:'translation-check',exact:true}).waitFor()
  assert.equal(app.windows().length,2)
  const data=unwrap(await reading.evaluate(()=>window.workbench.desktopLibrary()))
  assert.equal(data.papers.length,1)
  assert.equal(data.papers[0].translationStatus,'idle')
  assert.ok(data.papers[0].sourcePath.startsWith(env.WORKBENCH_DATA_DIR))
  pass('native-path PDF drop on rail saves to the isolated library without starting workbench')
  await reading.waitForFunction(()=>getComputedStyle(document.querySelector('.desktop-panel')).transform==='none')
  const geometry=await reading.evaluate(()=>{const r=document.querySelector('.desktop-panel').getBoundingClientRect();return {width:innerWidth,height:innerHeight,x:r.x,y:r.y,panelWidth:r.width,panelHeight:r.height,font:parseFloat(getComputedStyle(document.querySelector('.reading-paper-title')).fontSize)}})
  assert.equal(geometry.x,0);assert.equal(geometry.y,0);assert.ok(Math.abs(geometry.panelWidth-geometry.width)<1);assert.ok(Math.abs(geometry.panelHeight-geometry.height)<1);assert.ok(geometry.font>=16)
  await reading.waitForTimeout(700)
  await reading.screenshot({path:join(output,'reading.png'),scale:'css'})
  pass('panel fills native bounds with no outer rectangular margin and uses readable text')
  await reading.getByRole('button',{name:'翻译',exact:true}).click()
  await reading.getByRole('alert').filter({hasText:'尚未安装 PDF2zh 引擎'}).waitFor()
  await reading.getByRole('button',{name:'翻译',exact:true}).waitFor()
  pass('clicking Translate exposes the engine setup error and leaves the action available')
  await reading.getByRole('button',{name:'translation-check',exact:true}).click()
  const reader=await pageWith('index.html')
  await reader.waitForFunction(()=>document.querySelector('.textLayer')?.textContent?.includes('Research'),{timeout:30000})
  pass('clicking a paper launches workbench directly into the correct PDF reader')
  const readerClosed=reader.waitForEvent('close')
  await reader.getByRole('button',{name:'关闭对话框',exact:true}).click()
  await readerClosed
  await rail.getByRole('button',{name:'打开 PhD 工作台',exact:true}).click()
  const main=await pageWith('index.html')
  await main.getByRole('heading',{name:'今日计划',exact:true}).waitFor()
  const folder=unwrap(await main.evaluate(()=>window.workbench.createFolder({name:'桌面阅读测试',parentId:null})))
  unwrap(await main.evaluate(({id,folderId})=>window.workbench.updatePaper(id,{folderId}),{id:data.papers[0].id,folderId:folder.id}))
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).minimize())
  await rail.getByRole('button',{name:'论文阅读',exact:true}).click()
  await reading.getByRole('button',{name:'展开目录',exact:true}).click()
  await reading.getByRole('button',{name:'桌面阅读测试',exact:true}).click()
  await reading.getByRole('button',{name:'translation-check',exact:true}).waitFor()
  pass('folder changes from workbench synchronize to the reading panel')
  if (fixtureEngine) {
    const setEngineDirectory=directory=>{
      const db=new DatabaseSync(join(env.WORKBENCH_DATA_DIR,'workbench.sqlite'))
      db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('translation.directory',directory)
      db.close()
    }
    unwrap(await reading.evaluate(()=>window.workbench.setTranslationPaused(true)))
    const db = new DatabaseSync(join(env.WORKBENCH_DATA_DIR,'workbench.sqlite'))
    db.prepare('INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, ?)').run('translation.profiles.v1',JSON.stringify({version:1,activeId:'pdf2zh-free',profiles:[]}))
    db.close()
    setEngineDirectory(resolve(fixtureEngine))
    await reading.getByRole('button',{name:'翻译',exact:true}).click()
    await reading.getByText('翻译队列已暂停',{exact:true}).waitFor()
    setEngineDirectory('')
    await reading.getByRole('button',{name:'继续队列',exact:true}).click()
    await reading.getByText('翻译队列等待配置',{exact:true}).waitFor()
    await reading.getByRole('alert').filter({hasText:'尚未安装 PDF2zh 引擎'}).waitFor()
    pass('a blocked queue shows the setup issue after resuming')
    unwrap(await reading.evaluate(()=>window.workbench.setTranslationPaused(true)))
    setEngineDirectory(resolve(fixtureEngine))
    await reading.getByRole('button',{name:'继续队列',exact:true}).click()
  } else {
    const stamp=new Date().toISOString()
    await app.evaluate(({BrowserWindow},{id,stamp})=>{for(const w of BrowserWindow.getAllWindows())w.webContents.send('library:translation-progress',{paperId:id,stage:'正在翻译正文',percent:42,current:21,total:50,startedAt:stamp,updatedAt:stamp})},{id:data.papers[0].id,stamp})
  }
  await reading.locator('[role="progressbar"][aria-valuenow="42"]').waitFor()
  await reading.getByText('阶段进度 21 / 50',{exact:true}).waitFor()
  await rail.getByText('42%',{exact:true}).waitFor()
  await reading.waitForTimeout(700)
  await reading.screenshot({path:join(output,'reading-progress.png'),scale:'css'})
  await rail.screenshot({path:join(output,'rail-progress.png'),scale:'css'})
  pass('reading shows engine stage, percentage and completed items, synchronized with the rail')
  if (fixtureEngine) {
    await reading.getByRole('button',{name:'中英对照',exact:true}).waitFor()
    await reading.getByRole('progressbar',{name:'论文翻译进度'}).waitFor({state:'hidden'})
    pass('the desktop action queues, resumes and completes a job through the test engine process')
  }
  await rail.getByRole('button',{name:'打卡记录',exact:true}).click()
  const checkin=await pageWith('panel=checkin')
  await checkin.getByRole('progressbar',{name:'本周研究进度'}).waitFor()
  await checkin.waitForTimeout(700)
  await checkin.screenshot({path:join(output,'checkin.png'),scale:'css'})
  await checkin.getByRole('button',{name:'查看本周打卡'}).click()
  await checkin.waitForTimeout(400)
  await checkin.screenshot({path:join(output,'week.png'),scale:'css'})
  await checkin.getByRole('button',{name:'本月',exact:true}).click()
  await checkin.waitForTimeout(400)
  await checkin.screenshot({path:join(output,'month.png'),scale:'css'})
  await checkin.getByRole('button',{name:'关闭面板',exact:true}).click()
  await checkin.emulateMedia({reducedMotion:'reduce'})
  await checkin.getByRole('button',{name:'收起面板',exact:true}).click()
  const checkinVisible=()=>app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('panel=checkin'))?.isVisible())
  for(let i=0;i<20 && await checkinVisible();i++) {
    await new Promise(r=>setTimeout(r,50))
  }
  assert.equal(await checkinVisible(),false)
  await rail.getByRole('button',{name:'打卡记录',exact:true}).click()
  await checkin.waitForTimeout(250)
  assert.ok(await checkin.evaluate(()=>Number(getComputedStyle(document.querySelector('.desktop-header')).opacity)>.9))
  assert.ok(await checkin.getByRole('progressbar',{name:'本周研究进度'}).isVisible())
  pass('attendance rings, weekly/monthly pages and reduced-motion reopening remain usable')
  assert.deepEqual(errors,[])
  writeFileSync(join(output,'report.json'),JSON.stringify({checks,geometry,errors},null,2))
  if(process.argv.includes('--inspect')) {
    await app.evaluate(({BrowserWindow})=>{for(const w of BrowserWindow.getAllWindows()) {if(w.webContents.getURL().includes('index.html'))w.close();else if(w.webContents.getURL().includes('panel=checkin')){w.show();w.focus()}}})
    console.log('INSPECTION_READY')
    const native = await app.evaluate(async ({desktopCapturer,screen,BrowserWindow}) => {
      const window=BrowserWindow.getAllWindows().find(w=>w.getTitle()==='PhD 桌面打卡记录')
      window.setAlwaysOnTop(true);window.show();window.focus()
      await new Promise(r=>setTimeout(r,350))
      const display=screen.getDisplayMatching(window.getBounds())
      const sources=await desktopCapturer.getSources({types:['screen'],thumbnailSize:{width:Math.round(display.size.width*display.scaleFactor),height:Math.round(display.size.height*display.scaleFactor)}})
      const image=sources.find(s=>s.display_id===String(display.id))?.thumbnail ?? sources[0].thumbnail
      const b=window.getBounds(),ratio=image.getSize().width/display.bounds.width
      return image.crop({x:Math.max(0,Math.round((b.x-display.bounds.x-8)*ratio)),y:Math.max(0,Math.round((b.y-display.bounds.y-8)*ratio)),width:Math.round((b.width+16)*ratio),height:Math.round((b.height+16)*ratio)}).toPNG().toString('base64')
    })
    if(native) writeFileSync(join(output,'native-checkin.png'),Buffer.from(native,'base64'))
  }
} finally { await app.close();writeFileSync(join(output,'checks.json'),JSON.stringify({checks,errors},null,2)) }
