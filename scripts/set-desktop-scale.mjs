// Applies an explicitly requested display preference through the application's normal API.
import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { resolve } from 'node:path'
const scale=Number(process.argv[3])
assert.ok(scale>=.6 && scale<=1,'Scale must be between 0.6 and 1')
const env={...process.env}
delete env.ELECTRON_RUN_AS_NODE
delete env.WORKBENCH_DATA_DIR
const app=await electron.launch({executablePath:resolve(process.argv[2]),args:[],env})
try {
  let rail
  for(let i=0;i<100;i++){rail=app.windows().find(p=>p.url().includes('rail.html'));if(rail)break;await new Promise(r=>setTimeout(r,100))}
  assert.ok(rail,'Desktop rail must be available')
  const result=await rail.evaluate(scale=>window.workbench.updateWidgetPreferences({scale}),scale)
  assert.equal(result.ok,true)
  console.log('Desktop scale applied:',result.data.preferences.scale)
} finally {await app.close()}
