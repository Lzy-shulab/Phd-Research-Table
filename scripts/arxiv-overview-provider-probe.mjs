import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { createServer } from 'node:http'
import { readFileSync, mkdirSync, writeFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { waitForAsync } from './test-helpers.mjs'

// Read the configured provider and public candidate abstracts without changing user data.
// Credentials stay in memory and never enter the report.
const evidence = resolve('test-results/arxiv-fix-0.8.20/provider')
mkdirSync(evidence, { recursive: true })
const profileDirectory = join(process.env.APPDATA, 'PhD Research Workbench')
const location = JSON.parse(readFileSync(join(profileDirectory, 'workspace-location.json'), 'utf8'))
const db = new DatabaseSync(location.databasePath, { readOnly: true })
let profile, candidates
try {
  const setting = key => JSON.parse(db.prepare('SELECT value FROM app_settings WHERE key=?').get(key).value)
  const settings = setting('assistant.settings')
  profile = settings.profiles.find(item => item.provider === settings.activeProvider)
  candidates = setting('arxiv.candidates.v1').filter(item => !item.ignored && !item.overview)
} finally { db.close() }
assert.ok(profile && candidates.length)
assert.equal(new URL(profile.baseUrl).hostname, 'api.siliconflow.cn')
// A completed PDF translation job contains the user's provider configuration.
// This checks the same service/model; it does not claim to validate the assistant's encrypted credential.
const scan = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
  ? scan(join(directory, entry.name)) : entry.name === 'translation.toml' ? [join(directory, entry.name)] : [])
