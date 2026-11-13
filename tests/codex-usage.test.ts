import { spawn } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { codexRailSummary, parseCodexUsage } from '../src/shared/codex-usage'
import { CodexUsageService } from '../src/main/widget/codex-usage-service'

const weekly = { usedPercent: 24, windowDurationMins: 10080, resetsAt: 1793851200 }

describe('Codex quota data', () => {
  it('reads a single weekly window and keeps unavailable reset information unknown', () => {
    const state = parseCodexUsage({ rateLimits: { primary: weekly } }, 123)
    expect(state.windows).toEqual([{ label: '本周', durationMinutes: 10080, remainingPercent: 76, resetsAt: 1793851200000 }])
    expect(state.availableResetCredits).toBeNull()
    expect(state.resetExpirations).toBeNull()
    expect(codexRailSummary(state)).toBe('周 76%')
  })

  it('uses the Codex bucket and orders short and weekly windows, including exhausted quota', () => {
    const state = parseCodexUsage({ rateLimitsByLimitId: {
      another: { primary: { ...weekly, usedPercent: 88 } },
      codex: { primary: weekly, secondary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1793800000 } }
    } })
    expect(state.windows.map(window => [window.label, window.remainingPercent])).toEqual([['5 小时', 0], ['本周', 76]])
    expect(codexRailSummary(state)).toBe('5h 0% / 周 76%')
  })

  it('keeps the authoritative count when expiry details are partial and sorts available credits', () => {
    const state = parseCodexUsage({ rateLimits: { primary: weekly }, rateLimitResetCredits: { availableCount: 4, credits: [
      { status: 'available', expiresAt: null }, { status: 'consumed', expiresAt: 1793000000 },
      { status: 'available', expiresAt: 1795000000 }, { status: 'available', expiresAt: 1794000000 }
    ] } })
    expect(state.availableResetCredits).toBe(4)
    expect(state.resetExpirations).toEqual([1794000000000, 1795000000000, null])
    const omitted = parseCodexUsage({ rateLimits: { primary: weekly }, rateLimitResetCredits: { availableCount: 4, credits: null } })
    expect(omitted.availableResetCredits).toBe(4)
    expect(omitted.resetExpirations).toBeNull()
  })

  it('does not turn a missing percentage or unsupported account into a zero balance', () => {
    const unknown = parseCodexUsage({ rateLimits: { primary: { ...weekly, usedPercent: null } } })
    expect(unknown.windows[0]?.remainingPercent).toBeNull()
    expect(codexRailSummary(unknown)).toBe('周 —')
    expect(() => parseCodexUsage({ rateLimits: null })).toThrow('暂无 ChatGPT 额度信息')
  })
})

it('shares one initialized process, preserves the last result after a read error, and reconnects', async () => {
  const source = `
    const readline = require('node:readline'); let initialized = false, reads = 0;
    readline.createInterface({ input: process.stdin }).on('line', line => {
      const m = JSON.parse(line);
      if(m.method === 'initialized') { initialized = true; return; }
      if(m.method === 'initialize') { process.stdout.write(JSON.stringify({ id:m.id, result:{} })+'\\n'); return; }
      if(m.method !== 'account/rateLimits/read' || !initialized || m.params.excludeResetCreditDetails !== false) {
        process.stdout.write(JSON.stringify({ id:m.id, error:{message:'Unexpected request'} })+'\\n'); return;
      }
      process.stdout.write(JSON.stringify(++reads === 2 ? {id:m.id,error:{message:'Not authorized'}} :
        {id:m.id,result:{rateLimits:{primary:${JSON.stringify(weekly)}},rateLimitResetCredits:{availableCount:2,credits:null}}})+'\\n');
    });`
  let launches = 0, changes = 0
  const service = new CodexUsageService(() => { changes++ }, () => { launches++; return spawn(process.execPath, ['-e', source], { stdio: 'pipe', windowsHide: true }) })
  try {
    const first = service.read(true), duplicate = service.read(true)
    expect(duplicate).toBe(first)
    const state = await first
    expect(state.error).toBeNull()
    expect(state.windows[0]?.remainingPercent).toBe(76)
    expect(launches).toBe(1)
    expect(changes).toBe(1)
    const failed = await service.read(true)
    expect(failed.windows).toEqual(state.windows)
    expect(failed.updatedAt).toBe(state.updatedAt)
    expect(failed.error).toContain('登录')
    expect(codexRailSummary(failed)).toBe('待更新')
    expect((await service.read(true)).error).toBeNull()
    expect(launches).toBe(2)
    service.setActive(false)
    expect((await service.read()).windows).toEqual(state.windows)
    expect(launches).toBe(2)
    expect((await service.read(true)).error).toBeNull()
    expect(launches).toBe(3)
  } finally { service.stop() }
}, 10000)
