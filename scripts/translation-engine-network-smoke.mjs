import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const executablePath = resolve(process.env.WORKBENCH_TEST_EXECUTABLE || 'release/win-unpacked/PhD 科研工作台.exe')
const evidence = resolve('test-results/current/translation-engine-network')
const profile = resolve(evidence, `profile-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath, args: [], env })
try {
  await app.firstWindow()
  const source = await app.evaluate(async ({ session }) => {
    const url = 'https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/releases/download/v2.9.0/pdf2zh-v2.9.0-BabelDOC-v0.6.4-with-assets-win64.zip'
    const response = await session.fromPartition('workbench-translation-engine-network', { cache: false }).fetch(url, {
      method: 'HEAD', redirect: 'follow', headers: { Accept: 'application/octet-stream', 'User-Agent': 'PhD-Research-Workbench/translation-engine-network-smoke' },
      signal: AbortSignal.timeout(30_000)
    })
    return { status: response.status, finalUrl: response.url, contentLength: response.headers.get('content-length'), acceptRanges: response.headers.get('accept-ranges') }
  })
  assert.equal(source.status, 200)
  if (source.finalUrl) assert.ok(['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(new URL(source.finalUrl).hostname))
  if (source.contentLength) {
    const size = Number(source.contentLength)
    assert.ok(Number.isSafeInteger(size) && size > 500_000_000 && size < 750_000_000)
  }
  writeFileSync(resolve(evidence, 'report.json'), JSON.stringify({ executablePath, ...source }, null, 2))
  console.log('PASS Packaged Chromium session reached the pinned official PDF2zh asset without downloading its body')
  console.log(JSON.stringify(source, null, 2))
} finally { await app.close() }
