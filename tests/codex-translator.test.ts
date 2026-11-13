import { mkdirSync, mkdtempSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { startCodexTranslationBridge, codexTranslationLimits } from '../src/main/library/codex-translator'
import { setTimeout as delay } from 'node:timers/promises'

describe('Codex translation bridge', () => {
  it('batches concurrent paragraphs, preserves Unicode, and accepts a later batch', async () => {
    const root = resolve('test-results/codex-bridge'); mkdirSync(root, { recursive: true })
    const directory = mkdtempSync(join(root, 'batch-'))
    const batches: number[] = []
    const bridge = await startCodexTranslationBridge({ id: 'cli', name: 'CLI', provider: 'codex-cli', model: 'chosen-model',
      baseUrl: '', apiKey: '', reasoningEffort: 'high' }, directory, async tasks => {
      batches.push(tasks.length)
      return new Map(tasks.map(task => [task.id, '高光谱分类 <v1>公式</v1>']))
    })
    const request = async () => {
      const response = await fetch(bridge.profile.baseUrl + '/chat/completions', { method: 'POST',
        headers: { Authorization: `Bearer ${bridge.profile.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: 'Translate hyperspectral classification <v1>formula</v1>' }] }) })
      expect(response.status).toBe(200)
      return response.json()
    }
    try {
      const results = await Promise.all([request(), request(), request()])
      expect(results.every(result => result.choices[0].message.content === '高光谱分类 <v1>公式</v1>')).toBe(true)
      await request()
      expect(batches).toEqual([3, 1])
      expect(bridge.profile.model).toBe('codex-cli:chosen-model:high')
    } finally { await bridge.close() }
  })
  it('runs up to three independent batches together and returns each paragraph to its own request', async () => {
    const root = resolve('test-results/codex-bridge'); mkdirSync(root, { recursive: true })
    let active = 0, peak = 0
    const sizes: number[] = []
    const bridge = await startCodexTranslationBridge({ id: 'cli', name: 'CLI', provider: 'codex-cli', model: 'chosen-model', baseUrl: '', apiKey: '' },
      mkdtempSync(join(root, 'parallel-')), async tasks => {
        active++; peak = Math.max(peak, active); sizes.push(tasks.length)
        await delay(80)
        active--
        return new Map(tasks.map(task => [task.id, `译文 ${(task.messages[0] as { content: string }).content}`]))
      })
    try {
      const results = await Promise.all(Array.from({ length: 48 }, async (_, index) => {
        const response = await fetch(bridge.profile.baseUrl + '/chat/completions', { method: 'POST',
          headers: { Authorization: `Bearer ${bridge.profile.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: String(index) }] }) })
        const body = await response.json()
        expect(body.choices[0].message.content).toBe(`译文 ${index}`)
        return response.status
      }))
      expect(results.every(status => status === 200)).toBe(true)
      expect(peak).toBe(3)
      expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(48)
      expect(sizes.every(size => size <= 16)).toBe(true)
    } finally { await bridge.close() }
  })
  it('splits long paragraphs into smaller batches instead of overfilling a model request', async () => {
    const root = resolve('test-results/codex-bridge'); mkdirSync(root, { recursive: true })
    const lengths: number[] = []
    const bridge = await startCodexTranslationBridge({ id: 'cli', name: 'CLI', provider: 'codex-cli', model: '', baseUrl: '', apiKey: '' },
      mkdtempSync(join(root, 'long-')), async tasks => {
        lengths.push(tasks.reduce((sum, task) => sum + JSON.stringify(task.messages).length, 0))
        return new Map(tasks.map(task => [task.id, '完整译文']))
      })
    try {
      await Promise.all(Array.from({ length: 8 }, async () => {
        const response = await fetch(bridge.profile.baseUrl + '/chat/completions', { method: 'POST',
          headers: { Authorization: `Bearer ${bridge.profile.apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'a'.repeat(18000) }] }) })
        expect(response.status).toBe(200)
      }))
      expect(lengths.length).toBeGreaterThan(1)
      expect(lengths.every(length => length <= codexTranslationLimits.batchCharacters)).toBe(true)
    } finally { await bridge.close() }
  })
})
