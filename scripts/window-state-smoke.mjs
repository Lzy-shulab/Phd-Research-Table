import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { _electron as electron } from 'playwright'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const executablePath = process.env.WORKBENCH_TEST_EXECUTABLE
const evidence = resolve('test-results', `window-state-${Date.now()}`)
const profile = join(evidence, 'isolated-data')
mkdirSync(profile, { recursive: true })
const env = {
  ...process.env,
  WORKBENCH_DATA_DIR: profile,
  WORKBENCH_DISABLE_ARXIV_AUTO: '1',
  WORKBENCH_DISABLE_METADATA_AUTO: '1',
  WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1',
  WORKBENCH_DISABLE_NOTIFICATIONS: '1'
}
delete env.ELECTRON_RUN_AS_NODE

const launches = []
for (let index = 0; index < 3; index++) {
  const app = await electron.launch(executablePath ? { executablePath: resolve(executablePath), args: [], env } : { args: ['.'], env })
  const page = await app.firstWindow()
  await page.locator('.app-shell').waitFor()
  const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getNormalBounds())
  const closed = new Promise((done) => app.once('close', done))
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
  await closed
  const db = new DatabaseSync(join(profile, 'workbench.sqlite'), { readOnly: true })
  const persisted = JSON.parse(db.prepare("SELECT value FROM app_settings WHERE key = 'window'").get().value)
  db.close()
  launches.push({ bounds, persisted })
}

assert.deepEqual(launches[1].persisted, launches[0].persisted)
assert.deepEqual(launches[2].persisted, launches[0].persisted)
assert.deepEqual(launches[2].bounds, launches[1].bounds)
writeFileSync(join(evidence, 'report.json'), JSON.stringify({ executablePath: executablePath ? resolve(executablePath) : 'development', launches, stable: true }, null, 2))
console.log('PASS Window geometry persistence remains stable across repeated launches', evidence)
