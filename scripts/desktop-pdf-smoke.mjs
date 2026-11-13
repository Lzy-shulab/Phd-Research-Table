import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { resolve } from 'node:path'
const profile=resolve('test-results/desktop-pdf',`profile-${Date.now()}`)
const env={...process.env,WORKBENCH_DATA_DIR:profile,WORKBENCH_DISABLE_ARXIV_AUTO:'1',WORKBENCH_DISABLE_METADATA_AUTO:'1',WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO:'1',WORKBENCH_DISABLE_NOTIFICATIONS:'1'}
delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath:resolve(process.argv[2]),args:['--workbench'],env})
const unwrap=r=>{assert.equal(r.ok,true,JSON.stringify(r));return r.data}
try {
  let main
  for(let i=0;i<100;i++){ main=app.windows().find(p=>p.url().includes('index.html')); if(main)break; await new Promise(r=>setTimeout(r,100)) }
  assert.ok(main)
  await main.getByRole('heading',{name:'今日计划',exact:true}).waitFor()
  const report=unwrap(await main.evaluate(file=>window.workbench.importPapers([file],null,false),resolve('tests/fixtures/translation-check.pdf')))
  assert.equal(report.added,1)
  const library=unwrap(await main.evaluate(()=>window.workbench.librarySnapshot()))
  const bytes=unwrap(await main.evaluate(id=>window.workbench.readPaper(id,'source'),library.papers[0].id))
  assert.ok(bytes.length>100)
  await main.getByRole('navigation',{name:'科研工作空间'}).getByRole('button',{name:'文献阅读',exact:true}).click()
  await main.getByText(library.papers[0].title,{exact:true}).first().waitFor()
  console.log('PASS packaged PDF import, byte reading, and literature workspace')
  console.log('IMPORTED',library.papers[0].title,bytes.length)
} finally { await app.close() }
