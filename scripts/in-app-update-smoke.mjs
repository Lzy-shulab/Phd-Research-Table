import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { _electron as electron } from 'playwright'
import { cpSync, mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { extractFile, uncache } from '@electron/asar'

const evidence = resolve(`test-results/fixes-0.8.25/in-app-update-${Date.now()}`)
const application = join(evidence, 'application'), profile = join(evidence, 'data'), cache = join(evidence, 'cache')
mkdirSync(evidence, { recursive: true })
cpSync(resolve('release/win-unpacked'), application, { recursive: true })
await build({ entryPoints: ['src/main/update/service.ts'], outfile: join(evidence, 'service.mjs'), bundle: true, platform: 'node', format: 'esm' })
const { UpdateService } = await import(pathToFileURL(join(evidence, 'service.mjs')).href)
const executable = join(application, 'PhD 科研工作台.exe')
const oldVersion = JSON.parse(extractFile(join(application, 'resources/app.asar'), 'package.json').toString()).version
const manifest = JSON.parse(readFileSync('test-results/fixes-0.8.25/update-assets/latest-update.json', 'utf8'))
const packageAsset = manifest.assets.find(item => item.name.endsWith('-Update.zip'))
const bytes = readFileSync(join('test-results/fixes-0.8.25/update-assets', packageAsset.name))
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: executable, env })
let closed = false
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const saved = await page.evaluate(async () => {
    const project = await window.workbench.createProject({ name: '更新后保留的项目', colorKey: 'sage', description: '隔离更新验收' })
    if (!project.ok) throw new Error(project.error.message)
    const task = await window.workbench.createTask({ title: '更新后仍可继续的任务', projectId: project.data.id })
    if (!task.ok) throw new Error(task.error.message)
    return (await window.workbench.bootstrap()).data
  })
  const marker = join(application, 'user-document.txt'); writeFileSync(marker, 'keep alongside app')
  const fetcher = async input => String(input).includes('/releases/latest') ? new Response(JSON.stringify(manifest)) : new Response(bytes)
  const service = new UpdateService({ currentVersion: oldVersion, installable: true, cacheDirectory: cache,
    executablePath: executable, helperPath: resolve('resources/apply-update.ps1'), processId: app.process().pid,
    getWindow: () => null, fetcher,
    quit: () => { void app.close().then(() => { closed = true }) },
    launchHelper: async (script, args) => {
      const { spawn } = await import('node:child_process')
      const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, ...args, '-SkipRelaunch'],
        { windowsHide: true, stdio: 'ignore' })
      await new Promise((resolve, reject) => { child.once('spawn', () => { child.unref(); resolve() }); child.once('error', reject) })
      for (let attempt = 0; attempt < 120; attempt++) {
        if (existsSync(join(script, '..', 'prepared.json'))) return
        await delay(500)
      }
      throw new Error('Helper did not prepare while Electron was alive')
    }
  })
  assert.equal((await service.prepare()).state, 'ready')
  await service.install()
  let result
  for (let i = 0; i < 180; i++) {
    const resultPath = readdirSync(cache).map(name => join(cache, name, 'result.json')).find(existsSync)
    if (resultPath) { result = JSON.parse(readFileSync(resultPath, 'utf8').replace(/^\uFEFF/, '')); break }
    await delay(500)
  }
  assert.equal(result?.state, 'updated', JSON.stringify(result))
  assert.equal(readFileSync(marker, 'utf8'), 'keep alongside app')
  uncache(join(application, 'resources/app.asar'))
  const nextVersion = JSON.parse(extractFile(join(application, 'resources/app.asar'), 'package.json').toString()).version
  assert.equal(nextVersion, '0.8.25'); assert.equal(oldVersion, '0.8.24')
  const next = await electron.launch({ executablePath: executable, env })
  try {
    const nextPage = await next.firstWindow(); await nextPage.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    const after = await nextPage.evaluate(async () => (await window.workbench.bootstrap()).data)
    assert.deepEqual(after.projects, saved.projects); assert.deepEqual(after.tasks, saved.tasks)
  } finally { await next.close() }
  // Exercise the helper's automatic relaunch branch with a small harmless program fixture.
  const fixture = join(evidence, 'relaunch-fixture'), payload = join(evidence, 'relaunch-payload')
  mkdirSync(join(payload, 'resources'), { recursive: true }); mkdirSync(fixture, { recursive: true })
  writeFileSync(join(payload, 'App.cmd'), '@echo off\r\necho relaunched>"%~dp0relaunched.txt"\r\n')
  writeFileSync(join(payload, 'resources/app.asar'), 'fixture')
  const archive = join(evidence, 'relaunch.zip')
  const compressed = spawnSync('powershell.exe', ['-NoProfile', '-Command', `Compress-Archive -Path '${payload.replaceAll("'", "''")}\\*' -DestinationPath '${archive.replaceAll("'", "''")}'`], { windowsHide: true })
  assert.equal(compressed.status, 0)
  const helper = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', resolve('resources/apply-update.ps1'), '-TargetPid', '2147483647', '-ArchivePath', archive, '-InstallDirectory', fixture, '-ExecutableName', 'App.cmd'], { windowsHide: true })
  assert.equal(helper.status, 0)
  for (let i = 0; i < 40 && !existsSync(join(fixture, 'relaunched.txt')); i++) await delay(100)
  assert.ok(existsSync(join(fixture, 'relaunched.txt')))
  writeFileSync(join(evidence, 'results.json'), JSON.stringify({ oldVersion, nextVersion, files: result.files, recordsPreserved: true, unrelatedFilePreserved: true, automaticRelaunch: true }, null, 2))
  console.log('IN-APP UPDATE PASSED: 0.8.24 -> 0.8.25, program replacement, restart, saved projects/tasks and adjacent file retained')
} finally { if (!closed) await app.close().catch(() => {}) }
