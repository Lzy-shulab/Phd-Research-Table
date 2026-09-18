import Database from 'better-sqlite3'
const database = new Database(':memory:')
console.log('SQLite ready:', database.prepare('select sqlite_version() as version').get().version)
database.close()
