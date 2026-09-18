import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { spawn } from 'node:child_process'
import type { BrowserWindow } from 'electron'
import { z } from 'zod'
import { DomainError } from '../../domain/errors'
import type { UpdateSnapshot } from '../../shared/update'

const owner = 'Lzy-shulab'
const repository = 'Phd-Research-Table'
export const latestReleaseApi = `https://api.github.com/repos/${owner}/${repository}/releases/latest`
export const latestReleaseChecksum = `https://github.com/${owner}/${repository}/releases/latest/download/SHA256SUMS.txt`
const releaseDownloadPrefix = `/${owner}/${repository}/releases/download/`
const installerPattern = /^PhD-Research-Workbench-(\d+\.\d+\.\d+)-Setup\.exe$/
const digestPattern = /^sha256:([a-f\d]{64})$/i

const releaseSchema = z.object({
  tag_name: z.string(),
  name: z.string().nullable(),
  html_url: z.url(),
  published_at: z.string().nullable(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  assets: z.array(z.object({
    name: z.string(),
    size: z.number().int().positive().max(1_000_000_000),
    browser_download_url: z.url(),
    digest: z.string().nullable().optional()
  }).passthrough())
}).passthrough()

export interface ReleaseAsset {
  name: string
  size: number | null
  url: string
  sha256: string | null
}

export interface GithubUpdateRelease {
  version: string
  name: string
  url: string
  publishedAt: string | null
  installer: ReleaseAsset
  checksum: ReleaseAsset | null
}

export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) return null
  const version = match.slice(1).map(Number) as [number, number, number]
  return version.every(Number.isSafeInteger) ? version : null
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left), b = parseVersion(right)
  if (!a || !b) throw new DomainError('UNAVAILABLE', 'GitHub 发布版本号无法识别，已停止更新。')
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index]! > b[index]! ? 1 : -1
  }
  return 0
}

function trustedGithubUrl(value: string, kind: 'release' | 'download'): string {
  const url = new URL(value)
  const validPath = kind === 'release'
    ? url.pathname.startsWith(`/${owner}/${repository}/releases/`)
    : url.pathname.startsWith(releaseDownloadPrefix)
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !validPath)
    throw new DomainError('UNAVAILABLE', 'GitHub 返回了不受信任的下载地址，已停止更新。')
  return url.href
}

export function parseGithubRelease(value: unknown): GithubUpdateRelease {
  const result = releaseSchema.safeParse(value)
  if (!result.success || result.data.draft || result.data.prerelease)
    throw new DomainError('UNAVAILABLE', 'GitHub 最新版本信息不完整，已停止更新。')
  const tagVersion = parseVersion(result.data.tag_name)
  if (!tagVersion) throw new DomainError('UNAVAILABLE', 'GitHub 发布标签不是受支持的版本号。')
  const version = tagVersion.join('.')
  const asset = result.data.assets.find(({ name }) => installerPattern.test(name))
  const assetVersion = asset ? installerPattern.exec(asset.name)?.[1] : undefined
  if (!asset || assetVersion !== version)
    throw new DomainError('UNAVAILABLE', 'GitHub 最新版本没有匹配的 Windows 安装包。')
  const digest = asset.digest?.match(digestPattern)?.[1]?.toLowerCase() ?? null
  const checksumAsset = result.data.assets.find(({ name }) => name === 'SHA256SUMS.txt')
  return {
    version,
    name: result.data.name?.trim() || `PhD 科研工作台 ${version}`,
    url: trustedGithubUrl(result.data.html_url, 'release'),
    publishedAt: result.data.published_at,
    installer: {
      name: asset.name,
      size: asset.size,
      url: trustedGithubUrl(asset.browser_download_url, 'download'),
      sha256: digest
    },
    checksum: checksumAsset ? {
      name: checksumAsset.name,
      size: checksumAsset.size,
      url: trustedGithubUrl(checksumAsset.browser_download_url, 'download'),
      sha256: checksumAsset.digest?.match(digestPattern)?.[1]?.toLowerCase() ?? null
    } : null
  }
}

export function checksumForInstaller(contents: string, filename: string): string | null {
  for (const line of contents.split(/\r?\n/)) {
    const match = /^([a-f\d]{64})\s+\*?(.+?)\s*$/i.exec(line)
    if (match?.[2] === filename) return match[1]!.toLowerCase()
  }
  return null
}

