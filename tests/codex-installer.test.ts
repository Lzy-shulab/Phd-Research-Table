import { describe, expect, it } from 'vitest'
import { codexWindowsInstaller } from '../src/main/assistant/codex-installer'

describe('Codex CLI installer', () => {
  it('uses the official Windows standalone installer without requiring npm', () => {
    expect(codexWindowsInstaller.executable).toBe('powershell.exe')
    expect(codexWindowsInstaller.args).toEqual([
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command',
      'Invoke-RestMethod https://chatgpt.com/codex/install.ps1 | Invoke-Expression'
    ])
  })
})
