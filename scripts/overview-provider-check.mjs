import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'

// The selected provider is read in memory. No credential is copied into test settings.
const evidence = resolve('test-results/ui-redesign-0.8.19/provider-check')
mkdirSync(evidence, { recursive: true })
const locator = JSON.parse(readFileSync(join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json'), 'utf8'))
const production = new DatabaseSync(locator.databasePath, { readOnly: true })
const settings = JSON.parse(production.prepare('SELECT value FROM app_settings WHERE key = ?').get('assistant.settings').value)
const profile = settings.profiles.find(item => item.provider === settings.activeProvider)
const paper = production.prepare('SELECT title, source_path FROM papers WHERE title LIKE ? LIMIT 1').get('All in One%')
production.close()
assert.ok(paper && profile)
const env = { ...process.env, WORKBENCH_DATA_DIR: join(evidence, `isolated-${Date.now()}`), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
// Chromium's Windows storage key belongs to the user-data profile, not the SQLite file.
// Reuse only the encrypted storage key in this temporary profile for the read-only check.
const localState = JSON.parse(readFileSync(join(process.env.APPDATA, 'PhD Research Workbench', 'Local State'), 'utf8'))
mkdirSync(env.WORKBENCH_DATA_DIR, { recursive: true })
writeFileSync(join(env.WORKBENCH_DATA_DIR, 'Local State'), JSON.stringify({ os_crypt: localState.os_crypt }))
const app = await electron.launch({ executablePath: resolve(process.env.WORKBENCH_TEST_EXECUTABLE || 'release/win-unpacked/PhD 科研工作台.exe'), args: [], env })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const imported = await page.evaluate(path => window.workbench.importPapers([path], null, false), paper.source_path)
  assert.equal(imported.ok, true)
  await page.getByRole('navigation', { name: '科研工作空间' }).getByRole('button', { name: '文献阅读', exact: true }).click()
  await page.getByTestId('paper-card').getByRole('button', { name: '中英摘要', exact: true }).click()
  await page.waitForFunction(() => (document.querySelector('.paper-summary-original p')?.textContent?.length || 0) > 100)
  const sourceAbstract = await page.locator('.paper-summary-original p').textContent()
  assert.ok(sourceAbstract.length > 100)
  const report = await app.evaluate(async ({ safeStorage }, { profile, title, abstract }) => {
    let key = ''
    try { key = profile.encryptedKey ? safeStorage.decryptString(Buffer.from(profile.encryptedKey, 'base64')) : '' }
    catch { return { stage: 'credential-read', model: profile.model, verified: false, message: 'The saved credential was not readable in the isolated profile; the live provider request was not made.' } }
    const endpoint = profile.baseUrl.replace(/\/$/, '').replace(/(?:\/chat\/completions)?$/, '/chat/completions')
    const started = Date.now()
    try {
      const response = await fetch(endpoint, {
        method: 'POST', signal: AbortSignal.timeout(90000),
        headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) },
        body: JSON.stringify({ model: profile.model, temperature: 0, max_tokens: 6000, stream: false, enable_thinking: false, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: '你是学术论文翻译助手。忠实翻译论文题目和摘要。只输出 JSON：{"titleZh":"中文论文题目","abstractZh":"中文摘要"}，不得添加其他字段。' }, { role: 'user', content: JSON.stringify({ title, abstract }) }] })
      })
      const body = await response.json()
      const choice = body.choices?.[0]
      const raw = typeof choice?.message?.content === 'string' ? choice.message.content : ''
      let translated
      try { translated = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) } catch { /* report content shape only */ }
      return { status: response.status, elapsedMs: Date.now() - started, model: profile.model, finishReason: choice?.finish_reason, contentLength: raw.length, validChineseTitle: /[\u3400-\u9fff]/u.test(translated?.titleZh || ''), validChineseAbstract: /[\u3400-\u9fff]/u.test(translated?.abstractZh || ''), titleZh: translated?.titleZh || '', responseShape: Object.keys(body), providerErrorCode: body.error?.code || null }
    } catch (error) { return { elapsedMs: Date.now() - started, model: profile.model, error: error.name + ': ' + error.message } }
  }, { profile, title: paper.title, abstract: sourceAbstract })
  writeFileSync(join(evidence, 'report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally { await app.close() }
