import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const output = resolve('test-results/translation-speed')
mkdirSync(output, { recursive: true })
const current = join(output, 'after.cjs')
await build({ entryPoints: ['src/main/library/codex-translator.ts'], outfile: current, bundle: true, platform: 'node', format: 'cjs', logLevel: 'silent' })
const modules = process.argv[2] ? [resolve(process.argv[2]), current] : [current]
const reports = []
for (const [index, module] of modules.entries()) {
  const directory = join(output, `dispatch-${index}`); mkdirSync(directory, { recursive: true })
  const { startCodexTranslationBridge } = createRequire(import.meta.url)(module)
  let active = 0, peak = 0, batches = 0
  const bridge = await startCodexTranslationBridge({ id: 'probe', name: 'Probe', provider: 'codex-cli', model: 'unchanged-model', baseUrl: '', apiKey: '' }, directory,
    async tasks => { active++; peak = Math.max(peak, active); batches++; await delay(100); active--; return new Map(tasks.map(task => [task.id, '完整译文'])) })
  const started = performance.now()
  try {
    await Promise.all(Array.from({ length: 96 }, async () => {
      const response = await fetch(bridge.profile.baseUrl + '/chat/completions', { method: 'POST', headers: { Authorization: `Bearer ${bridge.profile.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'A realistic scientific paragraph for the dispatch check.' }] }) })
      assert.equal(response.status, 200)
    }))
  } finally { await bridge.close() }
  reports.push({ implementation: index === modules.length - 1 ? 'current' : 'previous', paragraphs: 96, batches, maxConcurrentBatches: peak, elapsedMs: Math.round(performance.now() - started), measurement: 'Local scheduler simulation, not model response time' })
}
assert.equal(reports.at(-1).maxConcurrentBatches, 3)
writeFileSync(join(output, 'dispatch-report.json'), JSON.stringify(reports, null, 2))
console.log(JSON.stringify(reports))
