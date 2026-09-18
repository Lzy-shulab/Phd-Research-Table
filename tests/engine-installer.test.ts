import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/main/library/translator', () => ({
  translatorExecutable: (directory: string) => {
    const path = join(directory, 'pdf2zh_next.exe')
    return existsSync(path) ? path : null
  }
}))

import { TranslationEngineInstaller, type TranslationEngineSource } from '../src/main/library/engine-installer'

const roots: string[] = []
const sourceFor = (bytes: Uint8Array): TranslationEngineSource => ({
  version: 'test', archiveName: 'engine.zip', url: 'https://github.com/example/engine.zip',
  sha256: createHash('sha256').update(bytes).digest('hex'), maximumArchiveBytes: 1024
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('managed PDF2zh engine installation', () => {
  it('resumes a partial official download, verifies it and activates only the extracted engine', async () => {
    const root = mkdtempSync(join(tmpdir(), 'engine-installer-')); roots.push(root)
    const bytes = new TextEncoder().encode('verified engine archive')
    const source = sourceFor(bytes)
    const partial = join(root, `${source.archiveName}.part`)
    writeFileSync(partial, bytes.subarray(0, 8))
    const states: string[] = []
    const fetcher = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('range')).toBe('bytes=8-')
      return new Response(bytes.subarray(8), { status: 206, headers: {
        'content-length': String(bytes.length - 8), 'content-range': `bytes 8-${bytes.length - 1}/${bytes.length}`
      } })
    }) as typeof fetch
    const installer = new TranslationEngineInstaller({ rootDirectory: root, fetcher, source,
      onChange: (state) => states.push(state.state),
      extractor: async (_archive, destination) => { mkdirSync(destination, { recursive: true }); writeFileSync(join(destination, 'pdf2zh_next.exe'), 'engine') } })

    const installed = await installer.install()

    expect(installed).toBe(join(root, 'pdf2zh-test'))
    expect(existsSync(join(installed, 'pdf2zh_next.exe'))).toBe(true)
    expect(existsSync(partial)).toBe(false)
    expect(states).toEqual(expect.arrayContaining(['downloading', 'verifying', 'extracting', 'ready']))
    expect(installer.snapshot()).toMatchObject({ state: 'ready', progress: 100 })
  })

  it('rejects a digest mismatch without extracting or activating the download', async () => {
    const root = mkdtempSync(join(tmpdir(), 'engine-installer-')); roots.push(root)
    const expected = new TextEncoder().encode('expected')
    const received = new TextEncoder().encode('tampered')
    const extractor = vi.fn()
    const installer = new TranslationEngineInstaller({ rootDirectory: root,
      fetcher: vi.fn(async () => new Response(received, { status: 200, headers: { 'content-length': String(received.length) } })) as typeof fetch,
      source: sourceFor(expected), extractor })

    await expect(installer.install()).rejects.toThrow('SHA-256 校验失败')

    expect(extractor).not.toHaveBeenCalled()
    expect(existsSync(join(root, 'pdf2zh-test'))).toBe(false)
    expect(existsSync(join(root, 'engine.zip.part'))).toBe(false)
    expect(installer.snapshot().state).toBe('error')
  })

  it.runIf(process.platform === 'win32')('validates and extracts a small archive through the Windows safe extractor', async () => {
    const fixtureRoot = mkdtempSync(join(tmpdir(), 'engine-archive-fixture-')); roots.push(fixtureRoot)
    const root = mkdtempSync(join(tmpdir(), 'engine-installer-')); roots.push(root)
    const contents = join(fixtureRoot, 'contents'); mkdirSync(contents)
    writeFileSync(join(contents, 'pdf2zh_next.exe'), 'portable engine')
    const archive = join(fixtureRoot, 'fixture.zip')
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:WORKBENCH_TEST_ZIP_SOURCE, $env:WORKBENCH_TEST_ZIP_TARGET)'], {
      windowsHide: true, env: { ...process.env, WORKBENCH_TEST_ZIP_SOURCE: contents, WORKBENCH_TEST_ZIP_TARGET: archive }
    })
    const bytes = readFileSync(archive)
    const installer = new TranslationEngineInstaller({ rootDirectory: root,
      fetcher: vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } })) as typeof fetch,
      source: sourceFor(bytes) })

    const installed = await installer.install()

    expect(readFileSync(join(installed, 'pdf2zh_next.exe'), 'utf8')).toBe('portable engine')
  })
})
