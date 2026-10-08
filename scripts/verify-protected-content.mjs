import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { existsSync, readFileSync, readdirSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Hold the read-only baseline in memory; never write private rows or settings to evidence.
const evidence = resolve(process.argv[2] || 'test-results/protected-content')
mkdirSync(evidence, { recursive: true })
const locator = join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json')
const databasePath = JSON.parse(readFileSync(locator, 'utf8')).databasePath
const scanFiles = (directory, include) => existsSync(directory) ? readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const path = join(directory, entry.name)
  if (entry.isSymbolicLink()) return []
  return entry.isDirectory() ? scanFiles(path, include) : include(path) ? [path] : []
}) : []
function capture() {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('BEGIN')
    const integrity = db.prepare('PRAGMA integrity_check').all()
    assert.equal(integrity[0].integrity_check, 'ok')
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(({ name }) => ({
      name, rows: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort()
    }))
    const referenced = db.prepare('SELECT source_path, translated_path FROM papers').all().flatMap(row => [row.source_path, row.translated_path]).filter(Boolean)
    const paths = [...new Set([locator, ...referenced,
      ...scanFiles(resolve('工作台数据'), path => /\.pdf$/i.test(path)),
      ...scanFiles(join(dirname(locator), 'interface-backgrounds'), () => true)
    ])].sort()
    const files = paths.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : null }))
    db.exec('COMMIT')
    return { tables, files }
  } finally { db.close() }
}
const before = capture()
console.log(JSON.stringify({ state: 'baseline-ready', tables: before.tables.map(({ name, rows }) => ({ name, rows: rows.length })), referencedAndManagedFiles: before.files.length, integrity: 'ok' }))
const signal = join(evidence, 'compare-now')
const timer = setInterval(() => {
  if (!existsSync(signal)) return
  clearInterval(timer)
  try {
    const after = capture()
    assert.deepEqual(after.tables, before.tables, 'Database content changed')
    assert.deepEqual(after.files.map(file => file.path), before.files.map(file => file.path), 'Referenced file list changed')
    for (let index = 0; index < before.files.length; index++) {
      const a = before.files[index], b = after.files[index]
      assert.ok(a.bytes === null ? b.bytes === null : b.bytes !== null && a.bytes.equals(b.bytes), `File content changed: ${a.path}`)
    }
    const result = { state: 'verified', integrity: 'ok', tablesAndSettingsUnchanged: true, referencedFilesAndBackgroundsUnchanged: true, filesCompared: before.files.length }
    writeFileSync(join(evidence, 'result.json'), JSON.stringify(result, null, 2))
    console.log(JSON.stringify(result))
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}, 1000)
