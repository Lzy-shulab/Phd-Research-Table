import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, open, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { DomainError } from '../../domain/errors'
import type { TranslationEngineInstallation } from '../../shared/types'
import { connectionFailureMessage } from '../update/service'
import { translatorExecutable } from './translator'

export interface TranslationEngineSource {
  version: string
  archiveName: string
  url: string
  sha256: string
  maximumArchiveBytes: number
}

// Keep the exact upstream asset and digest pinned. A future upgrade must update both together.
export const officialTranslationEngine: TranslationEngineSource = {
  version: '2.9.0-babeldoc-0.6.4',
  archiveName: 'pdf2zh-v2.9.0-BabelDOC-v0.6.4-with-assets-win64.zip',
  url: 'https://github.com/PDFMathTranslate-next/PDFMathTranslate-next/releases/download/v2.9.0/pdf2zh-v2.9.0-BabelDOC-v0.6.4-with-assets-win64.zip',
  sha256: '6916a2f299b029cfb75803c780528088d93e7694d5597c4250ba2dcf5598f1d8',
  maximumArchiveBytes: 750_000_000
}

type Fetcher = typeof fetch
type Extractor = (archive: string, destination: string) => Promise<void>

interface TranslationEngineInstallerOptions {
  rootDirectory: string
  fetcher: Fetcher
  onChange?: (state: TranslationEngineInstallation) => void
  source?: TranslationEngineSource
  extractor?: Extractor
}

function contained(root: string, target: string) {
  const parent = resolve(root).toLowerCase()
  const child = resolve(target).toLowerCase()
  return child === parent || child.startsWith(`${parent}\\`)
}

async function removeOwned(root: string, target: string) {
  if (!contained(root, target) || resolve(root) === resolve(target))
    throw new Error('Refusing to remove a path outside the managed translation-engine directory.')
  await rm(target, { recursive: true, force: true })
}

async function sha256(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

function totalFromResponse(response: Response, offset: number) {
  const contentRange = response.headers.get('content-range')
  const range = contentRange?.match(/^bytes (\d+)-(\d+)\/(\d+)$/i)
  if (response.status === 206 && (!range || Number(range[1]) !== offset))
    throw new DomainError('UNAVAILABLE', '官方引擎断点响应无效，请重新安装。')
  if (range) return Number(range[3])
  const contentLength = response.headers.get('content-length')
  return contentLength && /^\d+$/.test(contentLength) ? Number(contentLength) + (response.status === 206 ? offset : 0) : null
}

async function defaultExtractor(archive: string, destination: string) {
  const script = join(dirname(destination), `extract-${randomUUID()}.ps1`)
  const body = [
    'param([string]$ArchivePath, [string]$DestinationPath)',
    "$ErrorActionPreference = 'Stop'",
    'Add-Type -AssemblyName System.IO.Compression.FileSystem',
    '$archive = [IO.Path]::GetFullPath($ArchivePath)',
    '$destination = [IO.Path]::GetFullPath($DestinationPath)',
    '$prefix = $destination.TrimEnd([IO.Path]::DirectorySeparatorChar) + [IO.Path]::DirectorySeparatorChar',
    '$zip = [IO.Compression.ZipFile]::OpenRead($archive)',
    'try {',
    '  [long]$total = 0',
    '  [int]$count = 0',
    '  foreach ($entry in $zip.Entries) {',
    '    $count += 1',
    '    $name = $entry.FullName.Replace("/", "\\")',
    '    if ([IO.Path]::IsPathRooted($name) -or $name.Contains(":")) { throw "Unsafe archive path" }',
    '    $target = [IO.Path]::GetFullPath([IO.Path]::Combine($destination, $name))',
    '    if (-not $target.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -and $target -ne $destination) { throw "Archive path escapes destination" }',
    '    $unixType = ($entry.ExternalAttributes -shr 16) -band 0xF000',
    '    if ($unixType -eq 0xA000) { throw "Archive contains a symbolic link" }',
    '    $total += $entry.Length',
    '    if ($count -gt 100000 -or $total -gt 3000000000) { throw "Archive expands beyond the safety limit" }',
    '  }',
    '} finally { $zip.Dispose() }',
    '[IO.Compression.ZipFile]::ExtractToDirectory($archive, $destination)'
  ].join('\r\n')
  await writeFile(script, body, 'utf8')
  try {
    await new Promise<void>((resolvePromise, reject) => {
      const child = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', script, '-ArchivePath', archive, '-DestinationPath', destination
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] })
      let error = ''
      child.stderr?.on('data', (chunk: Buffer) => { error = (error + chunk.toString('utf8')).slice(-2000) })
      child.once('error', reject)
      child.once('close', (code) => code === 0 ? resolvePromise() : reject(new Error(error.trim() || `解压程序退出（${code ?? '未知'}）。`)))
    })
  } finally {
    await rm(script, { force: true }).catch(() => undefined)
  }
}

