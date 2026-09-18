import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, lstatSync, readdirSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { TranslationRuntimeProfile } from '../../shared/translation'
import { EngineProgressDecoder, type EngineProgress } from './translation-progress'

const engineFlags = [
  'siliconflowfree', 'openai', 'aliyundashscope', 'google', 'bing', 'deepl', 'deepseek', 'ollama',
  'xinference', 'azureopenai', 'modelscope', 'zhipu', 'siliconflow', 'tencentmechinetranslation',
  'gemini', 'azure', 'anythingllm', 'dify', 'grok', 'groq', 'qwenmt', 'openaicompatible', 'claudecode'
]

function tomlString(value: string) {
  return JSON.stringify(value)
}

function setTomlField(source: string, section: string, key: string, value: string) {
  const lines = source.split(/\r?\n/)
  const sectionIndex = lines.findIndex((line) => line.trim() === `[${section}]`)
  if (sectionIndex < 0) throw new Error(`翻译引擎配置缺少 [${section}]。`)
  const nextSection = lines.findIndex((line, index) => index > sectionIndex && /^\s*\[[^\]]+\]\s*$/.test(line))
  const end = nextSection < 0 ? lines.length : nextSection
  const fieldIndex = lines.findIndex((line, index) => index > sectionIndex && index < end && new RegExp(`^\\s*${key}\\s*=`).test(line))
  const replacement = `${key} = ${tomlString(value)}`
  if (fieldIndex >= 0) lines[fieldIndex] = replacement
  else lines.splice(end, 0, replacement)
  return lines.join('\n')
}

export function applyTranslationProfileConfig(template: string, profile: TranslationRuntimeProfile) {
  const selectedFlag = profile.provider === 'openai-compatible' ? 'openaicompatible' : profile.provider
  let found = false
  const lines = template.split(/\r?\n/).map((line) => {
    const flag = line.match(/^\s*([a-z][a-z0-9_]*)\s*=\s*(?:true|false)(?:\s*#.*)?$/i)?.[1]?.toLowerCase()
    if (flag && engineFlags.includes(flag)) {
      if (flag === selectedFlag) found = true
      return `${flag} = ${flag === selectedFlag ? 'true' : 'false'}`
    }
    // Job copies must contain only the selected profile's secret, never unrelated keys from the engine template.
    if (/^\s*[a-z0-9_]*(?:api_key|apikey|secret_id|secret_key|auth_key|access_token)\s*=/i.test(line))
      return `${line.slice(0, line.indexOf('=')).trim()} = "null"`
    return line
  })
  if (!found) throw new Error(`翻译引擎配置不支持 ${profile.provider}。`)
  let configured = lines.join('\n')
  if (profile.provider === 'gemini') {
    configured = setTomlField(configured, 'gemini_detail', 'gemini_model', profile.model)
    configured = setTomlField(configured, 'gemini_detail', 'gemini_api_key', profile.apiKey)
  } else if (profile.provider === 'siliconflow') {
    configured = setTomlField(configured, 'siliconflow_detail', 'siliconflow_base_url', profile.baseUrl)
    configured = setTomlField(configured, 'siliconflow_detail', 'siliconflow_model', profile.model)
    configured = setTomlField(configured, 'siliconflow_detail', 'siliconflow_api_key', profile.apiKey)
  } else if (profile.provider === 'openai-compatible') {
    configured = setTomlField(configured, 'openaicompatible_detail', 'openai_compatible_base_url', profile.baseUrl)
    configured = setTomlField(configured, 'openaicompatible_detail', 'openai_compatible_model', profile.model)
    configured = setTomlField(configured, 'openaicompatible_detail', 'openai_compatible_api_key', profile.apiKey)
  }
  return configured
}

export function translatorExecutable(directory: string) {
  const candidates = [
    join(directory, 'zotero-pdf2zh-next-venv', 'Scripts', 'pdf2zh_next.exe'),
    join(directory, 'pdf2zh_next.exe'),
    join(directory, 'pdf2zh', 'pdf2zh_next.exe')
  ]
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) candidates.push(join(directory, entry.name, 'pdf2zh_next.exe'))
    }
  } catch { /* Health checks treat an unreadable directory as not installed. */ }
  for (const path of candidates) {
    try {
      const info = lstatSync(path)
      if (info.isFile() && !info.isSymbolicLink()) return path
    } catch { /* Keep checking supported layouts. */ }
  }
  return null
}

