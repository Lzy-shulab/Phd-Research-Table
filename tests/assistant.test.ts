import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it, vi } from 'vitest'
vi.mock('electron', () => ({ safeStorage: {
  isEncryptionAvailable: () => true,
  encryptString: (value: string) => Buffer.from(`test-encrypted:${value}`),
  decryptString: (value: Buffer) => value.toString().replace('test-encrypted:', '')
} }))
import { openDatabase, type DatabaseConnection } from '../src/main/database/db'
import { ProjectRepository } from '../src/main/database/repositories/projects'
import { TaskRepository } from '../src/main/database/repositories/tasks'
import { SettingsRepository } from '../src/main/database/repositories/settings'
import { AssistantService } from '../src/main/assistant/service'
import { assistantSettingsSchema, completionEndpoint, parseAssistantProposal } from '../src/domain/assistant'
import { selectTasks } from '../src/domain/planner'

const resources: { directory: string; connection: DatabaseConnection }[] = []
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); for (const { directory, connection } of resources.splice(0)) { connection.close(); rmSync(directory, { recursive: true, force: true }) } })
function setup(configure = true) {
  const directory = mkdtempSync(join(tmpdir(), 'workbench-assistant-'))
  const connection = openDatabase(join(directory, 'workbench.sqlite'), resolve('src/main/database/migrations'))
  resources.push({ directory, connection })
  const project = new ProjectRepository(connection.db).create({ name: '组会', description: '', colorKey: 'blue' })
  const service = new AssistantService(() => connection)
  if (configure) service.save({ provider: 'custom', model: 'fixture', baseUrl: 'http://127.0.0.1:4321/v1', apiKey: 'test-secret' })
  const task = { title: '开组会', projectId: project.id, scheduledDate: '2026-09-09', startTime: '18:00', endTime: null }
  return { connection, project, service, task, request: { requestId: randomUUID(), text: '今天晚上6点，开组会', projectId: null } }
}
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status })
const completion = (value: unknown) => response({ choices: [{ message: { content: JSON.stringify(value) } }] })
describe('AI planning and credential boundaries', () => {
  it('defaults new assistant settings to SiliconFlow Qwen and requires only the user API key', () => {
    const { service } = setup(false)
    const snapshot = service.snapshot()
    expect(snapshot.activeProvider).toBe('siliconflow')
    expect(snapshot.profiles).toHaveLength(3)
    expect(snapshot.profiles.find((profile) => profile.provider === 'siliconflow')).toMatchObject({
      model: 'Qwen/Qwen3-8B',
      baseUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      hasApiKey: false
    })
    expect(assistantSettingsSchema.safeParse({ provider: 'siliconflow', model: 'Qwen/Qwen3-8B', baseUrl: 'https://api.siliconflow.cn/v1/chat/completions', apiKey: 'silicon-key' }).success).toBe(true)
  })
  it('translates only supplied title and abstract without creating tasks or sending project context', async () => {
    const { service, connection } = setup()
    const expected = { titleZh: '论文题目', abstractZh: '论文中文摘要。' }
    vi.stubGlobal('fetch', vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      expect(JSON.parse(body.messages[1].content)).toEqual({ title: 'Title', abstract: 'Original abstract.' })
      expect(body.messages[0].content).toContain('不压缩成总结')
      expect(body.max_tokens).toBe(6000)
      return completion(expected)
    }))
    expect(await service.translateOverview('Title', 'Original abstract.')).toEqual(expected)
    expect(new TaskRepository(connection.db).list()).toHaveLength(0)
  })
  it('normalizes endpoints and rejects credential-bearing, remote plaintext and non-HTTP URLs', () => {
    expect(completionEndpoint('https://example.org/v1/')).toBe('https://example.org/v1/chat/completions')
    expect(completionEndpoint('http://localhost:1234/v1/chat/completions')).toBe('http://localhost:1234/v1/chat/completions')
    for (const url of ['file:///private', 'http://example.org/v1', 'https://user:key@example.org/v1', 'https://example.org/v1?key=x', 'https://example.org/#key']) expect(() => completionEndpoint(url)).toThrow()
  })
  it('keeps OpenRouter free and custom profiles independent and returns no stored keys', () => {
    const { service } = setup()
    expect(service.snapshot().quickRecognitionEnabled).toBe(true)
    expect(service.setQuickRecognition(false).quickRecognitionEnabled).toBe(false)
    const next = service.save({ provider: 'openrouter', model: 'openrouter/free', baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'router-secret' })
    expect(next.quickRecognitionEnabled).toBe(false)
    expect(next.profiles).toHaveLength(3)
    expect(next.profiles.find((profile) => profile.provider === 'openrouter')?.hasApiKey).toBe(true)
    expect(next.profiles.find((profile) => profile.provider === 'custom')?.hasApiKey).toBe(true)
    expect(JSON.stringify(next)).not.toContain('secret')
    expect(assistantSettingsSchema.safeParse({ provider: 'openrouter', model: 'paid/model', baseUrl: 'https://openrouter.ai/api/v1' }).success).toBe(false)
    expect(assistantSettingsSchema.safeParse({ provider: 'openrouter', model: 'org/model:free', baseUrl: 'https://example.org' }).success).toBe(false)
    expect(() => service.save({ provider: 'custom', model: 'new', baseUrl: 'https://new.example.org/v1' })).toThrow(/重新填写/)
  })
  it('defaults legacy assistant settings to enabled and persists the recognition switch', () => {
    const { service, connection } = setup()
    const repository = new SettingsRepository(connection.db)
    const saved = repository.getAssistant() as { activeProvider: string; profiles: unknown[] }
    repository.setAssistant({ activeProvider: saved.activeProvider, profiles: saved.profiles })
    expect(new AssistantService(() => connection).snapshot().quickRecognitionEnabled).toBe(true)
    service.setQuickRecognition(false)
    expect(new AssistantService(() => connection).snapshot().quickRecognitionEnabled).toBe(false)
  })
  it('sends a local-time anchor and only planning context; creates one shared task without inventing duration', async () => {
    const { service, task, request, connection } = setup()
    vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 9, 15, 5))
    const fetcher = vi.fn(async (_url: string, options: RequestInit) => {
      const body = JSON.parse(options.body as string)
      expect(body.messages[0].content).toContain('2026-09-09')
      expect(body.messages[0].content).toContain('15:05')
      expect(body.messages[0].content).toContain('星期三')
      expect(body.messages[1].content).not.toContain('test-secret')
      expect(options.redirect).toBe('error')
      return completion({ action: 'create_tasks', message: '添加组会', tasks: [task] })
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await service.run(request)
    expect(result.tasks[0]).toMatchObject(task)
    expect(result.tasks[0]?.endTime).toBeNull()
    const rows = new TaskRepository(connection.db).list()
    expect(rows).toHaveLength(1)
    for (const view of ['all', 'today', 'calendar'] as const) expect(selectTasks(rows, view, '2026-09-09', null)[0]?.id).toBe(result.tasks[0]?.id)
    expect(selectTasks(rows, 'today', '2026-09-10', null)).toEqual([])
  })
  it('does not create a duplicate on concurrent submission or a retry after service restart', async () => {
    const { connection, service, task, request } = setup()
    const fetcher = vi.fn(async () => completion({ action: 'create_tasks', message: '已安排', tasks: [task] }))
    vi.stubGlobal('fetch', fetcher)
    const [first, second] = await Promise.all([service.run(request), service.run(request)])
    expect(first.tasks[0]?.id).toBe(second.tasks[0]?.id)
    const third = await new AssistantService(() => connection).run(request)
    expect(third.tasks[0]?.id).toBe(first.tasks[0]?.id)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(new TaskRepository(connection.db).list()).toHaveLength(1)
    await expect(service.run({ ...request, text: 'changed' })).rejects.toThrow(/请求已变化/)
  })
  it('retains clarification and unsupported intents without writing any tasks', async () => {
    const { connection, service, request } = setup()
    for (const action of ['clarify', 'unsupported']) {
      vi.stubGlobal('fetch', async () => completion({ action, message: '请说明是哪一天、上午还是下午。', tasks: [] }))
      expect((await service.run(request)).kind).toBe(action)
      expect(new TaskRepository(connection.db).list()).toEqual([])
    }
  })
  it('rejects impossible dates, malformed time, inverted times, invented ids and unexpected operations', async () => {
    const { connection, service, task, request } = setup()
    for (const patch of [{ scheduledDate: '2026-02-30' }, { startTime: '25:01' }, { endTime: '17:00' }, { scheduledDate: null }, { deleteId: randomUUID() }]) {
      vi.stubGlobal('fetch', async () => completion({ action: 'create_tasks', message: 'test', tasks: [{ ...task, ...patch }] }))
      await expect(service.run(request)).rejects.toThrow()
      expect(new TaskRepository(connection.db).list()).toEqual([])
    }
    vi.stubGlobal('fetch', async () => completion({ action: 'create_tasks', message: 'test', tasks: [{ ...task, projectId: randomUUID() }] }))
    expect((await service.run(request)).kind).toBe('clarify')
    expect(new TaskRepository(connection.db).list()).toEqual([])
  })
  it('rolls back an entire multi-task addition when a project is archived during inference', async () => {
    const { connection, service, task, request } = setup()
    const other = new ProjectRepository(connection.db).create({ name: '即将归档', description: '', colorKey: 'sage' })
    vi.stubGlobal('fetch', async () => {
      new ProjectRepository(connection.db).update(other.id, { archived: true })
      return completion({ action: 'create_tasks', message: 'test', tasks: [task, { ...task, projectId: other.id }] })
    })
    await expect(service.run(request)).rejects.toThrow(/恢复/)
    expect(new TaskRepository(connection.db).list()).toEqual([])
    expect(new SettingsRepository(connection.db).getAssistantReceipts()).toBeUndefined()
  })
  it('does not expose remote errors or keys and leaves tasks unchanged on rate limits, timeouts and bad JSON', async () => {
    const { connection, service, request } = setup()
    vi.stubGlobal('fetch', async () => response({ error: 'test-secret' }, 429))
    await expect(service.run(request)).rejects.toThrow(/限流/)
    vi.stubGlobal('fetch', async () => { throw new Error('test-secret') })
    await expect(service.run(request)).rejects.toThrow(/未能取得 AI 回复/)
    vi.stubGlobal('fetch', async () => response({ choices: [{ message: { content: '{bad' } }] }))
    await expect(service.run(request)).rejects.toThrow(/无法识别/)
    expect(new TaskRepository(connection.db).list()).toEqual([])
  })
  it('preserves year boundaries and minute precision in structured proposals', () => {
    const value = { title: '年末实验', projectId: randomUUID(), scheduledDate: '2027-01-01', startTime: '00:17', endTime: '01:43' }
    expect(parseAssistantProposal(JSON.stringify({ action: 'create_tasks', message: 'test', tasks: [value] })).tasks[0]).toEqual(value)
    expect(() => parseAssistantProposal(JSON.stringify({ action: 'clarify', message: 'test', tasks: [value] }))).toThrow(/冲突/)
  })
})
