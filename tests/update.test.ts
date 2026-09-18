import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { checksumForInstaller, compareVersions, connectionFailureMessage, latestReleaseApi, latestReleaseChecksum, parseChecksumRelease, parseGithubRelease, parseVersion, UpdateService } from '../src/main/update/service'

const assetUrl = 'https://github.com/Lzy-shulab/Phd-Research-Table/releases/download/v0.8.0/PhD-Research-Workbench-0.8.0-Setup.exe'

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: 'v0.8.0', name: 'PhD 科研工作台 0.8.0',
    html_url: 'https://github.com/Lzy-shulab/Phd-Research-Table/releases/tag/v0.8.0',
    published_at: '2026-09-10T00:00:00Z', draft: false, prerelease: false,
    assets: [{ name: 'PhD-Research-Workbench-0.8.0-Setup.exe', size: 4, browser_download_url: assetUrl,
      digest: `sha256:${createHash('sha256').update('safe').digest('hex')}` }], ...overrides
  }
}

describe('GitHub workbench updates', () => {
  it('turns transport causes into actionable proxy, DNS, timeout, and certificate messages', () => {
    const failure = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: { code } })
    expect(connectionFailureMessage(failure('ETIMEDOUT'))).toContain('系统代理')
    expect(connectionFailureMessage(failure('ENOTFOUND'))).toContain('DNS')
    expect(connectionFailureMessage(failure('SELF_SIGNED_CERT_IN_CHAIN'))).toContain('证书')
    expect(connectionFailureMessage(new TypeError('fetch failed'))).not.toContain('fetch failed')
  })
  it('compares only stable three-part versions', () => {
    expect(parseVersion('v0.7.2')).toEqual([0, 7, 2])
    expect(parseVersion('0.7')).toBeNull()
    expect(compareVersions('0.8.0', '0.7.9')).toBe(1)
    expect(compareVersions('0.7.2', '0.7.2')).toBe(0)
    expect(compareVersions('0.7.1', '0.7.2')).toBe(-1)
  })

  it('accepts only the fixed repository, matching tag and Windows installer', () => {
    expect(parseGithubRelease(release())).toMatchObject({ version: '0.8.0', installer: { name: 'PhD-Research-Workbench-0.8.0-Setup.exe', size: 4 } })
    expect(() => parseGithubRelease(release({ html_url: 'https://example.org/releases/v0.8.0' }))).toThrow('不受信任')
    expect(() => parseGithubRelease(release({ tag_name: 'v0.8.1' }))).toThrow('匹配')
    expect(() => parseGithubRelease(release({ prerelease: true }))).toThrow('不完整')
  })

  it('reads a checksum only for the exact installer filename', () => {
    const digest = 'a'.repeat(64)
    expect(checksumForInstaller(`${digest}  PhD-Research-Workbench-0.8.0-Setup.exe\n`, 'PhD-Research-Workbench-0.8.0-Setup.exe')).toBe(digest)
    expect(checksumForInstaller(`${digest}  another.exe\n`, 'PhD-Research-Workbench-0.8.0-Setup.exe')).toBeNull()
  })

  it('derives a fixed-repository release from one exact checksummed installer', () => {
    const digest = 'b'.repeat(64)
    expect(parseChecksumRelease(`${digest} *PhD-Research-Workbench-0.8.0-Setup.exe\n`)).toMatchObject({
      version: '0.8.0', publishedAt: null,
      installer: { name: 'PhD-Research-Workbench-0.8.0-Setup.exe', size: null, sha256: digest }
    })
    expect(() => parseChecksumRelease(`${digest}  another.exe\n`)).toThrow('校验文件不完整')
    expect(() => parseChecksumRelease(`${digest} *PhD-Research-Workbench-0.8.0-Setup.exe\n${digest} *PhD-Research-Workbench-0.8.1-Setup.exe\n`)).toThrow('校验文件不完整')
  })

  it('falls back to the latest release checksum when the GitHub API is rate limited', async () => {
    const digest = createHash('sha256').update('safe').digest('hex')
    const fallbackAsset = 'https://github.com/Lzy-shulab/Phd-Research-Table/releases/download/v0.8.0/PhD-Research-Workbench-0.8.0-Setup.exe'
    const calls: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input); calls.push(url)
      if (url === latestReleaseApi) return new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } })
      if (url === latestReleaseChecksum) return new Response(`${digest} *PhD-Research-Workbench-0.8.0-Setup.exe\n`, { status: 200 })
      if (url === fallbackAsset) return new Response(new TextEncoder().encode('safe'), { status: 200, headers: { 'content-length': '4' } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const directory = mkdtempSync(join(tmpdir(), 'workbench-update-fallback-'))
    try {
      const service = new UpdateService({ currentVersion: '0.7.2', installable: true, cacheDirectory: directory,
        getWindow: () => null, quit: () => undefined, fetcher })
      await expect(service.prepare()).resolves.toMatchObject({ state: 'ready', latestVersion: '0.8.0', progress: 100 })
      expect(readFileSync(join(directory, 'PhD-Research-Workbench-0.8.0-Setup.exe'), 'utf8')).toBe('safe')
      expect(calls).toEqual([latestReleaseApi, latestReleaseChecksum, fallbackAsset])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('downloads to an isolated cache and exposes ready only after size and SHA-256 match', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workbench-update-'))
    const calls: string[] = []
    const fetcher = (async (input: string | URL | Request) => {
      const url = String(input); calls.push(url)
      if (url === latestReleaseApi) return new Response(JSON.stringify(release()), { status: 200 })
      if (url === assetUrl) return new Response(new TextEncoder().encode('safe'), { status: 200 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    try {
      writeFileSync(join(directory, 'PhD-Research-Workbench-0.7.1-Setup.exe'), 'old')
      writeFileSync(join(directory, 'do-not-delete.txt'), 'user file')
      const service = new UpdateService({ currentVersion: '0.7.2', installable: true, cacheDirectory: directory,
        getWindow: () => null, quit: () => undefined, fetcher })
      const snapshot = await service.prepare()
      expect(snapshot).toMatchObject({ state: 'ready', latestVersion: '0.8.0', progress: 100 })
      expect(readFileSync(join(directory, 'PhD-Research-Workbench-0.8.0-Setup.exe'), 'utf8')).toBe('safe')
      expect(existsSync(join(directory, 'PhD-Research-Workbench-0.7.1-Setup.exe'))).toBe(false)
      expect(readFileSync(join(directory, 'do-not-delete.txt'), 'utf8')).toBe('user file')
      expect(calls).toEqual([latestReleaseApi, assetUrl])
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('keeps the current version when the downloaded bytes fail verification', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workbench-update-bad-'))
    const fetcher = (async (input: string | URL | Request) => String(input) === latestReleaseApi
      ? new Response(JSON.stringify(release()), { status: 200 })
      : new Response(new TextEncoder().encode('evil'), { status: 200 })) as typeof fetch
    try {
      const service = new UpdateService({ currentVersion: '0.7.2', installable: true, cacheDirectory: directory,
        getWindow: () => null, quit: () => undefined, fetcher })
      await expect(service.prepare()).rejects.toThrow('SHA-256')
      expect(service.snapshot()).toMatchObject({ state: 'error' })
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })

  it('rechecks the downloaded installer immediately before launch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'workbench-update-tamper-'))
    const fetcher = (async (input: string | URL | Request) => String(input) === latestReleaseApi
      ? new Response(JSON.stringify(release()), { status: 200 })
      : new Response(new TextEncoder().encode('safe'), { status: 200 })) as typeof fetch
    let quit = false
    try {
      const service = new UpdateService({ currentVersion: '0.7.2', installable: true, cacheDirectory: directory,
        getWindow: () => null, quit: () => { quit = true }, fetcher })
      await service.prepare()
      writeFileSync(join(directory, 'PhD-Research-Workbench-0.8.0-Setup.exe'), 'evil')
      await expect(service.install()).rejects.toThrow('安装前复核失败')
      expect(service.snapshot()).toMatchObject({ state: 'error' })
      expect(quit).toBe(false)
    } finally { rmSync(directory, { recursive: true, force: true }) }
  })
})