export function parseChecksumRelease(contents: string): GithubUpdateRelease {
  const matches = contents.split(/\r?\n/).flatMap((line) => {
    const match = /^([a-f\d]{64})\s+\*?(PhD-Research-Workbench-(\d+\.\d+\.\d+)-Setup\.exe)\s*$/i.exec(line)
    return match ? [{ digest: match[1]!.toLowerCase(), name: match[2]!, version: match[3]! }] : []
  })
  if (matches.length !== 1) throw new DomainError('UNAVAILABLE', 'GitHub 最新版本的 SHA-256 校验文件不完整，已停止更新。')
  const { digest, name, version } = matches[0]!
  const tag = `v${version}`
  return {
    version,
    name: `PhD 科研工作台 ${version}`,
    url: trustedGithubUrl(`https://github.com/${owner}/${repository}/releases/tag/${tag}`, 'release'),
    publishedAt: null,
    installer: {
      name,
      size: null,
      url: trustedGithubUrl(`https://github.com/${owner}/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`, 'download'),
      sha256: digest
    },
    checksum: null
  }
}

type Fetcher = typeof fetch
function nestedErrorCode(error: unknown): string {
  let current: unknown = error
  for (let depth = 0; depth < 4 && current && typeof current === 'object'; depth += 1) {
    const code = 'code' in current && typeof current.code === 'string' ? current.code : ''
    if (code) return code.toUpperCase()
    current = 'cause' in current ? current.cause : null
  }
  return ''
}

