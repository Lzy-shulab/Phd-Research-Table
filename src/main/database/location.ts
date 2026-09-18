import { existsSync, mkdirSync, readFileSync, renameSync, openSync, writeFileSync, fsyncSync, closeSync, unlinkSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { DomainError } from '../../domain/errors'

// This small locator stays with Electron's profile so a custom database can be found on restart.
export class DatabaseLocation {
  readonly configPath: string
  constructor(private readonly profileDirectory: string) { this.configPath = join(profileDirectory, 'workspace-location.json') }
  get() {
    if (!existsSync(this.configPath)) return join(this.profileDirectory, 'workbench.sqlite')
    try {
      const config = JSON.parse(readFileSync(this.configPath, 'utf8')) as { databasePath?: unknown }
      if (typeof config.databasePath !== 'string' || !isAbsolute(config.databasePath)) throw new Error('Invalid location')
      if (!existsSync(config.databasePath)) throw new DomainError('UNAVAILABLE', `工作台数据文件夹暂时不可用：${dirname(config.databasePath)}。请连接相应磁盘后重试。`)
      return config.databasePath
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', '工作台数据位置配置无法读取。请检查 workspace-location.json，不会创建空库替代已有数据。')
    }
  }
  set(databasePath: string) {
    if (!isAbsolute(databasePath) || !existsSync(databasePath)) throw new DomainError('VALIDATION', '新工作台数据库不存在。')
    mkdirSync(this.profileDirectory, { recursive: true })
    const temporary = join(this.profileDirectory, `.workspace-location-${randomUUID()}.json`)
    const handle = openSync(temporary, 'wx')
    try { writeFileSync(handle, JSON.stringify({ version: 1, databasePath }, null, 2)); fsyncSync(handle) }
    finally { closeSync(handle) }
    try { renameSync(temporary, this.configPath) }
    catch (error) { unlinkSync(temporary); throw error }
  }
}
