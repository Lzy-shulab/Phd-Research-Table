export const translationSteps = [
  { id: 'prepare', label: '准备资源' },
  { id: 'parse', label: '解析文献' },
  { id: 'translate', label: '翻译正文' },
  { id: 'typeset', label: '排版与字体' },
  { id: 'write', label: '生成对照 PDF' }
] as const
export type TranslationStep = (typeof translationSteps)[number]['id']

export function translationStepForStage(stage: string): TranslationStep | undefined {
  if (/启动|准备/.test(stage)) return 'prepare'
  if (/解析|检测|识别|整理段落/.test(stage)) return 'parse'
  if (/翻译正文|提取专业术语/.test(stage)) return 'translate'
  if (/排版|嵌入字体/.test(stage)) return 'typeset'
  if (/生成中英对照|校验中英对照/.test(stage)) return 'write'
  return undefined
}
