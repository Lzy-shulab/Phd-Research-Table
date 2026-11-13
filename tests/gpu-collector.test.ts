import { afterEach, describe, expect, it, vi } from 'vitest'

const { execFile } = vi.hoisted(() => ({ execFile: vi.fn() }))
vi.mock('node:child_process', () => ({ execFile }))
import { collectRemoteGpu } from '../src/main/widget/gpu-collector'

function response(error: (Error & { code?: number | string; killed?: boolean }) | null, stdout = '', stderr = '') {
  const end = vi.fn()
  execFile.mockImplementation((_file: string, _args: string[], _options: unknown,
    callback: (error: Error | null, stdout: string, stderr: string) => void) => {
    queueMicrotask(() => callback(error, stdout, stderr))
    return { stdin: { on: vi.fn(), end } }
  })
  return end
}

afterEach(() => { vi.resetAllMocks() })

describe('remote GPU collection', () => {
  it('runs the current collector through noninteractive SSH and parses its fresh result', async () => {
    const snapshot = { server_id: 'yunbensheng', gpus: [{ index: 0, utilization: 73 }] }
    const end = response(null, JSON.stringify(snapshot))
    expect(await collectRemoteGpu()).toEqual(snapshot)
    expect(execFile.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(['BatchMode=yes', 'YunBensheng', 'python3', '-']))
    expect(end).toHaveBeenCalledWith(expect.stringContaining("'--dry-run'"))
  })

  it.each([
    ['Host key verification failed.', 255, 'SSH 主机密钥验证失败'],
    ['Permission denied (publickey).', 255, 'SSH 身份验证失败'],
    ['Connection timed out', 255, '实时采集超时'],
    ['Connection refused', 255, '请刷新 Cpolar 地址'],
    ['subprocess.CalledProcessError', 1, '远端 GPU 采集失败']
  ])('reports the cause of %s', async (stderr, code, message) => {
    response(Object.assign(new Error('command failed'), { code }), '', stderr)
    await expect(collectRemoteGpu()).rejects.toThrow(message)
  })

  it('rejects an invalid collector response', async () => {
    response(null, 'not JSON')
    await expect(collectRemoteGpu()).rejects.toThrow('远端未返回有效的本次 GPU 采集结果')
  })
})
