import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [beforePath, afterPath, outputPath] = process.argv.slice(2).map((path) => path && resolve(path))
if (!beforePath || !afterPath || !outputPath) throw Error('Provide before, after and report JSON paths')
const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))
const byName = (snapshot) => new Map(snapshot.tables.map((table) => [table.name, table]))
const beforeTables = byName(before), afterTables = byName(after)

assert.equal(after.databasePath, before.databasePath)
assert.deepEqual(after.storage, before.storage)
const beforeSettings = new Map(before.appSettings.map((entry) => [entry.key, entry.sha256]))
const afterSettings = new Map(after.appSettings.map((entry) => [entry.key, entry.sha256]))
assert.deepEqual([...afterSettings.keys()], [...beforeSettings.keys()])
const changedSettings = [...beforeSettings.keys()].filter((key) => beforeSettings.get(key) !== afterSettings.get(key))
assert.deepEqual(changedSettings, ['window'])
assert.deepEqual(after.locator, before.locator)
assert.deepEqual(after.files, before.files)
assert.deepEqual(after.managedPdfFiles, before.managedPdfFiles)
assert.deepEqual(after.wallpaperFiles, before.wallpaperFiles)
assert.deepEqual(after.integrity, [{ integrity_check: 'ok' }])
assert.deepEqual(after.foreignKeys, [])
assert.equal(after.translating, before.translating)
assert.equal(after.queued, before.queued)
assert.deepEqual([...afterTables.keys()], [...beforeTables.keys()])

for (const [name, previous] of beforeTables) {
  const current = afterTables.get(name)
  if (name === '__drizzle_migrations') {
    assert.equal(current.rows, previous.rows + 1)
    assert.deepEqual(current.columns, previous.columns)
  } else if (name === 'app_settings') {
    assert.equal(current.rows, previous.rows)
    assert.deepEqual(current.columns, previous.columns)
  } else if (name === 'papers') {
    assert.equal(current.rows, previous.rows)
    assert.deepEqual(current.columns, [...previous.columns, 'highlights'])
    assert.equal(current.legacySha256, previous.legacySha256)
  } else {
    assert.deepEqual(current, previous)
  }
}

const report = {
  before: beforePath,
  after: afterPath,
  verified: {
    existingTableRowsAndFieldsUnchanged: true,
    expectedMigrationAdded: true,
    paperHighlightsColumnAddedWithLegacyRowsUnchanged: true,
    settingsUnchangedExceptWindowState: true,
    windowStateRefreshedOnFormalLaunch: true,
    storageUnchanged: true,
    managedFilesAndWallpapersUnchanged: true,
    integrityOk: true,
    foreignKeysOk: true
  }
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.verified, null, 2))