export class TranslationEngineInstaller {
  private readonly source: TranslationEngineSource
  private readonly extractor: Extractor
  private operation: Promise<string> | null = null
  private abortController: AbortController | null = null
  private current: TranslationEngineInstallation = {
    state: 'idle', progress: null, downloadedBytes: 0, totalBytes: null,
    message: '尚未安装工作台托管的 PDF2zh 引擎。'
  }

  constructor(private readonly options: TranslationEngineInstallerOptions) {
    this.source = options.source ?? officialTranslationEngine
    this.extractor = options.extractor ?? defaultExtractor
  }

  snapshot(): TranslationEngineInstallation { return { ...this.current } }
  busy() { return this.operation !== null }
  managedDirectory() { return join(this.options.rootDirectory, `pdf2zh-${this.source.version}`) }

  private publish(patch: Partial<TranslationEngineInstallation>) {
    this.current = { ...this.current, ...patch }
    this.options.onChange?.(this.snapshot())
  }

  install(): Promise<string> {
    if (this.operation) return this.operation
    this.operation = this.installInner().finally(() => { this.operation = null; this.abortController = null })
    return this.operation
  }

  private async installInner() {
    const finalDirectory = this.managedDirectory()
    if (translatorExecutable(finalDirectory)) {
      this.publish({ state: 'ready', progress: 100, message: '官方 PDF2zh 引擎已安装。' })
      return finalDirectory
    }
    await mkdir(this.options.rootDirectory, { recursive: true })
    const archive = join(this.options.rootDirectory, `${this.source.archiveName}.part`)
    const staging = join(this.options.rootDirectory, `.installing-${this.source.version}`)
    this.abortController = new AbortController()
    try {
      await this.download(archive, this.abortController.signal)
      this.publish({ state: 'verifying', progress: 99, message: '正在核对官方引擎 SHA-256…' })
      if (await sha256(archive) !== this.source.sha256) {
        await removeOwned(this.options.rootDirectory, archive)
        throw new DomainError('UNAVAILABLE', '官方引擎 SHA-256 校验失败，未启用下载内容。')
      }
      await removeOwned(this.options.rootDirectory, staging)
      await mkdir(staging, { recursive: true })
      this.publish({ state: 'extracting', progress: null, message: '校验通过，正在解压官方引擎；这可能需要几分钟…' })
      await this.extractor(archive, staging)
      if (!translatorExecutable(staging)) throw new DomainError('UNAVAILABLE', '官方压缩包中未找到 pdf2zh_next.exe，未更改当前配置。')
      if (await stat(finalDirectory).then(() => true, () => false)) {
        const retained = join(this.options.rootDirectory, `retained-${this.source.version}-${Date.now()}`)
        await rename(finalDirectory, retained)
      }
      await rename(staging, finalDirectory)
      await removeOwned(this.options.rootDirectory, archive)
      this.publish({ state: 'ready', progress: 100, downloadedBytes: 0, totalBytes: null, message: '官方 PDF2zh 引擎安装完成。' })
      return finalDirectory
    } catch (error) {
      await removeOwned(this.options.rootDirectory, staging).catch(() => undefined)
      const message = error instanceof DomainError ? error.message
        : error instanceof Error && error.name === 'AbortError' ? '引擎安装已暂停；下次会从已下载位置继续。'
          : `PDF2zh 引擎安装失败：${error instanceof Error ? error.message : '未知错误'}`
      this.publish({ state: 'error', progress: null, message })
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', message)
    }
  }

