import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { codexTranslationExecutable } from '../library/codex-translator'

export type CodexNotification = { id?: number | string; method: string; params: Record<string, unknown> }

export class CodexServer {
  private readonly child: ChildProcessWithoutNullStreams
  private readonly pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  private sequence = 0
  private closed = false
  readonly ready: Promise<unknown>
  constructor(cwd: string, notification: (event: CodexNotification) => void, exited: (error: Error) => void) {
    const env = { ...process.env }
    delete env.CODEX_THREAD_ID
    this.child = spawn(codexTranslationExecutable(), ['app-server', '--listen', 'stdio://',
      '-c', 'features.shell_tool=false', '-c', 'features.apps=false', '-c', 'features.plugins=false',
      '-c', 'mcp_servers={}', '-c', 'web_search="disabled"', '-c', 'project_doc_max_bytes=0'],
    { cwd, windowsHide: true, stdio: 'pipe', env })
    this.child.stderr.resume()
    this.child.stdin.on('error', () => {})
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', line => {
      try {
        const event = JSON.parse(line)
        if (event.method) { notification({ ...event, params: event.params ?? {} }); return }
        const pending = this.pending.get(event.id)
        if (!pending) return
        if (event.error) pending.reject(new Error(String(event.error.message)))
        else pending.resolve(event.result)
      } catch { /* Stdout can contain startup diagnostics outside of JSON-RPC. */ }
    })
    const finish = (error: Error) => {
      if (this.closed) return
      this.closed = true
      for (const item of this.pending.values()) item.reject(error)
      exited(error)
    }
    this.child.once('error', error => finish(new Error(error.message.includes('ENOENT') ? '未找到本地 Codex CLI。' : error.message)))
    this.child.once('close', code => { lines.close(); finish(new Error(`Codex CLI 已退出（${code ?? '已停止'}）。`)) })
    this.ready = this.call('initialize', { clientInfo: { name: 'phd_workbench', title: 'PhD Research Workbench', version: '0.8.60' },
      capabilities: { experimentalApi: true } }).then(() => this.send({ method: 'initialized', params: {} }))
  }
  private send(value: object) {
    if (!this.closed) this.child.stdin.write(JSON.stringify(value) + '\n')
  }
  call<T = unknown>(method: string, params: object = {}) {
    if (this.closed) return Promise.reject(new Error('Codex CLI 未连接。'))
    const id = ++this.sequence
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Codex CLI 响应超时。')), 20_000)
      this.pending.set(id, { resolve: result => { clearTimeout(timer); resolve(result) },
        reject: error => { clearTimeout(timer); reject(error) } })
      this.send({ id, method, params })
    }).finally(() => this.pending.delete(id)) as Promise<T>
  }
  reply(id: string | number, result: object) { this.send({ id, result }) }
  reject(id: string | number) { this.send({ id, error: { code: -32601, message: 'This request is unavailable in the workbench.' } }) }
  stop() { this.child.kill() }
}
