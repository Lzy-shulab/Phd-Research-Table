import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '' } }))
import { applyTranslationProfileConfig } from '../src/main/library/translator'

const python = process.env.WORKBENCH_TRANSLATION_PYTHON
it.skipIf(!python || !existsSync(python))('loads the generated config in the installed engine and disables thinking in both API paths', () => {
  const directory = resolve('test-results/translation-engine-config', String(Date.now()))
  mkdirSync(directory, { recursive: true })
  const config = join(directory, 'translation.toml')
  const template = readFileSync(resolve('resources/pdf2zh-config.toml.example'), 'utf8')
  const output = applyTranslationProfileConfig(template, { id: 'test', name: 'Isolated probe', provider: 'siliconflow', model: 'Qwen/Qwen3-8B', baseUrl: 'https://example.test/v1', apiKey: 'fake-probe-key' })
  writeFileSync(config, output)
  const result = spawnSync(python!, [resolve('scripts/translation-request-probe.py'), config, resolve('tests/fixtures/translation-check.pdf')], {
    encoding: 'utf8', timeout: 60000, windowsHide: true, env: { ...process.env, PYTHONUTF8: '1' }
  })
  expect(result.status, result.stderr).toBe(0)
  const report = JSON.parse(result.stdout.trim())
  expect(report).toMatchObject({ bodyRequests: 2, enable_thinking: false, qps: 20, workers: 100, autoGlossary: false, cacheEnabled: true })
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2))
}, 65000)
