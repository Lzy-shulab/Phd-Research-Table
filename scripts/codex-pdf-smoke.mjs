import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { execFile } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3)
const output = resolve(option('output') || 'test-results/codex-pdf-live')
const workspace = resolve('.')
mkdirSync(output, { recursive: true })
const source = join(output, 'source.pdf'), runtime = join(output, 'translator.cjs'), main = join(output, 'main.cjs')
copyFileSync(resolve('tests/fixtures/translation-check.pdf'), source)
await build({ entryPoints: ['src/main/library/translator.ts'], outfile: runtime, platform: 'node', format: 'cjs', bundle: true, external: ['electron'], logLevel: 'silent' })
const job = { directory: option('engine') || 'D:/Python/zotero-pdf2zh/server', source, output: join(output, 'job'),
  profile: { id: 'live-codex', name: 'Local Codex CLI', provider: 'codex-cli', model: option('model') || '',
    reasoningEffort: option('effort') || 'default', baseUrl: '', apiKey: '' } }
writeFileSync(main, `const {app}=require('electron');
app.setPath('userData',process.env.WORKBENCH_DATA_DIR);
app.getAppPath=()=>${JSON.stringify(workspace)};
app.whenReady().then(async()=>{try{const {runTranslation}=require(${JSON.stringify(runtime)});
const job=${JSON.stringify(job)};
const output=await runTranslation(job.directory,job.source,job.output,job.profile,child=>{child.stderr.on('data',chunk=>require('node:fs').appendFileSync(${JSON.stringify(join(output, 'engine.log'))},chunk));},progress=>console.log(JSON.stringify({progress:progress.stage,percent:progress.percent})));
require('node:fs').writeFileSync(${JSON.stringify(join(output, 'result.json'))},JSON.stringify({output,model:job.profile.model,effort:job.profile.reasoningEffort}));console.log('BILINGUAL_PDF_READY');
}catch(error){console.error(error.message);app.exit(1);}finally{app.quit();}});`)
const env = { ...process.env, WORKBENCH_DATA_DIR: join(output, 'profile') }
delete env.ELECTRON_RUN_AS_NODE
const original = readFileSync(source)
await new Promise((resolveRun, reject) => {
  const child = execFile(resolve('node_modules/electron/dist/electron.exe'), [main], { env, windowsHide: true, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 }, error => error ? reject(error) : resolveRun())
  child.stdout.on('data', chunk => process.stdout.write(chunk))
  child.stderr.on('data', chunk => process.stderr.write(chunk))
})
const result = JSON.parse(readFileSync(join(output, 'result.json'), 'utf8'))
assert.ok(existsSync(result.output))
assert.ok(readFileSync(result.output).subarray(0, 5).toString() === '%PDF-')
assert.ok(readFileSync(source).equals(original))
console.log(JSON.stringify({ bilingualPdf: result.output, originalUnchanged: true, model: result.model || 'CLI default', effort: result.effort }))