  private async response(offset: number, signal: AbortSignal) {
    try {
      const response = await this.options.fetcher(this.source.url, {
        redirect: 'follow',
        headers: {
          Accept: 'application/octet-stream',
          'User-Agent': 'PhD-Research-Workbench/translation-engine',
          ...(offset ? { Range: `bytes=${offset}-` } : {})
        },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)])
      })
      if (response.status === 416 && offset) return response
      if (![200, 206].includes(response.status)) {
        if ([403, 429].includes(response.status)) throw new DomainError('UNAVAILABLE', 'GitHub 暂时限制了引擎下载，请稍后重试或使用“选择已有环境”。')
        if (response.status === 404) throw new DomainError('UNAVAILABLE', '官方 PDF2zh 引擎文件暂时不可用（HTTP 404）。')
        throw new DomainError('UNAVAILABLE', `官方 PDF2zh 引擎下载失败（HTTP ${response.status}）。`)
      }
      if (!response.body) throw new DomainError('UNAVAILABLE', '官方服务器没有返回引擎文件内容。')
      return response
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw new DomainError('UNAVAILABLE', connectionFailureMessage(error).replaceAll('GitHub', 'GitHub 官方引擎下载'))
    }
  }

  private async download(path: string, signal: AbortSignal) {
    let offset = await stat(path).then((value) => value.size, () => 0)
    if (offset < 0 || offset > this.source.maximumArchiveBytes) {
      await removeOwned(this.options.rootDirectory, path)
      offset = 0
    }
    if (offset && await sha256(path) === this.source.sha256) {
      this.publish({ state: 'verifying', progress: 99, downloadedBytes: offset, totalBytes: offset, message: '下载已完成，正在复核官方引擎…' })
      return
    }
    let response = await this.response(offset, signal)
    if (response.status === 416) {
      await removeOwned(this.options.rootDirectory, path)
      offset = 0
      response = await this.response(0, signal)
    }
    if (offset && response.status === 200) offset = 0
    const total = totalFromResponse(response, offset)
    if (total !== null && (!Number.isSafeInteger(total) || total <= 0 || total > this.source.maximumArchiveBytes))
      throw new DomainError('UNAVAILABLE', '官方引擎文件大小异常，已停止下载。')
    const handle = await open(path, offset ? 'a' : 'w')
    let received = offset
    try {
      this.publish({ state: 'downloading', progress: total ? Math.min(98, Math.floor(received / total * 100)) : null,
        downloadedBytes: received, totalBytes: total, message: offset ? '正在继续下载官方 PDF2zh 引擎…' : '正在下载官方 PDF2zh 引擎（约 592 MB）…' })
      const reader = response.body!.getReader()
      let lastProgress = -1
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        received += value.byteLength
        if (received > this.source.maximumArchiveBytes || (total !== null && received > total))
          throw new DomainError('UNAVAILABLE', '官方引擎下载大小超出预期，已停止下载。')
        await handle.write(value)
        const progress = total ? Math.min(98, Math.floor(received / total * 100)) : null
        if (progress !== lastProgress) {
          lastProgress = progress ?? -1
          this.publish({ state: 'downloading', progress, downloadedBytes: received, totalBytes: total,
            message: progress === null ? '正在下载官方 PDF2zh 引擎…' : `正在下载官方 PDF2zh 引擎：${progress}%` })
        }
      }
      await handle.sync()
    } finally { await handle.close() }
    if (total !== null && received !== total) throw new DomainError('UNAVAILABLE', '官方引擎下载不完整；下次安装会继续下载。')
  }

  stop() { this.abortController?.abort() }
}
