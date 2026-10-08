import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [beforePath, afterPath, outputPath] = process.argv.slice(2).map((path) => path && resolve(path))
if (!beforePath || !afterPath || !outputPath) throw Error('Provide before, after and report JSON paths')
const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))
const tablesWithoutSettings = (snapshot) => snapshot.tables.filter((table) => table.name !== 'app_settings')
const settingsWithoutWindow = (snapshot) => snapshot.appSettings.filter((entry) => entry.key !== 'window')

assert.equal(after.databasePath, before.databasePath)
assert.deepEqual(tablesWithoutSettings(after), tablesWithoutSettings(before))
const beforeSettingsTable = before.tables.find((table) => table.name === 'app_settings')
const afterSettingsTable = after.tables.find((table) => table.name === 'app_settings')
assert.equal(afterSettingsTable.rows, beforeSettingsTable.rows)
assert.deepEqual(afterSettingsTable.columns, beforeSettingsTable.columns)
assert.deepEqual(settingsWithoutWindow(after), settingsWithoutWindow(before))
assert.deepEqual(after.storage, before.storage)
assert.deepEqual(after.locator, before.locator)
assert.deepEqual(after.files, before.files)
assert.deepEqual(after.managedPdfFiles, before.managedPdfFiles)
assert.deepEqual(after.wallpaperFiles, before.wallpaperFiles)
assert.deepEqual(after.integrity, [{ integrity_check: 'ok' }])
assert.deepEqual(after.foreignKeys, [])
assert.equal(after.translating, before.translating)
assert.equal(after.queued, before.queued)

const report = {
  before: beforePath,
  after: afterPath,
  verified: {
    businessTablesAndRowsUnchanged: true,
    settingsUnchangedExceptWindowState: true,
    storageAndManagedFilesUnchanged: true,
    wallpapersAndLocatorUnchanged: true,
    integrityOk: true,
    foreignKeysOk: true
  }
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.verified, null, 2))
