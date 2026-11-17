import { spawn } from 'node:child_process'
import { codexTranslationStatus } from '../library/codex-translator'

export const codexWindowsInstaller = {
  executable: 'powershell.exe',
  args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', 'Invoke-RestMethod https://chatgpt.com/codex/install.ps1 | Invoke-Expression']
} as const

export async function installCodexCli() {
  const current = await codexTranslationStatus()
  if (current.installed) return current
  if (process.platform !== 'win32') throw new Error('当前版本仅支持在 Windows 中一键安装 Codex CLI。')

  await new Promise<void>((resolve, reject) => {
    const child = spawn(codexWindowsInstaller.executable, [...codexWindowsInstaller.args], {
      windowsHide: true,
      stdio: 'ignore',
      env: { ...process.env, CODEX_NON_INTERACTIVE: '1' }
    })
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error('Codex CLI 安装超时，请检查网络后重试。'))
    }, 10 * 60 * 1000)
    child.once('error', error => { clearTimeout(timer); reject(new Error(`无法启动安装程序：${error.message}`)) })
    child.once('close', code => {
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error('Codex CLI 安装未完成，请检查网络后重试。'))
    })
  })

  const installed = await codexTranslationStatus()
  if (!installed.installed) throw new Error('安装程序已结束，但尚未找到 Codex CLI。请重新打开工作台后检查。')
  return installed
}
