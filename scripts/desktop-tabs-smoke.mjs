import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'

const option = name => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const exe = option('executable')
const out = resolve(option('output') || 'test-results/desktop-tabs')
mkdirSync(out, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(out, `profile-${Date.now()}`), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1', ...(!exe ? { WORKBENCH_IDLE_TEST_MS: '12000' } : {}) }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve(exe || 'node_modules/electron/dist/electron.exe'), args: exe ? [] : ['.'], env })
app.context().setDefaultTimeout(15000)
const errors = [], checks = []
const pass = message => { checks.push(message); console.log('PASS', message) }
const unwrap = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.data }
const pageWith = async needle => {
  for (let i=0;i<150;i++) { const page = app.windows().find(p => p.url().includes(needle)); if(page) { page.on('pageerror',e=>errors.push(e.message)); return page } await new Promise(r=>setTimeout(r,100)) }
  throw Error('Missing page ' + needle)
}
const memory = () => app.evaluate(({app}) => { const metrics=app.getAppMetrics(); return { processes:metrics.length, workingSetMB:Math.round(metrics.reduce((n,p)=>n+p.memory.workingSetSize,0)/1024), privateMB:Math.round(metrics.reduce((n,p)=>n+(p.memory.privateBytes||0),0)/1024) } })
try {
  const rail = await pageWith('rail.html')
  await rail.getByRole('button',{name:'打卡记录',exact:true}).waitFor()
  assert.equal(app.windows().length,1)
  const idle = await memory()
  await rail.screenshot({path:join(out,'rail.png')})
  pass('startup creates only the lightweight rail')
  const fixture = new DatabaseSync(join(env.WORKBENCH_DATA_DIR,'workbench.sqlite'))
  const project = { id: randomUUID() }
  fixture.prepare('INSERT INTO projects(id,name,description,color_key,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(project.id,'多模态研究','隔离测试项目','blue',new Date().toISOString(),new Date().toISOString())
  fixture.close()
  await rail.getByRole('button',{name:'任务总览',exact:true}).click()
  let panel = await pageWith('panel=tasks')
  await panel.getByLabel('新任务',{exact:true}).fill('梳理今天的研究清单')
  await panel.getByRole('button',{name:'创建任务'}).click()
  await panel.getByText('梳理今天的研究清单',{exact:true}).waitFor()
  assert.equal(app.windows().length,2)
  let data=unwrap(await panel.evaluate(()=>window.workbench.desktopTasks()))
  assert.equal(data.tasks.length,1)
  await rail.waitForFunction(()=>document.querySelector('#task-status')?.textContent==='1 项')
  const id=data.tasks[0].id
  unwrap(await panel.evaluate(id=>window.workbench.updateTask(id,{priority:'high',checklist:[{id:crypto.randomUUID(),text:'确认实验优先级',completed:false},{id:crypto.randomUUID(),text:'补充需要跟进的细节',completed:false}]}),id))
  // Reopen to read the latest saved values without injecting renderer state.
  await panel.getByRole('button',{name:'收起面板',exact:true}).click()
  // Collapse retains the renderer and its draft; switch to a different page to refresh persisted fixture edits.
  await rail.getByRole('button',{name:'论文投稿',exact:true}).click()
  await pageWith('panel=submissions')
  await rail.getByRole('button',{name:'任务总览',exact:true}).click()
  panel=await pageWith('panel=tasks')
  await panel.getByText('确认实验优先级',{exact:true}).waitFor()
  await panel.getByRole('checkbox',{name:'确认实验优先级',exact:true}).check()
  await panel.getByRole('checkbox',{name:'完成 梳理今天的研究清单',exact:true}).check()
  await panel.waitForFunction(()=>document.querySelector('.desktop-task.is-done'))
  pass('task capture, checklist, completion persist through the shared repository')
  await rail.getByRole('button',{name:'PhD'}).click()
  const main=await pageWith('index.html')
  await main.getByRole('heading',{name:'今日计划',exact:true}).waitFor()
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('index.html')).minimize())
  await rail.getByRole('button',{name:'任务总览',exact:true}).click()
  unwrap(await main.evaluate(projectId=>window.workbench.createTask({title:'检查消融实验结果',projectId,scheduledDate:new Date().toLocaleDateString('en-CA'),priority:'medium'}),project.id))
  await panel.getByRole('tab',{name:'今天',exact:true}).click()
  await panel.getByText('检查消融实验结果',{exact:true}).waitFor()
  await panel.getByLabel('新任务',{exact:true}).fill('整理下次组会提纲')
  await panel.getByRole('button',{name:'创建任务'}).click()
  await main.getByText('整理下次组会提纲',{exact:true}).first().waitFor()
  pass('task edits sync in both directions while workbench and panel are open')
  unwrap(await main.evaluate(()=>window.workbench.createSubmission({title:'面向复杂场景的多模态表征学习',journal:'IEEE Transactions on Multimedia',manuscriptId:'TMM-2026-1042',stages:[{name:'已投稿',occurredOn:'2026-10-12'},{name:'大修',occurredOn:'2026-11-01'}],revisionDueDate:'2026-12-01',reminderEnabled:false,reminderDays:7,notes:'整理审稿意见，补充消融实验。'})))
  const full=await memory()
  const overview=unwrap(await rail.evaluate(()=>window.workbench.desktopOverview()))
  assert.equal(overview.submissions.active,1)
  assert.ok(overview.submissions.dueDays!==null)
  await panel.screenshot({path:join(out,'tasks.png')})
  await rail.getByRole('button',{name:'论文投稿',exact:true}).click()
  panel=await pageWith('panel=submissions')
  await panel.getByText('面向复杂场景的多模态表征学习',{exact:true}).click()
  const submissionBefore=unwrap(await main.evaluate(()=>window.workbench.submissionsSnapshot())).submissions[0]
  await panel.getByRole('button',{name:'标记返修完成',exact:true}).click()
  await panel.getByRole('button',{name:'重新打开返修',exact:true}).waitFor()
  assert.equal(unwrap(await main.evaluate(()=>window.workbench.submissionsSnapshot())).submissions[0].revisionCompleted,true)
  assert.deepEqual(unwrap(await main.evaluate(()=>window.workbench.submissionsSnapshot())).submissions[0].stages,submissionBefore.stages)
  await panel.screenshot({path:join(out,'submissions.png')})
  pass('submission stages and revision status share workbench data')
  await rail.getByRole('button',{name:'打卡记录',exact:true}).click()
  panel=await pageWith('panel=checkin')
  await panel.getByRole('button',{name:'填写打卡起止时间'}).click()
  await panel.getByLabel('开始时间',{exact:true}).fill('09:00')
  await panel.getByLabel('结束时间',{exact:true}).fill('12:00')
  await panel.getByRole('button',{name:'保存打卡',exact:true}).click()
  await panel.getByRole('status').filter({hasText:'已保存'}).waitFor()
  await rail.waitForFunction(()=>document.querySelector('#week-value')?.textContent!=='0%')
  const attendance=unwrap(await rail.evaluate(()=>window.workbench.desktopOverview())).attendance
  assert.equal(await rail.locator('#week-value').textContent(),Math.round(attendance.week)+'%')
  assert.equal(await rail.locator('#month-value').textContent(),Math.round(attendance.month)+'%')
  assert.equal(unwrap(await main.evaluate(()=>window.workbench.researchReport())).checkins.length,1)
  await panel.screenshot({path:join(out,'checkin-form.png')})
  await panel.getByRole('button',{name:'关闭面板',exact:true}).click()
  await panel.getByText('3小时',{exact:true}).first().waitFor()
  await panel.screenshot({path:join(out,'checkin.png')})
  await panel.getByRole('button',{name:'查看本周打卡'}).click()
  await panel.screenshot({path:join(out,'week.png')})
  await panel.getByRole('button',{name:'本月',exact:true}).click()
  await panel.screenshot({path:join(out,'month.png')})
  await panel.getByRole('button',{name:'关闭面板',exact:true}).click()
  pass('attendance creation and weekly/monthly views use existing records')
  for(const scale of [.6,1]) {
    unwrap(await panel.evaluate(scale=>window.workbench.updateWidgetPreferences({scale}),scale))
    await panel.waitForTimeout(200)
    const geometry=await panel.evaluate(()=>({overflow:document.documentElement.scrollWidth>innerWidth,rect:document.querySelector('.desktop-panel').getBoundingClientRect().toJSON(),width:innerWidth,height:innerHeight}))
    assert.equal(geometry.overflow,false)
    assert.ok(geometry.rect.bottom<=geometry.height+1)
    await panel.screenshot({path:join(out,`checkin-scale-${scale}.png`)})
  }
  pass('panel fits at minimum and full manual scale')
  if(!exe) {
    await panel.getByRole('button',{name:'填写打卡起止时间'}).click()
    await panel.getByLabel('打卡备注',{exact:true}).fill('尚未保存的输入')
    await panel.waitForTimeout(13500)
    assert.equal(panel.isClosed(),false)
    await panel.getByRole('button',{name:'关闭面板',exact:true}).click()
    await new Promise(resolve => setTimeout(resolve,15000))
    assert.equal(panel.isClosed(),true)
    // Closing the foreground panel may focus the workbench and restart its idle deadline.
    for(let i=0;i<160 && app.windows().length>1;i++) await new Promise(r=>setTimeout(r,100))
    assert.equal(app.windows().length,1)
    pass('idle release closes unused windows and retains an open editor; tested with isolated shortened deadline')
  }
  assert.deepEqual(errors,[])
  const after=await memory()
  writeFileSync(join(out,'report.json'),JSON.stringify({checks,errors,memory:{idle,full,after}},null,2))
  console.log('MEMORY',JSON.stringify({idle,full,after}))
} finally { await app.close(); writeFileSync(join(out,'checks.json'),JSON.stringify({checks,errors},null,2)) }
