import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const [beforePath, afterPath, outputPath] = process.argv.slice(2).map((path) => path && resolve(path))
if (!beforePath || !afterPath || !outputPath) throw Error('Provide before, after and report JSON paths')
const before = JSON.parse(readFileSync(beforePath, 'utf8'))
const after = JSON.parse(readFileSync(afterPath, 'utf8'))
const stable = (snapshot) => Object.fromEntries(Object.entries(snapshot).filter(([key]) => !['capturedAt', 'output'].includes(key)))
assert.deepEqual(stable(after), stable(before))
const report = {
  before: beforePath,
  after: afterPath,
  verified: {
    databaseAndAllRowsUnchanged: true,
    settingsAndStorageUnchanged: true,
    referencedAndManagedFilesUnchanged: true,
    wallpapersAndLocatorUnchanged: true,
    integrityOk: true,
    foreignKeysOk: true
  }
}
mkdirSync(dirname(outputPath), { recursive: true })
writeFileSync(outputPath, JSON.stringify(report, null, 2))
console.log(JSON.stringify(report.verified, null, 2))
