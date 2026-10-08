import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const executablePath = resolve(process.argv[2] || 'release/win-unpacked/PhD 科研工作台.exe')
const output = resolve(process.argv[3] || 'test-results/production-relaunch.json')
const env = {
  ...process.env,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE
delete env.WORKBENCH_DATA_DIR

async function launchAndRead() {
  const app = await electron.launch({ executablePath, args: [], env })
  try {
    const page = await app.firstWindow()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.locator('.app-shell').waitFor({ timeout: 60_000 })
    const version = (await page.locator('.version-badge').innerText()).trim()
    const snapshot = await page.evaluate(async () => {
      const workbench = await window.workbench.bootstrap()
      const library = await window.workbench.librarySnapshot()
      if (!workbench.ok) throw Error(workbench.error.message)
      if (!library.ok) throw Error(library.error.message)
      return {
        projects: workbench.data.projects.length,
        tasks: workbench.data.tasks.length,
        papers: library.data.papers.length,
        folders: library.data.folders.length,
        highlightsInitialized: library.data.papers.every((paper) => Array.isArray(paper.highlights))
      }
    })
    assert.equal(version, '0.8.6')
    assert.equal(snapshot.highlightsInitialized, true)
    assert.deepEqual(errors, [])
    return { version, ...snapshot, errors }
  } finally {
    await app.close()
  }
}

const first = await launchAndRead()
const second = await launchAndRead()
assert.deepEqual(second, first)
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, JSON.stringify({ executablePath, first, second, stableAcrossRelaunch: true }, null, 2))
console.log(JSON.stringify({ first, second, stableAcrossRelaunch: true, output }, null, 2))
