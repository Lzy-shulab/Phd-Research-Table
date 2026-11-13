import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'
import { emptyCodexUsage, parseCodexUsage, type CodexUsageSnapshot } from '../../shared/codex-usage'

function codexExecutable() {
  const override = process.env.WORKBENCH_CODEX_PATH ?? process.env.CODEX_USAGE_NOTCH_CODEX_PATH
  if (override) return override
  const directory = join(process.env.LOCALAPPDATA ?? '', 'OpenAI', 'Codex', 'bin')
  if (process.platform === 'win32' && existsSync(directory)) {
    const candidates = [join(directory, 'codex.exe'), ...readdirSync(directory, { withFileTypes: true })
      .filter(entry => entry.isDirectory()).map(entry => join(directory, entry.name, 'codex.exe'))]
      .filter(path => existsSync(path)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)
    if (candidates[0]) return candidates[0]
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex'
}

export class CodexUsageService {
  private state: CodexUsageSnapshot = { ...emptyCodexUsage }
  private child: ChildProcessWithoutNullStreams | null = null
  private ready: Promise<void> | null = null
  private requestId = 0
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private inFlight: Promise<CodexUsageSnapshot> | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private stopped = false
  private active = true

  constructor(private readonly changed: (snapshot: CodexUsageSnapshot) => void,
    private readonly launch = () => spawn(codexExecutable(), ['app-server'], { windowsHide: true, stdio: 'pipe' })) {}

  snapshot() { return this.state }
  setActive(active: boolean) {
    if (this.active === active || this.stopped) return
    this.active = active
    if (active) void this.read()
    else { if (this.timer) clearTimeout(this.timer); if (!this.inFlight) this.disconnect() }
  }

  read(force = false): Promise<CodexUsageSnapshot> {
    if (this.stopped || !force && (!this.active || process.env.WORKBENCH_DISABLE_CODEX_AUTO === '1')) return Promise.resolve(this.state)
    if (this.inFlight) return this.inFlight
    if (!force && this.state.updatedAt && Date.now() - this.state.updatedAt < 30000) return Promise.resolve(this.state)
    if (this.timer) clearTimeout(this.timer)
    this.inFlight = this.fetch().finally(() => {
      this.inFlight = null
      if (!this.stopped && this.active && process.env.WORKBENCH_DISABLE_CODEX_AUTO !== '1') this.timer = setTimeout(() => { void this.read(true) }, 30000)
      if (!this.active) this.disconnect()
    })
    return this.inFlight
  }

  private async fetch() {
    try {
      await this.connect()
      const response = await this.request('account/rateLimits/read', { excludeResetCreditDetails: false })
      if (!this.stopped) this.state = parseCodexUsage(response)
    } catch (error) {
      this.disconnect()
      const message = error instanceof Error ? error.message : ''
      const reason = /ENOENT/.test(message) ? '未找到 Codex，请先安装并登录 Codex 桌面客户端。'
        : /auth|login|sign.?in|401|403/i.test(message) ? '请先在 Codex 客户端登录，再刷新额度。'
        : message.startsWith('暂无 ChatGPT') ? message : '暂时无法读取 Codex 额度，请稍后刷新。'
      if (!this.stopped) this.state = { ...this.state, error: reason }
    }
    if (!this.stopped) this.changed(this.state)
    return this.state
  }

  private connect() {
    if (this.ready) return this.ready
    const child = this.launch()
    this.child = child
    const lines = createInterface({ input: child.stdout })
    child.stderr.resume()
    lines.on('line', line => {
      let message: { id?: number; result?: unknown; error?: { message?: string } }
      try { message = JSON.parse(line) } catch { return }
      if (typeof message.id !== 'number') return
      const completion = this.pending.get(message.id)
      if (!completion) return
      this.pending.delete(message.id)
      if (message.error) completion.reject(new Error(message.error.message ?? '读取额度失败'))
      else completion.resolve(message.result)
    })
    const closed = (error: Error) => {
      lines.close()
      if (this.child !== child) return
      this.child = null; this.ready = null
      for (const completion of this.pending.values()) completion.reject(error)
      this.pending.clear()
    }
    child.once('error', closed)
    child.once('exit', () => closed(new Error('Codex 额度服务已停止')))
    child.stdin.on('error', error => closed(error))
    this.ready = this.request('initialize', { clientInfo: { name: 'phd_workbench_usage', title: 'PhD 科研工作台', version: '0.8.37' }, capabilities: { experimentalApi: true } })
      .then(() => { child.stdin.write(JSON.stringify({ method: 'initialized', params: {} }) + '\n') })
    return this.ready
  }

  private request(method: string, params: unknown) {
    const child = this.child
    if (!child) return Promise.reject(new Error('Codex 额度服务未连接'))
    const id = ++this.requestId
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => { this.pending.delete(id); reject(new Error('额度读取超时')) }, 30000)
      this.pending.set(id, { resolve: value => { clearTimeout(timeout); resolve(value) }, reject: error => { clearTimeout(timeout); reject(error) } })
      child.stdin.write(JSON.stringify({ id, method, params }) + '\n', error => {
        if (error) { clearTimeout(timeout); this.pending.delete(id); reject(error) }
      })
    })
  }

  private disconnect() {
    const child = this.child
    this.child = null; this.ready = null
    for (const completion of this.pending.values()) completion.reject(new Error('额度连接已关闭'))
    this.pending.clear()
    child?.stdin.end()
    child?.kill()
  }

  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.disconnect() }
}
