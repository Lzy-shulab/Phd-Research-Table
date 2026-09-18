import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'

// Read-only endpoint diagnostics in a disposable application profile.
const directory = resolve('test-results/2026-09-18-refinement/network')
mkdirSync(directory, { recursive: true })
const env = { ...process.env, WORKBENCH_DATA_DIR: join(directory, `data-${Date.now()}`), WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ executablePath: resolve('release/win-unpacked/PhD 科研工作台.exe'), args: [], env })
const results = []
try {
  await app.firstWindow()
  for (const host of ['export.arxiv.org', 'arxiv.org']) {
    const url = `https://${host}/api/query?${new URLSearchParams({ search_query: 'ti:"hyperspectral image"', start: '0', max_results: '1', sortBy: 'submittedDate', sortOrder: 'descending' })}`
    results.push(await app.evaluate(async ({ session }, url) => {
      const start = Date.now(), network = session.fromPartition('workbench-research-direct-probe')
      await network.setProxy({ mode: 'direct' })
      const proxy = await network.resolveProxy(url)
      try {
        const response = await network.fetch(url, { redirect: 'error', signal: AbortSignal.timeout(25000) })
        const text = await response.text()
        return { url, proxy, elapsed: Date.now() - start, status: response.status, bytes: text.length, atom: text.includes('<feed'), sample: text.slice(0, 180) }
      } catch (error) { return { url, proxy, elapsed: Date.now() - start, error: error.message } }
    }, url))
    console.log(JSON.stringify(results.at(-1)))
  }
} finally {
  await app.close()
  writeFileSync(join(directory, 'report.json'), JSON.stringify(results, null, 2))
}
