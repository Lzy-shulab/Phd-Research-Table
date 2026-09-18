import { existsSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'
import { openDatabase, type DatabaseConnection } from './database/db'
import { DatabaseLocation } from './database/location'
import { relocateDatabase } from './database/relocate'

// Maintenance entry point. Run only after all workbench processes have exited.
const [profile, targetRoot, migrationFolder, reportPath] = process.argv.slice(2)
if (!profile || !targetRoot || !migrationFolder || !reportPath || ![profile, targetRoot, migrationFolder, reportPath].every(isAbsolute))
  throw new Error('Usage: node migrate-workspace.js <absolute profile> <absolute data root> <absolute migrations> <absolute report>')
const locator = new DatabaseLocation(resolve(profile))
const source = locator.get()
if (!existsSync(source)) throw new Error(`No existing database at ${source}; no empty replacement was created.`)
let connection: DatabaseConnection | undefined = openDatabase(source, resolve(migrationFolder))
try {
  const report = await relocateDatabase(connection, { directory: join(resolve(targetRoot), '数据库'), dataRoot: resolve(targetRoot), migrationsFolder: resolve(migrationFolder),
    activate: (next) => { locator.set(next.path); connection?.close(); connection = next } })
  writeFileSync(reportPath, JSON.stringify({ migratedAt: new Date().toISOString(), ...report }, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally { connection?.close() }
