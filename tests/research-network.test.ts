import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const network = vi.hoisted(() => ({ system: { fetch: vi.fn(), resolveProxy: vi.fn() }, direct: { fetch: vi.fn(), setProxy: vi.fn() }, fromPartition: vi.fn() }))
vi.mock('electron', () => ({ session: { fromPartition: network.fromPartition } }))
vi.mock('node:timers/promises', () => ({ setTimeout: vi.fn(async (_ms, _value, options) => options?.signal?.throwIfAborted()) }))

beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks()
  network.fromPartition.mockImplementation((name: string) => name.endsWith('-direct') ? network.direct : network.system)
  network.system.resolveProxy.mockResolvedValue('PROXY 127.0.0.1:7897')
  network.direct.setProxy.mockResolvedValue(undefined)
})
afterEach(() => vi.restoreAllMocks())

describe('arXiv transport recovery', () => {
  it('recovers a closed system proxy connection and remembers the working route without changing system settings', async () => {
    const { researchFetch } = await import('../src/main/library/research-network')
    network.system.fetch.mockRejectedValue(new Error('net::ERR_CONNECTION_CLOSED'))
    network.direct.fetch.mockImplementation(async () => new Response('<feed/>'))
    for (let i = 0; i < 2; i++) expect((await researchFetch('https://export.arxiv.org/api/query', {})).ok).toBe(true)
    expect(network.system.fetch).toHaveBeenCalledTimes(1)
    expect(network.direct.fetch).toHaveBeenCalledTimes(2)
    expect(network.direct.setProxy).toHaveBeenCalledExactlyOnceWith({ mode: 'direct' })
    expect(network.direct.fetch).toHaveBeenCalledWith('https://export.arxiv.org/api/query', { redirect: 'error' })
  })
  it('does not retry HTTP rate limiting, certificate failures, or cancellation', async () => {
    const { researchFetch } = await import('../src/main/library/research-network')
    network.system.fetch.mockResolvedValueOnce(new Response('rate limit', { status: 429 }))
    expect((await researchFetch('https://export.arxiv.org/api/query', {})).status).toBe(429)
    network.system.fetch.mockRejectedValueOnce(new Error('net::ERR_CERT_AUTHORITY_INVALID'))
    await expect(researchFetch('https://arxiv.org/pdf/2609.00001', {})).rejects.toThrow('CERT')
    const controller = new AbortController()
    network.system.fetch.mockImplementationOnce(async () => { controller.abort(); throw new Error('net::ERR_CONNECTION_CLOSED') })
    await expect(researchFetch('https://export.arxiv.org/api/query', { signal: controller.signal })).rejects.toThrow()
    expect(network.direct.fetch).not.toHaveBeenCalled()
  })
  it('keeps other research providers on their existing route and rejects unsupported destinations', async () => {
    const { researchFetch } = await import('../src/main/library/research-network')
    network.system.fetch.mockRejectedValue(new Error('net::ERR_CONNECTION_CLOSED'))
    await expect(researchFetch('https://api.crossref.org/works', {})).rejects.toThrow('CLOSED')
    await expect(researchFetch('https://example.com/query', {})).rejects.toThrow('来源')
    expect(network.direct.fetch).not.toHaveBeenCalled()
  })
  it('does not waste a second identical route when no proxy is configured', async () => {
    const { researchFetch } = await import('../src/main/library/research-network')
    network.system.resolveProxy.mockResolvedValue('DIRECT')
    network.system.fetch.mockRejectedValue(new Error('net::ERR_CONNECTION_RESET'))
    await expect(researchFetch('https://export.arxiv.org/api/query', {})).rejects.toThrow('RESET')
    expect(network.direct.fetch).not.toHaveBeenCalled()
  })
})