const jobs = ['工作台数据/文献', '工作台数据/Arxiv Daily'].flatMap(scan).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
let apiKey = ''
for (const job of jobs) {
  const config = readFileSync(job, 'utf8')
  const field = name => config.match(new RegExp(`^${name}\\s*=\\s*"([^"\\r\\n]*)"`, 'm'))?.[1] ?? ''
  if (field('siliconflow_model') === profile.model && field('siliconflow_base_url').includes('api.siliconflow.cn')) {
    apiKey = field('siliconflow_api_key')
    if (apiKey) break
  }
}
assert.ok(apiKey, 'No matching existing translation-job credential; no provider request was made')
const source = readFileSync(resolve('src/main/assistant/service.ts'), 'utf8')
const prompt = source.match(/content: '(你是学术论文翻译助手。[^']+)'/)[1]
const reports = []
if (process.env.PROBE_WORKFLOW === '1') {
  let requests = 0, responseKeys
  const server = createServer(async (request, response) => {
    try {
      let raw = ''; for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      requests++
      assert.equal(body.model, profile.model)
      assert.deepEqual(JSON.parse(body.messages[1].content), { title: candidates[0].title, abstract: candidates[0].abstract })
      const result = await fetch(profile.baseUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ ...body, enable_thinking: false, response_format: { type: 'json_object' } }) })
      const text = await result.text()
      assert.equal(result.status, 200)
      responseKeys = Object.keys(JSON.parse(JSON.parse(text).choices[0].message.content))
      response.writeHead(result.status, { 'Content-Type': 'application/json' }); response.end(text)
    } catch (error) { response.writeHead(502); response.end('Provider probe failed'); console.error(error.name) }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const isolated = join(evidence, `workflow-${Date.now()}`)
  const env = { ...process.env, WORKBENCH_DATA_DIR: isolated, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
  delete env.ELECTRON_RUN_AS_NODE
  let app
  const launch = () => electron.launch(process.env.WORKBENCH_TEST_EXECUTABLE
    ? { executablePath: resolve(process.env.WORKBENCH_TEST_EXECUTABLE), args: [], env } : { args: ['.'], env })
  try {
    app = await launch()
    let page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
    await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    const saved = await page.evaluate(({ model, baseUrl }) => window.workbench.saveAssistantSettings({ provider: 'custom', model, baseUrl }), { model: profile.model, baseUrl: `http://127.0.0.1:${server.address().port}/v1` })
    assert.equal(saved.ok, true)
    const boot = await page.evaluate(() => window.workbench.bootstrap())
    assert.equal(boot.ok, true)
    await app.close(); app = undefined
    const isolatedDb = new DatabaseSync(boot.data.databasePath)
    const candidate = { ...candidates[0], overview: undefined, translationState: 'failed', translationError: 'AI 未返回完整的中文题目和中文摘要，请重试。' }
    isolatedDb.prepare('INSERT INTO app_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('arxiv.candidates.v1', JSON.stringify([candidate]))
    isolatedDb.close()
    app = await launch()
    page = await app.firstWindow()
    await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.setContentSize(1400, 900); win.webContents.setBackgroundThrottling(false); win.hide() })
    await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
    await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
    await page.getByRole('navigation', { name: '文献文件夹' }).getByRole('button', { name: /Arxiv Daily/ }).click()
    await waitForAsync(page, async () => { const value = await window.workbench.librarySnapshot(); return value.ok && !value.data.arxiv.running && value.data.arxiv.preparation.pending === 0 }, undefined, 60000)
    const snapshot = await page.evaluate(() => window.workbench.librarySnapshot())
    assert.equal(snapshot.ok, true)
    assert.deepEqual(snapshot.data.arxiv.preparation, { ready: 1, pending: 0, failed: 0, error: '' })
    assert.match(snapshot.data.arxiv.candidates[0].overview.titleZh, /[\u3400-\u9fff]/u)
    assert.match(snapshot.data.arxiv.candidates[0].overview.abstractZh, /[\u3400-\u9fff]/u)
    assert.equal(requests, 1)
    await page.locator('.arxiv-candidate-list article').waitFor()
    await page.screenshot({ path: join(evidence, 'workflow-success.png'), animations: 'disabled' })
    const report = { version: '0.8.20', id: candidate.id, model: profile.model, credentialSource: 'existing PDF translation job', responseKeys, requests, preparation: snapshot.data.arxiv.preparation,
      chineseTitle: snapshot.data.arxiv.candidates[0].overview.titleZh, chineseAbstractLength: snapshot.data.arxiv.candidates[0].overview.abstractZh.length }
    writeFileSync(join(evidence, 'workflow-report.json'), JSON.stringify(report, null, 2))
    console.log('LIVE_ARXIV_WORKFLOW', JSON.stringify(report))
  } finally { if (app) await app.close(); await new Promise(resolve => server.close(resolve)) }
} else {
for (const candidate of candidates) {
  for (let attempt = 1; attempt <= Number(process.env.PROBE_ATTEMPTS || 2); attempt++) {
    const started = Date.now()
    const response = await fetch(profile.baseUrl, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(90000),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: profile.model, messages: [{ role: 'system', content: prompt }, { role: 'user', content: JSON.stringify({ title: candidate.title, abstract: candidate.abstract }) }],
        temperature: 0, max_tokens: 6000, stream: false, enable_thinking: false, response_format: { type: 'json_object' } }) })
    const body = await response.json()
    const choice = body.choices?.[0], raw = choice?.message?.content ?? ''
    let value, parseError = ''
    try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
    catch (error) { parseError = error.message }
    const report = { id: candidate.id, attempt, status: response.status, elapsedMs: Date.now() - started, model: profile.model,
      credentialSource: 'existing PDF translation job', finishReason: choice?.finish_reason, contentLength: raw.length, reasoningLength: choice?.message?.reasoning_content?.length ?? 0,
      keys: value && Object.keys(value), titleType: typeof value?.titleZh, abstractType: typeof value?.abstractZh,
      validChineseTitle: /[\u3400-\u9fff]/u.test(value?.titleZh || ''), validChineseAbstract: /[\u3400-\u9fff]/u.test(value?.abstractZh || ''),
      parseError, content: raw }
    reports.push(report)
    writeFileSync(join(evidence, 'report.json'), JSON.stringify(reports, null, 2))
    console.log(JSON.stringify({ ...report, content: raw.slice(0, 240) }))
  }
}
}
