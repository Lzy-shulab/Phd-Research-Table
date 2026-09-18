import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'

// Read-only release evidence. This script never restores or writes a production database.
const output = process.argv[2]
if (!output) throw Error('Provide an evidence JSON output path')
const locator = join(process.env.APPDATA, 'PhD Research Workbench', 'workspace-location.json')
const databasePath = JSON.parse(readFileSync(locator, 'utf8')).databasePath
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex')
const db = new DatabaseSync(databasePath, { readOnly: true })
let report
try {
  db.exec('BEGIN')
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((row) => row.name)
  const tables = names.map((name) => {
    const rows = db.prepare(`SELECT * FROM "${name.replaceAll('"', '""')}"`).all()
    return { name, rows: rows.length, sha256: digest(JSON.stringify(rows.map((row) => JSON.stringify(row)).sort())) }
  })
  const appSettings = db.prepare('SELECT key,value FROM app_settings ORDER BY key').all()
    .map(({ key, value }) => ({ key, sha256: digest(value) }))
  const storage = db.prepare("SELECT key,value FROM app_settings WHERE key LIKE 'storage.%' ORDER BY key").all()
  const papers = db.prepare('SELECT source_path, translated_path, translation_status FROM papers').all()
  const paths = [...new Set(papers.flatMap((paper) => [paper.source_path, paper.translated_path]).filter(Boolean))].sort()
  const files = paths.map((path) => ({ path, exists: existsSync(path), sha256: existsSync(path) ? digest(readFileSync(path)) : null }))
  const scanPdfs = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? scanPdfs(path) : /\.pdf$/i.test(entry.name) ? [{ path, sha256: digest(readFileSync(path)) }] : []
  })
  const managedPdfFiles = scanPdfs(resolve('工作台数据')).sort((a, b) => a.path.localeCompare(b.path))
  const wallpaperDirectory = join(dirname(locator), 'interface-backgrounds')
  const wallpaperFiles = existsSync(wallpaperDirectory) ? readdirSync(wallpaperDirectory, { withFileTypes: true })
    .filter((entry) => entry.isFile()).map((entry) => {
      const path = join(wallpaperDirectory, entry.name)
      return { path, sha256: digest(readFileSync(path)) }
    }).sort((a, b) => a.path.localeCompare(b.path)) : []
  report = { capturedAt: new Date().toISOString(), databasePath, tables, appSettings, storage, locator: { path: locator, sha256: digest(readFileSync(locator)) }, files, managedPdfFiles, wallpaperFiles,
    translating: papers.filter((paper) => paper.translation_status === 'translating').length,
    queued: papers.filter((paper) => paper.translation_status === 'queued').length,
    integrity: db.prepare('PRAGMA integrity_check').all(), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() }
  db.exec('COMMIT')
} finally { db.close() }
mkdirSync(dirname(resolve(output)), { recursive: true })
writeFileSync(output, JSON.stringify(report, null, 2))
console.log(JSON.stringify({ databasePath, tables: report.tables.map(({ name, rows }) => ({ name, rows })), pdfFiles: report.files.length, translating: report.translating, queued: report.queued, integrity: report.integrity, foreignKeys: report.foreignKeys, output }, null, 2))
