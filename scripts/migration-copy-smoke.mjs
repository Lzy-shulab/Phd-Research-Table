import assert from 'node:assert/strict'
import { _electron as electron } from 'playwright'
import { DatabaseSync } from 'node:sqlite'
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { createHash } from 'node:crypto'

const source = resolve(process.env.WORKBENCH_MIGRATION_SOURCE || '工作台数据/数据库/workbench.sqlite')
assert.ok(existsSync(source), `Database not found: ${source}`)
const directory = resolve('test-results', `formal-copy-migration-${Date.now()}`), profile = resolve(directory, 'isolated-profile')
mkdirSync(profile, { recursive: true })
const target = resolve(profile, 'workbench.sqlite')
for (const suffix of ['', '-wal', '-shm']) if (existsSync(source + suffix)) copyFileSync(source + suffix, target + suffix)
const digest = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
const snapshot = (path, originalColumns) => {
  const db = new DatabaseSync(path, { readOnly: true })
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
    const records = Object.fromEntries(tables.map((table) => {
      const available = db.prepare(`PRAGMA table_info("${table}")`).all().map((column) => column.name)
      const columns = originalColumns?.[table] ?? available
      const rows = db.prepare(`SELECT ${columns.map((column) => `"${column}"`).join(',')} FROM "${table}"${table === 'app_settings' ? " WHERE key <> 'window'" : ''} ORDER BY 1`).all()
      return [table, { columns, rows: rows.length, sha256: digest(rows) }]
    }))
    return { records, integrity: db.prepare('PRAGMA integrity_check').all(), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() }
  } finally { db.close() }
}
const before = snapshot(target)
const env = { ...process.env, WORKBENCH_DATA_DIR: profile, WORKBENCH_DISABLE_ARXIV_AUTO: '1', WORKBENCH_DISABLE_METADATA_AUTO: '1', WORKBENCH_DISABLE_ENCOURAGEMENT_AUTO: '1', WORKBENCH_DISABLE_NOTIFICATIONS: '1' }
delete env.ELECTRON_RUN_AS_NODE
const app = await electron.launch({ args: ['.'], env, timeout: 30000 })
try {
  const page = await app.firstWindow()
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].hide())
  await page.getByRole('heading', { name: '今日计划', exact: true }).waitFor()
  const boot = await page.evaluate(() => window.workbench.bootstrap())
  assert.equal(boot.ok, true)
  assert.equal(resolve(boot.data.databasePath), target)
} finally { await app.close() }
const originalColumns = Object.fromEntries(Object.entries(before.records).map(([table, value]) => [table, value.columns]))
const after = snapshot(target, originalColumns)
for (const [table, value] of Object.entries(before.records)) {
  if (table === '__drizzle_migrations') continue
  assert.equal(after.records[table].rows, value.rows, `${table} row count changed`)
  assert.equal(after.records[table].sha256, value.sha256, `${table} original columns changed`)
}
assert.equal(after.integrity.length, 1)
assert.equal(after.integrity[0].integrity_check, 'ok')
assert.deepEqual(after.foreignKeys, [])
const migrated = new DatabaseSync(target, { readOnly: true })
const migrations = migrated.prepare('SELECT count(*) AS count FROM __drizzle_migrations').get().count
const addedColumns = {
  tasks: migrated.prepare('PRAGMA table_info(tasks)').all().map((column) => column.name).filter((name) => ['deferred_until', 'series_id', 'checklist', 'linked_paper_id'].includes(name)),
  papers: migrated.prepare('PRAGMA table_info(papers)').all().map((column) => column.name).filter((name) => ['max_read_page', 'reading_status', 'excerpts', 'translation_order'].includes(name)),
  submissions: migrated.prepare('PRAGMA table_info(submissions)').all().map((column) => column.name).filter((name) => ['revision_completed', 'ended', 'review_items', 'manuscript_group_id'].includes(name))
}
migrated.close()
assert.equal(migrations, 7)
assert.deepEqual(Object.values(addedColumns).map((items) => items.length), [4, 4, 4])
const report = { source: basename(source), target, migrations, addedColumns, before: Object.fromEntries(Object.entries(before.records).map(([table, value]) => [table, value.rows])), after: Object.fromEntries(Object.entries(after.records).map(([table, value]) => [table, value.rows])), integrity: after.integrity, foreignKeys: after.foreignKeys }
writeFileSync(resolve(directory, 'report.json'), JSON.stringify(report, null, 2))
console.log('PASS Formal database copy migrated with all original-column hashes and row counts unchanged')
console.log(JSON.stringify(report, null, 2))
