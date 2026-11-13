import { BrowserWindow, safeStorage, type Session } from 'electron'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import { gpuMonitorOrigin } from '../../shared/gpu'
import type { SettingsRepository } from '../database/repositories/settings'

export const gpuLoginSchema = z.object({ username: z.string().trim().regex(/^[a-zA-Z0-9_-]{3,40}$/, '请输入有效的团队账号。'),
  password: z.string().min(1, '请输入看板密码。').max(512) }).strict()
type Credentials = z.infer<typeof gpuLoginSchema>

export class GpuLogin {
  private pending: Promise<boolean> | null = null
  private failedAt = 0

  constructor(private readonly session: () => Promise<Session>, private readonly settings: () => SettingsRepository) {}

  remembered() { return typeof this.settings().getGpuLogin() === 'string' }
  forget() { this.settings().setGpuLogin(null) }

  async save(credentials: Credentials) {
    if (!await safeStorage.isAsyncEncryptionAvailable()) throw new DomainError('UNAVAILABLE', 'Windows 凭据加密暂不可用。')
    if (this.pending) await this.pending
    const secured = await safeStorage.encryptStringAsync(JSON.stringify(credentials))
    const login = this.signIn(credentials)
    this.pending = login
    try {
      if (!await login) throw new DomainError('FORBIDDEN', '看板登录失败，请核对账号和密码后重试。')
      this.settings().setGpuLogin(secured.toString('base64'))
      this.failedAt = 0
    } finally { this.pending = null }
  }

  async request(url: string, init?: RequestInit): Promise<Response> {
    const session = await this.session()
    const response = await session.fetch(url, init)
    if (![401, 403].includes(response.status) || !await this.reconnect()) return response
    await response.body?.cancel().catch(() => {})
    return session.fetch(url, init)
  }

  private reconnect() {
    if (this.pending) return this.pending
    const encrypted = this.settings().getGpuLogin()
    if (typeof encrypted !== 'string' || Date.now() - this.failedAt < 60_000) return Promise.resolve(false)
    this.pending = (async () => {
      try {
        const { result } = await safeStorage.decryptStringAsync(Buffer.from(encrypted, 'base64'))
        if (await this.signIn(gpuLoginSchema.parse(JSON.parse(result)))) return true
      } catch { /* An expired or unavailable credential falls back to the sign-in form. */ }
      this.failedAt = Date.now()
      return false
    })().finally(() => { this.pending = null })
    return this.pending
  }

  private async signIn(credentials: Credentials): Promise<boolean> {
    const session = await this.session()
    const window = new BrowserWindow({ show: false, skipTaskbar: true,
      webPreferences: { session, sandbox: true, contextIsolation: true, nodeIntegration: false } })
    const page = window.webContents
    page.setWindowOpenHandler(() => ({ action: 'deny' }))
    const keepOnSite = (event: Electron.Event, url: string) => { if (new URL(url).origin !== gpuMonitorOrigin) event.preventDefault() }
    page.on('will-navigate', keepOnSite)
    page.on('will-redirect', keepOnSite)
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), 25_000) }), (async () => {
        await window.loadURL(gpuMonitorOrigin + '/login')
        if (new URL(page.getURL()).origin !== gpuMonitorOrigin) return false
        const signedIn = await new Promise<boolean>(resolve => {
          page.on('did-navigate', (_event, url) => {
            const location = new URL(url)
            if (location.origin === gpuMonitorOrigin && location.pathname === '/') resolve(true)
          })
          void page.executeJavaScript(`(() => {
            const form = document.querySelector('#login-form');
            const username = form?.querySelector('input[autocomplete="username"]');
            const password = form?.querySelector('input[autocomplete="current-password"]');
            const error = form?.querySelector('#login-error') ?? document.querySelector('#login-error');
            if (!username || !password || !error || location.pathname !== '/login') return false;
            username.value = ${JSON.stringify(credentials.username)};
            password.value = ${JSON.stringify(credentials.password)};
            if (!form.checkValidity()) return false;
            return new Promise(done => {
              new MutationObserver(() => { if (!error.hidden) done(false); }).observe(error, { attributes: true });
              form.requestSubmit();
            });
          })()`).then(() => resolve(false), () => { /* Navigation may dispose of the submitted page. */ })
        })
        if (!signedIn) return false
        const verified = await session.fetch(gpuMonitorOrigin + '/api/status', { credentials: 'include', cache: 'no-store', signal: AbortSignal.timeout(10_000) })
        await verified.body?.cancel().catch(() => {})
        if (verified.ok) await session.cookies.flushStore()
        return verified.ok
      })()])
    } catch { return false }
    finally { clearTimeout(timer); if (!window.isDestroyed()) window.destroy() }
  }
}
