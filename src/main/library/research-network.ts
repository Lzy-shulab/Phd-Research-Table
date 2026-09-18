import { session } from 'electron'
import { setTimeout as delay } from 'node:timers/promises'
const hosts = new Set(['arxiv.org', 'export.arxiv.org', 'api.crossref.org', 'sentences-bundle.hitokoto.cn'])
const arxivHosts = new Set(['arxiv.org', 'export.arxiv.org'])
const directUntil = new Map<string, number>()
let directSession: Promise<Electron.Session> | undefined
const transientConnection = (error: unknown) => error instanceof Error && /ERR_(?:CONNECTION_(?:CLOSED|RESET|REFUSED|TIMED_OUT)|TIMED_OUT|PROXY_CONNECTION_FAILED|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_FAILED|NAME_NOT_RESOLVED)|fetch failed/i.test(error.message)

function directResearchSession() {
  directSession ??= (async () => {
    const network = session.fromPartition('workbench-research-direct')
    await network.setProxy({ mode: 'direct' })
    return network
  })().catch((error: unknown) => { directSession = undefined; throw error })
  return directSession
}
// A dedicated, memory-only session keeps research requests separate from the renderer's local-only session.
export async function researchFetch(url: string, init: RequestInit) {
  const target = new URL(url)
  if (target.protocol !== 'https:' || !hosts.has(target.hostname) || target.username || target.password) throw new Error('不支持此研究数据来源。')
  const system = session.fromPartition('workbench-research')
  const options = { ...init, redirect: 'error' as const }
  if (!arxivHosts.has(target.hostname)) return system.fetch(url, options)
  init.signal?.throwIfAborted()
  const useDirect = (directUntil.get(target.hostname) ?? 0) > Date.now()
  const started = Date.now()
  try {
    return await (useDirect ? await directResearchSession() : system).fetch(url, options)
  } catch (error) {
    // Retry only transport failures. HTTP refusals, certificate errors and cancellation
    // must never be bypassed. The system proxy and renderer session remain unchanged.
    if (init.signal?.aborted || !transientConnection(error)) throw error
    const proxy = await system.resolveProxy(url)
    if (!/(?:PROXY|HTTPS|SOCKS\d?)\s/i.test(proxy)) throw error
    await delay(Math.max(0, 3100 - (Date.now() - started)), undefined, { signal: init.signal ?? undefined })
    init.signal?.throwIfAborted()
    const alternate = useDirect ? system : await directResearchSession()
    const response = await alternate.fetch(url, options)
    if (response.ok) {
      if (useDirect) directUntil.delete(target.hostname)
      else directUntil.set(target.hostname, Date.now() + 10 * 60_000)
    }
    return response
  }
}
