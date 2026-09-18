import { StringDecoder } from 'node:string_decoder'

export interface EngineProgress {
  stage: string
  percent: number | null
  current: number | null
  total: number | null
}
const stages: Record<string, string> = {
  'Preparing translation engine': '正在启动翻译引擎',
  'Preparing translation resources': '正在准备字体与翻译资源',
  'Parse PDF and Create Intermediate Representation': '正在解析 PDF',
  'DetectScannedFile': '正在检测页面内容',
  'Parse Page Layout': '正在识别页面布局',
  'Parse Table': '正在解析表格',
  'Parse Paragraphs': '正在整理段落',
  'Parse Formulas and Styles': '正在识别公式与样式',
  'Automatic Term Extraction': '正在提取专业术语',
  'Translate Paragraphs': '正在翻译正文',
  'Typesetting': '正在排版译文',
  'Add Fonts': '正在嵌入字体',
  'Generate drawing instructions': '正在生成中英对照 PDF',
  'Verifying bilingual PDF': '正在校验中英对照 PDF'
}
const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
export function parseEngineProgress(line: string): EngineProgress | null {
  const prefix = '@@WORKBENCH_PROGRESS@@'
  if (!line.startsWith(prefix)) return null
  try {
    const value = JSON.parse(line.slice(prefix.length)) as Record<string, unknown>
    if (!value || typeof value.stage !== 'string') return null
    const rawPercent = count(value.percent)
    return {
      stage: stages[value.stage] ?? '正在处理文献',
      // 100% is only shown after the main process validates and attaches the output PDF.
      percent: rawPercent === null ? null : Math.min(99, Math.floor(rawPercent)),
      current: count(value.current), total: count(value.total)
    }
  } catch { return null }
}
export class EngineProgressDecoder {
  private decoder = new StringDecoder('utf8')
  private pending = ''
  constructor(private readonly onProgress: (value: EngineProgress) => void) {}
  write(chunk: Buffer) { this.collect(this.decoder.write(chunk)) }
  end() { this.collect(`${this.decoder.end()}\n`) }
  private collect(text: string) {
    this.pending += text
    const lines = this.pending.split(/\r?\n/)
    this.pending = (lines.pop() ?? '').slice(-64000)
    for (const line of lines) {
      const event = parseEngineProgress(line)
      if (event) this.onProgress(event)
    }
  }
}
