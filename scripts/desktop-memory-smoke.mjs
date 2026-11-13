import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
const executablePath=resolve(process.argv[2])
const output=resolve(process.argv[3] || 'test-results/desktop-memory')
mkdirSync(output,{recursive:true})
const env={...process.env,WORKBENCH_DATA_DIR:join(output,`profile-${Date.now()}`),WORKBENCH_DISABLE_ARXIV_AUTO:'1',WORKBENCH_DISABLE_METADATA_AUTO:'1',WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO:'1',WORKBENCH_DISABLE_NOTIFICATIONS:'1'}
delete env.ELECTRON_RUN_AS_NODE
const app=await electron.launch({executablePath,args:[],env})
try {
  await app.firstWindow()
  await new Promise(r=>setTimeout(r,4000))
  const result=await app.evaluate(({app,BrowserWindow})=>({version:app.getVersion(),windows:BrowserWindow.getAllWindows().map(w=>w.getTitle()),processes:app.getAppMetrics().map(p=>({type:p.type,workingSetMB:p.memory.workingSetSize/1024,privateMB:(p.memory.privateBytes||0)/1024}))}))
  result.totalPrivateMB=Math.round(result.processes.reduce((sum,p)=>sum+p.privateMB,0))
  result.totalWorkingSetMB=Math.round(result.processes.reduce((sum,p)=>sum+p.workingSetMB,0))
  writeFileSync(join(output,'report.json'),JSON.stringify(result,null,2))
  console.log(JSON.stringify(result))
} finally { await app.close() }
