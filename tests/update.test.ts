import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { compareVersions, connectionFailureMessage, latestReleaseApi, latestUpdateManifest, parseGithubRelease, parseVersion, UpdateService } from '../src/main/update/service'

const base = 'https://github.com/Lzy-shulab/Phd-Research-Table/releases'
const packageName = 'PhD-Research-Workbench-0.8.26-Update.zip'
function release(withPackage = true) {
  return { tag_name: 'v0.8.26', name: 'Workbench 0.8.26', html_url: `${base}/tag/v0.8.26`, published_at: null, draft: false, prerelease: false,
    assets: [{ name: 'PhD-Research-Workbench-0.8.26-Setup.exe', size: 4, browser_download_url: `${base}/download/v0.8.26/PhD-Research-Workbench-0.8.26-Setup.exe` },
      ...(withPackage ? [{ name: packageName, size: 4, browser_download_url: `${base}/download/v0.8.26/${packageName}` }] : [])] }
}
function setup({ truncated = false, limited = false, withPackage = true } = {}) {
  mkdirSync(resolve('test-results'), { recursive: true })
  const directory = mkdtempSync(resolve('test-results/update-unit-'))
  const calls: string[] = []
  const fetcher = (async (input: string | URL | Request) => {
    const url = String(input); calls.push(url)
    if (url === latestReleaseApi && limited) return new Response('', { status: 403 })
    if (url === latestReleaseApi || url === latestUpdateManifest) return new Response(JSON.stringify(release(withPackage)))
    return new Response(truncated ? 'zip' : 'zip!')
  }) as typeof fetch
  const launchHelper = vi.fn<(script: string, args: string[]) => Promise<void>>().mockResolvedValue(undefined), quit = vi.fn()
  const service = new UpdateService({ currentVersion: '0.8.25', installable: true, cacheDirectory: directory,
    executablePath: join(directory, 'Workbench.exe'), helperPath: resolve('resources/apply-update.ps1'),
    getWindow: () => null, quit, launchHelper, fetcher })
  return { directory, calls, service, quit, launchHelper }
}
describe('application updates', () => {
  it('compares stable versions and parses the matching runtime package', () => {
    expect(parseVersion('v0.8.25')).toEqual([0, 8, 25])
    expect(parseVersion('0.8')).toBeNull()
    expect(compareVersions('0.8.26', '0.8.25')).toBe(1)
    expect(parseGithubRelease(release()).updatePackage?.name).toBe(packageName)
  })
  it('reports actionable transport failures', () => {
    expect(connectionFailureMessage(Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }))).toContain('DNS')
  })
  it('downloads the runtime archive and schedules an in-place restart without a setup wizard', async () => {
    const { directory, calls, service, quit, launchHelper } = setup()
    writeFileSync(join(directory, 'unrelated.txt'), 'keep')
    expect(await service.prepare()).toMatchObject({ state: 'ready', progress: 100 })
    const cached = readdirSync(directory).find(name => existsSync(join(directory, name, packageName)))!
    expect(readFileSync(join(directory, cached, packageName), 'utf8')).toBe('zip!')
    await service.install()
    expect(launchHelper).toHaveBeenCalledOnce()
    expect(launchHelper.mock.calls[0]?.[1]).toContain('-InstallDirectory')
    expect(calls.some(url => url.endsWith('-Setup.exe'))).toBe(false)
    expect(readFileSync(join(directory, 'unrelated.txt'), 'utf8')).toBe('keep')
    await vi.waitFor(() => expect(quit).toHaveBeenCalledOnce())
  })
  it('uses the public update manifest when the release API is limited', async () => {
    const { service, calls } = setup({ limited: true })
    expect(await service.prepare()).toMatchObject({ state: 'ready' })
    expect(calls.slice(0, 2)).toEqual([latestReleaseApi, latestUpdateManifest])
  })
  it('rejects interrupted downloads without quitting', async () => {
    const { service, quit } = setup({ truncated: true })
    await expect(service.prepare()).rejects.toThrow('下载不完整')
    expect(service.snapshot().state).toBe('error'); expect(quit).not.toHaveBeenCalled()
  })
  it('does not launch the installer when an older release has no runtime archive', async () => {
    const { service, calls } = setup({ withPackage: false })
    expect(await service.prepare()).toMatchObject({ state: 'available' })
    expect(calls).toEqual([latestReleaseApi])
  })
})
