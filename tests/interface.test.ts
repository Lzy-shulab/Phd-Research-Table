import { describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { openDatabase } from '../src/main/database/db'
import { SettingsRepository } from '../src/main/database/repositories/settings'
import { defaultInterfacePreferences } from '../src/shared/interface'
import { interfacePatchSchema, interfacePreferencesSchema } from '../src/domain/interface'
import { EngineProgressDecoder, parseEngineProgress } from '../src/main/library/translation-progress'

describe('Interface preferences and engine progress', () => {
  it('reads defaults without changing an existing database, then changes only the dedicated preference key', () => {
    const directory = mkdtempSync(join(tmpdir(), 'workbench-interface-'))
    const connection = openDatabase(join(directory, 'workbench.sqlite'), resolve('src/main/database/migrations'))
    try {
      connection.sqlite.prepare("INSERT INTO app_settings(key,value) VALUES (?,?)").run('storage.library', '{"current":"D:/papers","previous":["C:/older"]}')
      connection.sqlite.prepare("INSERT INTO app_settings(key,value) VALUES (?,?)").run('translation.directory', 'D:/existing-engine')
      const before = connection.sqlite.prepare('SELECT * FROM app_settings ORDER BY key').all()
      const repository = new SettingsRepository(connection.db)
      expect(repository.getInterface()).toEqual(defaultInterfacePreferences)
      expect(connection.sqlite.prepare('SELECT * FROM app_settings ORDER BY key').all()).toEqual(before)
      repository.setInterface({ ...defaultInterfacePreferences, fontSize: 18, background: 'sage' })
      const restored = new SettingsRepository(connection.db).getInterface()
      expect(restored).toMatchObject({ fontSize: 18, background: 'sage' })
      expect(connection.sqlite.prepare("SELECT * FROM app_settings WHERE key <> 'interface.preferences' ORDER BY key").all()).toEqual(before)
      expect(connection.sqlite.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(connection.sqlite.prepare('SELECT * FROM __drizzle_migrations').all()).toHaveLength(6)
    } finally { connection.close(); rmSync(directory, { recursive: true, force: true }) }
  })
  it('rejects arbitrary font sizes, unknown settings and unowned background paths', () => {
    const legacy = { background: 'default', fontSize: 14, backgroundFile: null, backgroundName: '' }
    expect(interfacePreferencesSchema.parse({ ...legacy, background: 'custom', backgroundFile: `${'a'.repeat(64)}.jpg`, fontSize: 18 })).toMatchObject({ panelOpacity: 75, fontSize: 18, background: 'custom', backgroundFile: `${'a'.repeat(64)}.jpg` })
    expect(interfacePatchSchema.safeParse({ panelOpacity: 19 }).success).toBe(false)
    expect(interfacePatchSchema.safeParse({ panelOpacity: 101 }).success).toBe(false)
    expect(interfacePatchSchema.safeParse({ fontSize: 500 }).success).toBe(false)
    expect(interfacePatchSchema.safeParse({ background: 'https://example.org/picture' }).success).toBe(false)
    expect(interfacePatchSchema.safeParse({ backgroundFile: 'C:/private.txt' }).success).toBe(false)
    expect(interfacePreferencesSchema.safeParse({ ...defaultInterfacePreferences, backgroundFile: '../private.jpg' }).success).toBe(false)
  })
  it('uses only finite engine progress, preserves unknown progress, and reserves completion for output validation', () => {
    expect(parseEngineProgress('@@WORKBENCH_PROGRESS@@{"stage":"Translate Paragraphs","percent":42.9,"current":12,"total":28}')).toEqual({ stage: '正在翻译正文', percent: 42, current: 12, total: 28 })
    expect(parseEngineProgress('@@WORKBENCH_PROGRESS@@{"stage":"Preparing translation engine"}')?.percent).toBeNull()
    expect(parseEngineProgress('@@WORKBENCH_PROGRESS@@{"stage":"Typesetting","percent":100}')?.percent).toBe(99)
    expect(parseEngineProgress('@@WORKBENCH_PROGRESS@@{"stage":"Typesetting","percent":"50"}')?.percent).toBeNull()
    expect(parseEngineProgress('Unrelated warning 95%')).toBeNull()
    expect(parseEngineProgress('@@WORKBENCH_PROGRESS@@not-json')).toBeNull()
  })
  it('decodes fragmented and combined process output without turning diagnostics into progress', () => {
    const received: unknown[] = []
    const decoder = new EngineProgressDecoder((event) => received.push(event))
    const bytes = Buffer.from('log line\n@@WORKBENCH_PROGRESS@@{"stage":"Translate Paragraphs","percent":12}\n@@WORKBENCH_PROGRESS@@{"stage":"Typesetting","percent":87}\n@@WORKBENCH_PROGRESS@@{"stage":"未知阶段","percent":90}')
    for (let i = 0; i < bytes.length; i += 3) decoder.write(bytes.subarray(i, i + 3))
    decoder.end()
    expect(received).toMatchObject([{ stage: '正在翻译正文', percent: 12 }, { stage: '正在排版译文', percent: 87 }, { stage: '正在处理文献', percent: 90 }])
  })
})
