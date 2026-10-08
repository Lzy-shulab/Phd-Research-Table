import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

// Read-only credentials lookup; one synthetic abstract request. No production settings or papers are written.
const evidence = resolve('test-results/refinement-0.8.8/live-overview')
const profile = join(evidence, `isolated-data-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env })
try {
  const page = await app.firstWindow()
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const report = await app.evaluate(async ({ safeStorage }, sourceDirectory) => {
    const { readFileSync } = process.getBuiltinModule('node:fs')
    const { join } = process.getBuiltinModule('node:path')
    const { DatabaseSync } = process.getBuiltinModule('node:sqlite')
    const location = JSON.parse(readFileSync(join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json'), 'utf8'))
    const db = new DatabaseSync(location.databasePath, { readOnly: true })
    let saved
    try { saved = JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get('assistant.settings').value) } finally { db.close() }
    const active = saved.profiles.find(item => item.provider === saved.activeProvider)
    if (new URL(active.baseUrl).hostname !== 'api.siliconflow.cn' || active.model !== 'Qwen/Qwen3-8B') throw Error('This probe requires the currently configured SiliconFlow Qwen3-8B endpoint')
    let key
    try { key = safeStorage.decryptString(Buffer.from(active.encryptedKey, 'base64')) }
    catch { return { status: 'not_run', reason: 'The isolated Electron profile cannot decrypt the saved production credential. No API request was sent.' } }
    const source = readFileSync(join(sourceDirectory, 'src/main/assistant/service.ts'), 'utf8')
    const systemPrompt = source.match(/content: '(你是学术论文翻译助手。[^']+)'/)[1]
    const began = performance.now()
    const response = await fetch(active.baseUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(45000), headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify({ model: active.model, messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: JSON.stringify({ title: 'Hyperspectral image classification with spectral and spatial evidence', abstract: 'Hyperspectral images contain rich spectral information. This synthetic abstract verifies a candidate preview before collection. It contains no private data and makes no scientific claims. The original title and complete abstract should remain readable while a Chinese translation is being requested.' }) }], temperature: 0, max_tokens: 6000, stream: false, enable_thinking: false }) })
    const elapsedMs = Math.round(performance.now() - began)
    if (!response.ok) { await response.body?.cancel(); return { status: response.status, elapsedMs, model: active.model } }
    const body = await response.json(), message = body.choices?.[0]?.message
    const value = JSON.parse(message.content.replace(/^```(?:json)?\s*|\s*```$/g, ''))
    if (!value.titleZh || !value.abstractZh) throw Error('Missing translation fields')
    return { status: response.status, elapsedMs, model: active.model, enableThinking: false, usage: body.usage, reasoningCharacters: (message.reasoning_content ?? '').length, titleCharacters: value.titleZh.length, abstractCharacters: value.abstractZh.length }
  }, resolve('.'))
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  if (report.status === 'not_run') console.log('LIVE_OVERVIEW_NOT_RUN', report.reason)
  else {
    assert.equal(report.status, 200, JSON.stringify(report))
    assert.equal(report.reasoningCharacters, 0)
    console.log('LIVE_OVERVIEW', JSON.stringify(report))
  }
} finally { await app.close() }
