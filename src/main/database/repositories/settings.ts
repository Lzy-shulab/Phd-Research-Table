import { eq } from 'drizzle-orm'
import { appSettings } from '../schema'
import type { WorkbenchDatabase } from '../db'
import { appearanceSchema, windowStateSchema } from '../../../domain/validation'
import type { Appearance } from '../../../shared/types'
import type { z } from 'zod'
import { defaultInterfacePreferences, type InterfacePreferences } from '../../../shared/interface'
import { interfacePreferencesSchema } from '../../../domain/interface'

export class SettingsRepository {
  constructor(private readonly db: WorkbenchDatabase) {}
  private read(key: string): unknown {
    const value = this.db.select().from(appSettings).where(eq(appSettings.key, key)).get()?.value
    if (!value) return undefined
    try {
      return JSON.parse(value) as unknown
    } catch {
      return undefined
    }
  }
  private write(key: string, value: unknown): void {
    this.db
      .insert(appSettings)
      .values({ key, value: JSON.stringify(value) })
      .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(value) } })
      .run()
  }
  getAppearance(): Appearance {
    return appearanceSchema.safeParse(this.read('appearance')).data ?? 'system'
  }
  setAppearance(value: Appearance): void {
    this.write('appearance', value)
  }
  getInterface(): InterfacePreferences {
    return interfacePreferencesSchema.safeParse(this.read('interface.preferences')).data ?? { ...defaultInterfacePreferences }
  }
  setInterface(value: InterfacePreferences): void {
    this.write('interface.preferences', interfacePreferencesSchema.parse(value))
  }
  getWindowState() {
    return windowStateSchema.safeParse(this.read('window')).data
  }
  setWindowState(value: z.infer<typeof windowStateSchema>): void {
    this.write('window', value)
  }
  getEncouragement(): unknown { return this.read('daily.encouragement') }
  getAssistant(): unknown { return this.read('assistant.settings') }
  setAssistant(value: unknown): void { this.write('assistant.settings', value) }
  getAssistantReceipts(): unknown { return this.read('assistant.receipts') }
  setAssistantReceipts(value: unknown): void { this.write('assistant.receipts', value) }
  setEncouragement(value: unknown): void { this.write('daily.encouragement', value) }
}
