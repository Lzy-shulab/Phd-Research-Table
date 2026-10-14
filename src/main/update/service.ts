import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import type { UpdateSnapshot } from '../../shared/update'

const repositoryPath = 'Lzy-shulab/Phd-Research-Table'
export const latestReleaseApi = `https://api.github.com/repos/${repositoryPath}/releases/latest`
export const latestUpdateManifest = `https://github.com/${repositoryPath}/releases/latest/download/latest-update.json`
const installerPattern = /^PhD-Research-Workbench-(\d+\.\d+\.\d+)-Setup\.exe$/
const packagePattern = /^PhD-Research-Workbench-(\d+\.\d+\.\d+)-Update\.zip$/
const releaseSchema = z.object({
  tag_name: z.string(), name: z.string().nullable(), html_url: z.url(), published_at: z.string().nullable(),
  draft: z.boolean(), prerelease: z.boolean(),
  assets: z.array(z.object({ name: z.string(), size: z.number().int().positive().max(1_000_000_000), browser_download_url: z.url() }))
})
export interface ReleaseAsset { name: string; size: number; url: string }
export interface GithubUpdateRelease {
  version: string; name: string; url: string; publishedAt: string | null
  installer: ReleaseAsset; updatePackage: ReleaseAsset | null
}
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) return null
  const version = match.slice(1).map(Number) as [number, number, number]
  return version.every(Number.isSafeInteger) ? version : null
}
export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left), b = parseVersion(right)
  if (!a || !b) throw new DomainError('UNAVAILABLE', 'GitHub 发布版本号无法识别。')
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1
  }
  return 0
}
function trustedGithubUrl(value: string, kind: 'release' | 'download'): string {
  const url = new URL(value)
  const prefix = `/${repositoryPath}/releases/${kind === 'download' ? 'download/' : ''}`
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !url.pathname.startsWith(prefix))
    throw new DomainError('UNAVAILABLE', 'GitHub 返回了不受信任的下载地址。')
  return url.href
}
export function parseGithubRelease(value: unknown): GithubUpdateRelease {
  const result = releaseSchema.safeParse(value)
  if (!result.success || result.data.draft || result.data.prerelease)
    throw new DomainError('UNAVAILABLE', 'GitHub 最新版本信息不完整。')
  const version = parseVersion(result.data.tag_name)?.join('.')
  if (!version) throw new DomainError('UNAVAILABLE', 'GitHub 发布标签不是受支持的版本号。')
  const findAsset = (pattern: RegExp): ReleaseAsset | null => {
    const asset = result.data.assets.find(({ name }) => pattern.exec(name)?.[1] === version)
    return asset ? { name: asset.name, size: asset.size, url: trustedGithubUrl(asset.browser_download_url, 'download') } : null
  }
  const installer = findAsset(installerPattern)
  if (!installer) throw new DomainError('UNAVAILABLE', 'GitHub 最新版本没有匹配的 Windows 安装包。')
  return { version, name: result.data.name?.trim() || `PhD 科研工作台 ${version}`,
    url: trustedGithubUrl(result.data.html_url, 'release'), publishedAt: result.data.published_at,
    installer, updatePackage: findAsset(packagePattern) }
}
function nestedErrorCode(error: unknown): string {
  let current = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    if ('code' in current && typeof current.code === 'string') return current.code.toUpperCase()
    current = 'cause' in current ? current.cause : null
  }
  return ''
}
export function connectionFailureMessage(error: unknown): string {
  const code = nestedErrorCode(error), name = error instanceof Error ? error.name : ''
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return '无法解析 GitHub 地址，请检查 DNS 或网络连接。'
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || ['AbortError', 'TimeoutError'].includes(name))
    return '连接 GitHub 超时，请检查 Windows 系统代理或网络连接。'
  if (['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code)) return 'GitHub 连接中断，请检查 Windows 系统代理。'
  if (code.includes('CERT') || code.includes('TLS') || code.includes('SELF_SIGNED'))
    return 'GitHub 证书验证失败，请检查系统时间或网络证书。'
  return '无法连接 GitHub，请检查 Windows 系统代理、DNS 或网络连接后重试。'
}
class GithubRateLimitError extends DomainError {
  constructor() { super('UNAVAILABLE', 'GitHub 暂时限制了更新请求，请稍后重试。') }
}
interface UpdateServiceOptions {
  currentVersion: string; installable: boolean; cacheDirectory: string
  getWindow: () => BrowserWindow | null; quit: () => void
  helperPath?: string; executablePath?: string; processId?: number; fetcher?: typeof fetch
  launchHelper?: (script: string, args: string[]) => Promise<void>
}
export class UpdateService {
  private release: GithubUpdateRelease | null = null
  private packagePath: string | null = null
  private operation: Promise<UpdateSnapshot> | null = null
  private current: UpdateSnapshot
  private readonly fetcher: typeof fetch
  constructor(private readonly options: UpdateServiceOptions) {
    this.fetcher = options.fetcher ?? fetch
    this.current = { state: 'idle', currentVersion: options.currentVersion, latestVersion: null, releaseName: '',
      publishedAt: null, progress: null, installable: options.installable,
      message: '检查 GitHub 正式版，下载后重启应用完成更新。' }
  }
  snapshot(): UpdateSnapshot { return { ...this.current } }
  prepare(): Promise<UpdateSnapshot> {
    if (this.operation) return this.operation
    this.operation = this.prepareInner().finally(() => { this.operation = null })
    return this.operation
  }
  private publish(patch: Partial<UpdateSnapshot>): UpdateSnapshot {
    this.current = { ...this.current, ...patch }
    const window = this.options.getWindow()
    if (window && !window.isDestroyed()) window.webContents.send('update:changed', this.snapshot())
    return this.snapshot()
  }
  private async request(url: string, timeout: number, accept: string): Promise<Response> {
    try {
      const response = await this.fetcher(url, { redirect: 'follow', headers: {
        Accept: accept, 'User-Agent': `PhD-Research-Workbench/${this.options.currentVersion}`, 'X-GitHub-Api-Version': '2022-11-28'
      }, signal: AbortSignal.timeout(timeout) })
      if (response.status === 403 || response.status === 429) throw new GithubRateLimitError()
      if (!response.ok) throw new DomainError('UNAVAILABLE', `GitHub 更新请求失败（HTTP ${response.status}），请稍后重试。`)
      return response
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', connectionFailureMessage(error))
    }
  }
  private async latestRelease(): Promise<GithubUpdateRelease> {
    try { return parseGithubRelease(await (await this.request(latestReleaseApi, 20_000, 'application/vnd.github+json')).json()) }
    catch (error) {
      if (!(error instanceof GithubRateLimitError)) throw error
      return parseGithubRelease(await (await this.request(latestUpdateManifest, 20_000, 'application/json')).json())
    }
  }
  private async prepareInner(): Promise<UpdateSnapshot> {
    this.publish({ state: 'checking', progress: null, message: '正在连接 GitHub 检查最新版…' })
    try {
      const release = await this.latestRelease()
      this.release = release
      const info = { latestVersion: release.version, releaseName: release.name, publishedAt: release.publishedAt, progress: null }
      const comparison = compareVersions(release.version, this.options.currentVersion)
      if (comparison <= 0) return this.publish({ ...info, state: 'up-to-date', message: comparison === 0
        ? `当前已是最新版 ${this.options.currentVersion}。` : `当前版本 ${this.options.currentVersion} 高于 GitHub 正式版 ${release.version}，无需更新。` })
      if (!this.options.installable || !release.updatePackage) return this.publish({ ...info, state: 'available', message: !this.options.installable
        ? `发现 ${release.version}，请在 Windows 正式应用中更新。` : `发现 ${release.version}，该版本尚未提供应用内更新包。` })
      this.publish({ ...info, state: 'downloading', progress: 0, message: `正在下载 ${release.version}…` })
      this.packagePath = await this.download(release.updatePackage)
      return this.publish({ state: 'ready', progress: 100, message: `${release.version} 已下载，重启后自动完成更新。` })
    } catch (error) {
      this.release = null; this.packagePath = null
      const message = error instanceof DomainError ? error.message : '更新下载失败，请重试。'
      this.publish({ state: 'error', progress: null, message })
      throw new DomainError('UNAVAILABLE', message)
    }
  }
  private async download(asset: ReleaseAsset): Promise<string> {
    const directory = join(this.options.cacheDirectory, randomUUID())
    await mkdir(directory, { recursive: true })
    const destination = join(directory, asset.name), partial = `${destination}.part`
    const response = await this.request(asset.url, 10 * 60_000, 'application/octet-stream')
    if (!response.body) throw new DomainError('UNAVAILABLE', 'GitHub 没有返回更新包内容。')
    const handle = await open(partial, 'wx')
    let received = 0, lastProgress = -1
    try {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > asset.size) { await reader.cancel(); throw new DomainError('UNAVAILABLE', '下载文件大小与 GitHub 发布记录不一致。') }
        await handle.write(value)
        const progress = Math.min(99, Math.floor(received / asset.size * 100))
        if (progress !== lastProgress) { lastProgress = progress; this.publish({ progress, message: `正在下载 ${this.release?.version}：${progress}%` }) }
      }
      await handle.sync()
    } finally { await handle.close() }
    if (received !== asset.size) throw new DomainError('UNAVAILABLE', '更新包下载不完整，请重试。')
    await rename(partial, destination)
    return destination
  }
  async install(): Promise<void> {
    if (!this.options.installable || !this.packagePath || !this.release?.updatePackage || this.current.state !== 'ready')
      throw new DomainError('VALIDATION', '尚无已下载的应用内更新包。')
    const executable = this.options.executablePath ?? process.execPath
    const directory = dirname(this.packagePath), script = join(directory, 'apply-update.ps1')
    try {
      if ((await stat(this.packagePath)).size !== this.release.updatePackage.size) throw new Error('Incomplete download')
      const source = await readFile(this.options.helperPath ?? join(dirname(executable), 'resources', 'apply-update.ps1'))
      await writeFile(script, source)
      const probe = join(dirname(executable), `.update-${randomUUID()}.tmp`)
      const handle = await open(probe, 'wx'); await handle.close()
      const probeDirectory = join(dirname(executable), '.workbench-update')
      await mkdir(probeDirectory, { recursive: true })
      await rename(probe, join(probeDirectory, basename(probe)))
      const args = ['-TargetPid', String(this.options.processId ?? process.pid), '-ArchivePath', this.packagePath,
        '-InstallDirectory', dirname(executable), '-ExecutableName', basename(executable)]
      if (this.options.launchHelper) await this.options.launchHelper(script, args)
      else {
        await new Promise<void>((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', script, ...args],
          { stdio: 'ignore', windowsHide: true })
        child.once('spawn', () => { child.unref(); resolve() }); child.once('error', reject)
        })
        this.publish({ state: 'installing', message: '正在准备更新文件…' })
        let prepared = false
        for (let attempt = 0; attempt < 120; attempt++) {
          if (await stat(join(directory, 'prepared.json')).then(() => true, () => false)) { prepared = true; break }
          if (await stat(join(directory, 'result.json')).then(() => true, () => false)) throw new Error('Update preparation failed')
          await delay(500)
        }
        if (!prepared) throw new Error('Update helper did not prepare the package')
      }
    } catch {
      this.publish({ state: 'ready', message: '更新未能开始，可点击重启并更新重试。' })
      throw new DomainError('UNAVAILABLE', '无法启动应用内更新。请检查应用目录的写入权限后重试。')
    }
    this.publish({ state: 'installing', message: '正在保存并关闭，更新完成后自动重启…' })
    setTimeout(() => this.options.quit(), 250)
  }
}
