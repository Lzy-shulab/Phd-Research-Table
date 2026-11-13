import assert from 'node:assert/strict'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { extractFile } from '@electron/asar'

const stage = resolve(process.argv[2] || 'release-stage-0.8.26-final')
const archive = join(stage, 'win-unpacked', 'resources', 'app.asar')
const sourceRoot = resolve('out')
const files = directory => readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
  const file = join(directory, entry.name)
  return entry.isDirectory() ? files(file) : [file]
})
let compared = 0
for (const file of files(sourceRoot)) {
  const packagedPath = join('out', relative(sourceRoot, file))
  assert.ok(readFileSync(file).equals(extractFile(archive, packagedPath)), `Packaged program differs: ${packagedPath}`)
  compared++
}
const expected = JSON.parse(readFileSync('package.json', 'utf8')).version
assert.equal(JSON.parse(extractFile(archive, 'package.json').toString()).version, expected)
assert.ok(existsSync(join(stage, `PhD-Research-Workbench-${expected}-Setup.exe`)))
console.log(JSON.stringify({ version: expected, programFilesCompared: compared, identical: true, installerPresent: true }))
