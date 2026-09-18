import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as schema from './schema'

export function openDatabase(path: string, migrationsFolder: string) {
  mkdirSync(dirname(path), { recursive: true })
  const sqlite = new Database(path)
  try {
    sqlite.pragma('foreign_keys = ON')
    sqlite.pragma('journal_mode = WAL')
    sqlite.pragma('synchronous = FULL')
    sqlite.pragma('busy_timeout = 5000')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder })
    return { db, sqlite, path, close: () => sqlite.close() }
  } catch (error) {
    sqlite.close()
    throw error
  }
}
export type DatabaseConnection = ReturnType<typeof openDatabase>
export type WorkbenchDatabase = DatabaseConnection['db']
