import type { GpuMonitorSnapshot } from '../shared/gpu'

export const cpolarSshHost = 'YunBensheng'
export const cpolarSshInterval = 5 * 60 * 60 * 1000

export function cpolarSshEndpoint(source: GpuMonitorSnapshot['cpolar']) {
  if (source.error) throw new Error(source.error)
  const tunnels = source.tunnels.filter(tunnel => tunnel.name.toLowerCase() === 'ssh' && tunnel.protocol === 'tcp')
  if (tunnels.length !== 1) throw new Error('未找到唯一的 ssh 隧道，请检查 Cpolar 看板。')
  const tunnel = tunnels[0]!
  if (tunnel.status !== 'online') throw new Error('ssh 隧道暂未在线，保留原 SSH 配置。')
  const url = new URL(tunnel.url)
  const port = Number(url.port)
  if (url.protocol !== 'tcp:' || !/^[a-z\d.-]+$/i.test(url.hostname) || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('ssh 隧道地址不完整，保留原 SSH 配置。')
  }
  return { hostname: url.hostname, port: String(port) }
}

// Preserve other hosts, comments, credentials and the file's line endings.
export function updateSshConfig(content: string, endpoint: { hostname: string; port: string }, host = cpolarSshHost) {
  const lines = content.match(/[^\n]*\n|[^\n]+$/g) ?? []
  const boundaries = lines.flatMap((line, index) => {
    const match = line.replace(/^\uFEFF/, '').match(/^[\t ]*(Host|Match)(?:\s+|=)(.*)/i)
    return match ? [{ index, kind: match[1]!.toLowerCase(), value: match[2]!.split('#')[0]!.trim().replace(/^"(.*)"$/, '$1') }] : []
  })
  const targets = boundaries.filter(block => block.kind === 'host' && block.value.toLowerCase() === host.toLowerCase())
  if (targets.length !== 1) throw new Error(`SSH 配置中需要有独立的 Host ${host}，请检查配置文件。`)
  const start = targets[0]!.index
  const end = boundaries.find(block => block.index > start)?.index ?? lines.length
  const block = lines.slice(start, end)
  const newline = content.includes('\r\n') ? '\r\n' : '\n'
  for (const [key, value] of [['HostName', endpoint.hostname], ['Port', endpoint.port]]) {
    const pattern = new RegExp(`^([\\t ]*${key}(?:[\\t ]*=[\\t ]*|[\\t ]+))(?:"[^"]*"|[^\\s#]+)([^\\r\\n]*)(\\r?\\n)?$`, 'i')
    let found = false
    for (let i = 1; i < block.length; i++) {
      if (!pattern.test(block[i]!)) continue
      block[i] = block[i]!.replace(pattern, (_match, prefix: string, suffix: string, eol = '') => `${prefix}${value}${suffix}${eol}`)
      found = true
    }
    if (!found) {
      if (!block[0]!.endsWith('\n')) block[0] += newline
      block.splice(1, 0, `    ${key} ${value}${newline}`)
    }
  }
  return [...lines.slice(0, start), ...block, ...lines.slice(end)].join('')
}
