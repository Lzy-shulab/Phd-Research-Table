import { DatabaseSync } from 'node:sqlite'
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import assert from 'node:assert/strict'

// Hold the baseline in memory; only aggregate results are written to the evidence file.
const evidence = resolve(process.argv[2] || 'test-results/release-data')
mkdirSync(evidence, { recursive: true })
const locator = join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json')
const databasePath = JSON.parse(readFileSync(locator, 'utf8')).databasePath
function database() {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('BEGIN')
    assert.equal(db.prepare('PRAGMA integrity_check').get().integrity_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    return Object.fromEntries(names.map(name => [name, db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()]))
  } finally { db.close() }
}
const before = database()
const files = new Set([locator])
function collect(directory) {
  if (!existsSync(directory)) return
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) collect(path)
    else if (/\.(pdf|png|jpe?g|webp|json|md|txt)$/i.test(entry.name)) files.add(path)
  }
}
collect(resolve('工作台数据'))
collect(join(dirname(locator), 'interface-backgrounds'))
for (const rows of Object.values(before)) for (const row of rows) {
  for (const [key, value] of Object.entries(row)) {
    if (typeof value === 'string' && /(?:^|_)path$/.test(key) && existsSync(value) && statSync(value).isFile()) files.add(value)
  }
}
const bytes = new Map([...files].map(path => [path, readFileSync(path)]))
console.log('BASELINE_READY', JSON.stringify({ tables: Object.fromEntries(Object.entries(before).map(([name, rows]) => [name, rows.length])), files: files.size }))
const timer = setInterval(() => {
  if (!existsSync(join(evidence, 'compare.signal'))) return
  clearInterval(timer)
  try {
    assert.deepEqual(database(), before, 'Stored records and individual settings changed')
    for (const [path, original] of bytes) {
      assert.equal(statSync(path).size, original.length, 'Referenced file size changed')
      assert.ok(readFileSync(path).equals(original), 'Referenced file content changed')
    }
    const result = { integrity: 'ok', recordsUnchanged: true, settingsUnchanged: true, fileContentsUnchanged: true, checkedFiles: files.size }
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
    console.log('DATA_COMPARISON_OK', JSON.stringify(result))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}, 1000)