export function connectionFailureMessage(error: unknown): string {
  const code = nestedErrorCode(error)
  const name = error instanceof Error ? error.name : ''
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return '无法解析 GitHub 地址，请检查 DNS 或网络连接。'
  if (['ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(code) || ['AbortError', 'TimeoutError'].includes(name))
    return '连接 GitHub 超时，请检查 Windows 系统代理、防火墙或网络连接。'
  if (['ECONNREFUSED', 'UND_ERR_SOCKET'].includes(code))
    return 'GitHub 连接被拒绝或中断，请检查 Windows 系统代理与防火墙。'
  if (code.includes('CERT') || code.includes('TLS') || code.includes('SELF_SIGNED'))
    return 'GitHub 证书验证失败，请检查系统时间、HTTPS 检查软件或单位网络证书。'
  const detail = error instanceof Error && error.message && !/^fetch failed$/i.test(error.message) ? `（${error.message}）` : ''
  return `无法连接 GitHub${detail}。请检查 Windows 系统代理、防火墙或 DNS 后重试。`
}

class GithubRateLimitError extends DomainError {
  constructor() {
    super('UNAVAILABLE', 'GitHub 暂时限制了匿名更新请求，请稍后重试；也可从项目发布页手动检查。')
  }
}
interface UpdateServiceOptions {
  currentVersion: string
  installable: boolean
  cacheDirectory: string
  getWindow: () => BrowserWindow | null
  quit: () => void
  fetcher?: Fetcher
  processId?: number
}

export class UpdateService {
  private readonly fetcher: Fetcher
  private readonly processId: number
  private release: GithubUpdateRelease | null = null
  private installerPath: string | null = null
  private installerDigest: string | null = null
  private operation: Promise<UpdateSnapshot> | null = null
  private current: UpdateSnapshot

  constructor(private readonly options: UpdateServiceOptions) {
    this.fetcher = options.fetcher ?? ((input, init) => fetch(input, init))
    this.processId = options.processId ?? process.pid
    this.current = {
      state: 'idle',
      currentVersion: options.currentVersion,
      latestVersion: null,
      releaseName: '',
      publishedAt: null,
      progress: null,
      installable: options.installable,
      message: '点击按钮后检查 GitHub 正式版。'
    }
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
      const response = await this.fetcher(url, {
        redirect: 'follow',
        headers: {
          Accept: accept,
          'User-Agent': `PhD-Research-Workbench/${this.options.currentVersion}`,
          'X-GitHub-Api-Version': '2022-11-28'
        },
        signal: AbortSignal.timeout(timeout)
      })
      if (!response.ok) {
        if (response.status === 403 || response.status === 429) throw new GithubRateLimitError()
        if (response.status === 404)
          throw new DomainError('UNAVAILABLE', 'GitHub 未找到所需的正式版更新文件（HTTP 404），请稍后重试或检查项目发布页。')
        if (response.status >= 500)
          throw new DomainError('UNAVAILABLE', `GitHub 服务暂时不可用（HTTP ${response.status}），请稍后重试。`)
        throw new DomainError('UNAVAILABLE', `GitHub 拒绝了更新请求（HTTP ${response.status}），请检查网络访问策略后重试。`)
      }
      return response
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', connectionFailureMessage(error))
    }
  }

  private async latestRelease(): Promise<GithubUpdateRelease> {
    try {
      const response = await this.request(latestReleaseApi, 20_000, 'application/vnd.github+json')
      return parseGithubRelease(await response.json())
    } catch (error) {
      if (!(error instanceof GithubRateLimitError)) throw error
      const response = await this.request(latestReleaseChecksum, 20_000, 'text/plain')
      const contents = await response.text()
      if (contents.length > 64 * 1024) throw new DomainError('UNAVAILABLE', 'GitHub 校验文件异常，已停止更新。')
      return parseChecksumRelease(contents)
    }
  }

  private async expectedDigest(release: GithubUpdateRelease): Promise<string> {
    if (release.installer.sha256) return release.installer.sha256
    if (!release.checksum) throw new DomainError('UNAVAILABLE', 'GitHub 发布缺少 SHA-256 校验信息，已拒绝下载。')
    const response = await this.request(release.checksum.url, 20_000, 'text/plain')
    const contents = await response.text()
    if (contents.length > 64 * 1024) throw new DomainError('UNAVAILABLE', 'GitHub 校验文件异常，已停止更新。')
    const digest = checksumForInstaller(contents, release.installer.name)
    if (!digest) throw new DomainError('UNAVAILABLE', '校验文件中没有当前安装包，已停止更新。')
    return digest
  }

  private async prepareInner(): Promise<UpdateSnapshot> {
    this.publish({ state: 'checking', progress: null, message: '正在连接 GitHub 检查最新版…' })
    try {
      const release = await this.latestRelease()
      this.release = release
      const comparison = compareVersions(release.version, this.options.currentVersion)
      if (comparison <= 0) {
        const message = comparison === 0
          ? `当前已是最新版 ${this.options.currentVersion}。`
          : `当前版本 ${this.options.currentVersion} 高于 GitHub 正式版 ${release.version}，无需更新。`
        return this.publish({ state: 'up-to-date', latestVersion: release.version, releaseName: release.name,
          publishedAt: release.publishedAt, progress: null, message })
      }
      if (!this.options.installable)
        return this.publish({ state: 'available', latestVersion: release.version, releaseName: release.name,
          publishedAt: release.publishedAt, progress: null, message: `发现 ${release.version}，请在打包后的 Windows 应用中安装。` })
      this.publish({ state: 'downloading', latestVersion: release.version, releaseName: release.name,
        publishedAt: release.publishedAt, progress: 0, message: `正在下载 ${release.version}…` })
      const expected = await this.expectedDigest(release)
      const path = await this.download(release.installer, expected)
      this.installerPath = path
      this.installerDigest = expected
      return this.publish({ state: 'ready', progress: 100, message: `${release.version} 已下载并通过 SHA-256 校验，可以安装。` })
    } catch (error) {
      const message = error instanceof DomainError ? error.message : '更新检查失败，请稍后重试。'
      this.release = null
      this.installerPath = null
      this.installerDigest = null
      this.publish({ state: 'error', progress: null, message })
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', message)
    }
  }

  private async download(asset: ReleaseAsset, expectedDigest: string): Promise<string> {
    if (basename(asset.name) !== asset.name || !installerPattern.test(asset.name))
      throw new DomainError('UNAVAILABLE', '安装包文件名不安全，已停止更新。')
    await mkdir(this.options.cacheDirectory, { recursive: true })
    const staleInstallerPattern = /^PhD-Research-Workbench-\d+\.\d+\.\d+-Setup\.exe(?:\.[a-f\d-]+\.part)?$/i
    await Promise.allSettled((await readdir(this.options.cacheDirectory))
      .filter((name) => name !== asset.name && staleInstallerPattern.test(name))
      .map((name) => rm(join(this.options.cacheDirectory, name), { force: true })))
    const destination = join(this.options.cacheDirectory, asset.name)
    const partial = `${destination}.${randomUUID()}.part`
    await rm(destination, { force: true })
    const response = await this.request(asset.url, 10 * 60_000, 'application/octet-stream')
    if (!response.body) throw new DomainError('UNAVAILABLE', 'GitHub 没有返回安装包内容。')
    const contentLength = response.headers.get('content-length')
    const responseSize = contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) : null
    if (responseSize !== null && (!Number.isSafeInteger(responseSize) || responseSize <= 0 || responseSize > 1_000_000_000))
      throw new DomainError('UNAVAILABLE', 'GitHub 返回的安装包大小异常，已停止更新。')
    if (asset.size !== null && responseSize !== null && responseSize !== asset.size)
      throw new DomainError('UNAVAILABLE', '下载文件大小与 GitHub 发布记录不一致。')
    const expectedSize = asset.size ?? responseSize
    const maximumSize = expectedSize ?? 1_000_000_000
    const handle = await open(partial, 'wx')
    const hash = createHash('sha256')
    let received = 0, lastProgress = -1
    try {
      const reader = response.body.getReader()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > maximumSize) throw new DomainError('UNAVAILABLE', '下载文件大小与 GitHub 发布记录不一致。')
        hash.update(value)
        await handle.write(value)
        const progress = expectedSize === null ? null : Math.min(99, Math.floor(received / expectedSize * 100))
        if (progress !== null && progress !== lastProgress) {
          lastProgress = progress
          this.publish({ state: 'downloading', progress, message: `正在下载 ${this.release?.version ?? '更新'}：${progress}%` })
        }
      }
      await handle.sync()
    } catch (error) {
      await handle.close()
      await rm(partial, { force: true })
      throw error
    }
    await handle.close()
    if (expectedSize !== null && received !== expectedSize) {
      await rm(partial, { force: true })
      throw new DomainError('UNAVAILABLE', '下载文件大小与 GitHub 发布记录不一致。')
    }
    if (hash.digest('hex') !== expectedDigest) {
      await rm(partial, { force: true })
      throw new DomainError('UNAVAILABLE', '安装包 SHA-256 校验失败，现有版本保持不变。')
    }
    await rename(partial, destination)
    if ((await stat(destination)).size !== received) {
      await rm(destination, { force: true })
      throw new DomainError('UNAVAILABLE', '安装包落盘校验失败，现有版本保持不变。')
    }
    return destination
  }

  async install(): Promise<void> {
    if (!this.options.installable || !this.installerPath || !this.installerDigest || !this.release || this.current.state !== 'ready')
      throw new DomainError('VALIDATION', '尚无已校验的更新安装包。')
    const installer = this.installerPath
    try {
      const expectedSize = this.release.installer.size
      if (expectedSize !== null && (await stat(installer)).size !== expectedSize) throw new Error('Installer size changed')
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(installer)) hash.update(chunk)
      if (hash.digest('hex') !== this.installerDigest) throw new Error('Installer digest changed')
    } catch {
      await rm(installer, { force: true })
      this.installerPath = null
      this.installerDigest = null
      this.publish({ state: 'error', progress: null, message: '安装前复核失败，请重新下载；现有版本保持不变。' })
      throw new DomainError('UNAVAILABLE', '安装前复核失败，请重新下载；现有版本保持不变。')
    }
    const script = join(this.options.cacheDirectory, `install-${randomUUID()}.ps1`)
    await writeFile(script, [
      'param([int]$TargetPid, [string]$InstallerPath)',
      'while (Get-Process -Id $TargetPid -ErrorAction SilentlyContinue) { Start-Sleep -Milliseconds 250 }',
      'try { Start-Process -FilePath $InstallerPath -Wait } finally {',
      '  Remove-Item -LiteralPath $InstallerPath -Force -ErrorAction SilentlyContinue',
      '  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
      '}'
    ].join('\r\n'), 'utf8')
    await new Promise<void>((resolve, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', script, '-TargetPid', String(this.processId), '-InstallerPath', installer
      ], { detached: true, stdio: 'ignore', windowsHide: true })
      child.once('spawn', () => { child.unref(); resolve() })
      child.once('error', reject)
    }).catch(async () => {
      await rm(script, { force: true })
      throw new DomainError('UNAVAILABLE', '无法启动系统安装程序，现有版本保持不变。')
    })
    this.publish({ state: 'installing', message: '正在保存并退出，随后将打开安装程序…' })
    setTimeout(() => this.options.quit(), 250)
  }
}