export function translationConfigTemplate(directory: string) {
  const external = join(directory, 'config', 'config.toml.example')
  if (existsSync(external)) return external
  const bundled = app.isPackaged
    ? join(process.resourcesPath, 'pdf2zh-config.toml.example')
    : join(app.getAppPath(), 'resources', 'pdf2zh-config.toml.example')
  return existsSync(bundled) ? bundled : null
}

export async function runTranslation(directory: string, source: string, output: string, profile: TranslationRuntimeProfile, onChild: (child: ChildProcess) => void, onProgress?: (value: EngineProgress) => void): Promise<string> {
  const executable = translatorExecutable(directory)
  if (!executable) throw new Error('未找到 pdf2zh_next 引擎，请在翻译设置中选择正确文件夹。')
  await mkdir(output, { recursive: true })
  // Each job gets its own configuration. Never run upstream's prepare_path(), which resets user configuration.
  const template = translationConfigTemplate(directory)
  const config = join(output, 'translation.toml')
  if (!template) throw new Error('工作台缺少 PDF2zh 配置模板，请重新安装工作台。')
  const configured = applyTranslationProfileConfig(await readFile(template, 'utf8'), profile)
  await writeFile(config, configured, { encoding: 'utf8', flag: 'wx' })
  // Select the translation service and model from the per-job profile configuration.
  const args = [source, '--qps', '8', '--output', output, '--lang-in', 'en', '--lang-out', 'zh-CN',
    '--config-file', config, '--watermark-output-mode', 'no_watermark', '--no-mono']
  const python = join(directory, 'zotero-pdf2zh-next-venv', 'Scripts', 'python.exe')
  const adapter = app.isPackaged ? join(process.resourcesPath, 'translation-progress.py') : join(app.getAppPath(), 'resources', 'translation-progress.py')
  const streamed = existsSync(python) && existsSync(adapter)
  return new Promise((resolve, reject) => {
    const child = spawn(streamed ? python : executable, streamed ? ['-u', adapter, ...args] : args, {
      cwd: streamed ? output : dirname(executable), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', NO_COLOR: '1' }
    })
    onChild(child)
    let log = ''
    const progress = new EngineProgressDecoder((value) => onProgress?.(value))
    const collect = (chunk: Buffer) => { log = (log + chunk.toString('utf8')).slice(-16000) }
    child.stdout?.on('data', (chunk: Buffer) => { collect(chunk); progress.write(chunk) }); child.stderr?.on('data', collect)
    const timer = setTimeout(() => {
      terminateTranslator(child)
      reject(new Error('翻译超过 30 分钟，原文已保存，请稍后重试。'))
    }, 30 * 60 * 1000)
    child.once('error', (error) => { clearTimeout(timer); reject(new Error(`无法启动翻译引擎：${error.message}`)) })
    child.once('close', (code) => {
      clearTimeout(timer)
      progress.end()
      if (code !== 0) {
        // eslint-disable-next-line no-control-regex -- Strip ANSI terminal color sequences from engine diagnostics.
        const lines = log.replace(/\u001b\[[\d;]*m/g, '').split(/\r?\n/).filter((line) => /error|exception|failed|失败/i.test(line))
        reject(new Error(lines.slice(-2).join(' ').slice(0, 500) || `翻译引擎退出（${code ?? '已中断'}）。请检查网络和翻译环境后重试。`))
      } else resolve(join(output, 'source.no_watermark.zh-CN.dual.pdf'))
    })
  })
}

export function terminateTranslator(child: ChildProcess) {
  if (!child.pid || child.exitCode !== null) return
  if (process.platform === 'win32') {
    // Only the process tree started for this owned translation job is terminated.
    const stop = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
    stop.on('error', () => { child.kill() })
  } else child.kill('SIGTERM')
}
