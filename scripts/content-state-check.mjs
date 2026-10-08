import assert from 'node:assert/strict'
import { DatabaseSync } from 'node:sqlite'
import { readFileSync, readdirSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline'

// Keep the baseline in memory; only aggregate comparison results are written.
const locator = join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json')
const databasePath = JSON.parse(readFileSync(locator, 'utf8')).databasePath
function capture() {
  const db = new DatabaseSync(databasePath, { readOnly: true })
  try {
    db.exec('BEGIN')
    const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row => row.name)
    const rows = names.map(name => ({ name, values: db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all().map(row => JSON.stringify(row)).sort() }))
    const referenced = db.prepare('SELECT source_path, translated_path FROM papers').all().flatMap(row => [row.source_path, row.translated_path]).filter(Boolean)
    const scan = path => !existsSync(path) ? [] : readdirSync(path, { withFileTypes: true }).flatMap(entry => {
      const file = join(path, entry.name)
      return entry.isDirectory() ? scan(file) : entry.isFile() ? [file] : []
    })
    const paths = [...new Set([locator, ...referenced, ...scan(resolve('工作台数据')).filter(path => /\.pdf$/i.test(path)), ...scan(join(dirname(locator), 'interface-backgrounds'))])].sort()
    const files = paths.map(path => ({ path, bytes: existsSync(path) ? readFileSync(path) : null }))
    assert.deepEqual(db.prepare('PRAGMA integrity_check').all().map(row => Object.values(row)[0]), ['ok'])
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), [])
    db.exec('COMMIT')
    return { rows, files }
  } finally { db.close() }
}
const baseline = capture()
console.log(JSON.stringify({ ready: true, tables: baseline.rows.map(row => ({ name: row.name, count: row.values.length })), checkedFiles: baseline.files.length }))
const input = createInterface({ input: process.stdin, terminal: false })
input.on('line', command => {
  if (command.trim() !== 'compare') return
  try {
    const current = capture()
    assert.deepEqual(current.rows, baseline.rows, 'Database records or settings changed')
    assert.deepEqual(current.files.map(file => file.path), baseline.files.map(file => file.path), 'Referenced files changed')
    current.files.forEach((file, index) => {
      const prior = baseline.files[index].bytes
      assert.ok(file.bytes === null ? prior === null : prior !== null && file.bytes.equals(prior), 'File contents changed: ' + file.path)
    })
    const report = { recordsUnchanged: true, settingsUnchanged: true, fileContentsUnchanged: true, integrity: 'ok', checkedFiles: current.files.length }
    mkdirSync('test-results/content-state', { recursive: true })
    writeFileSync('test-results/content-state/result.json', JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report))
    input.close()
  } catch (error) { console.error(error.message); process.exitCode = 1; input.close() }
})
