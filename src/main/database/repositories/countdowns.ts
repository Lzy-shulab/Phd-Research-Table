import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import type { WorkbenchDatabase } from '../db'
import { appSettings } from '../schema'
import { countdownInputSchema, countdownListSchema } from '../../../domain/countdowns'
import { DomainError } from '../../../domain/errors'
import type { CountdownInput, ImportantCountdown } from '../../../shared/countdowns'

const key = 'planner.countdowns.v1'
export class CountdownRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  list(now = new Date()): ImportantCountdown[] {
    const row = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()
    if (!row) return []
    let items: ImportantCountdown[]
    try { items = countdownListSchema.parse(JSON.parse(row.value)) }
    catch { throw new DomainError('VALIDATION', '重点倒计时记录无法读取，原记录已保留。') }
    const active = items.filter(item => new Date(item.deadline).getTime() > now.getTime())
    if (active.length !== items.length) this.write(active)
    return active
  }
  save(input: CountdownInput, id?: string) {
    const parsed = countdownInputSchema.parse(input)
    if (new Date(parsed.deadline).getTime() <= Date.now()) throw new DomainError('VALIDATION', '请选择尚未到达的截止时间。')
    const items = this.list()
    const previous = id ? items.find(item => item.id === id) : undefined
    if (id && !previous) throw new DomainError('NOT_FOUND', '此倒计时已不存在。')
    if (!previous && items.length >= 12) throw new DomainError('VALIDATION', '最多保存 12 个重点倒计时。')
    const item = { ...parsed, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? new Date().toISOString() }
    this.write(previous ? items.map(old => old.id === id ? item : old) : [...items, item])
    return item
  }
  remove(id: string) { this.write(this.list().filter(item => item.id !== id)) }
  private write(items: ImportantCountdown[]) {
    const value = JSON.stringify(countdownListSchema.parse(items))
    this.db.insert(appSettings).values({ key, value }).onConflictDoUpdate({ target: appSettings.key, set: { value } }).run()
  }
}
