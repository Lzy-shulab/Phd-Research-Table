import { z } from 'zod'
import { assistantProviders, siliconFlowAssistantEndpoint, siliconFlowAssistantModel } from '../shared/assistant'
import { idSchema, taskCreateSchema, validateSchedule } from './validation'
import { DomainError } from './errors'

export function completionEndpoint(baseUrl: string): string {
  let url: URL
  try { url = new URL(baseUrl) } catch { throw new DomainError('VALIDATION', '请输入完整的 API 地址。') }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) || url.username || url.password || url.search || url.hash)
    throw new DomainError('VALIDATION', 'API 地址须使用 HTTPS；本机服务可使用 HTTP。地址中不要附带密钥或查询参数。')
  url.pathname = url.pathname.replace(/\/+$/, '')
  if (!url.pathname.endsWith('/chat/completions')) url.pathname += '/chat/completions'
  return url.toString()
}
export const assistantSettingsSchema = z.object({
  provider: z.enum(assistantProviders),
  model: z.string().trim().min(1, '请填写模型名称。').max(300),
  baseUrl: z.string().trim().min(1, '请填写 API 地址。').max(2000),
  apiKey: z.string().trim().max(10000).optional(),
  clearApiKey: z.boolean().optional()
}).strict().superRefine((value, context) => {
  try { completionEndpoint(value.baseUrl) } catch (error) { context.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'API 地址无效。' }) }
  if (value.provider === 'openrouter' && value.model !== 'openrouter/free' && !value.model.endsWith(':free'))
    context.addIssue({ code: 'custom', message: 'OpenRouter 免费模式请选择 openrouter/free 或以 :free 结尾的模型。' })
  if (value.provider === 'openrouter' && value.baseUrl !== 'https://openrouter.ai/api/v1')
    context.addIssue({ code: 'custom', message: 'OpenRouter 免费模式使用官方 API 地址。' })
  if (value.provider === 'siliconflow' && value.model !== siliconFlowAssistantModel)
    context.addIssue({ code: 'custom', message: `SiliconFlow 默认使用 ${siliconFlowAssistantModel}。` })
  if (value.provider === 'siliconflow' && completionEndpoint(value.baseUrl) !== siliconFlowAssistantEndpoint)
    context.addIssue({ code: 'custom', message: 'SiliconFlow 默认使用 https://api.siliconflow.cn/v1/chat/completions。' })
})
export const assistantRecognitionSchema = z.boolean()
export const assistantRequestSchema = z.object({ requestId: idSchema, text: z.string().trim().min(1).max(6000), projectId: idSchema.nullable() }).strict()
const proposalSchema = z.object({
  action: z.enum(['create_tasks', 'clarify', 'unsupported']),
  message: z.string().trim().min(1).max(1000),
  tasks: z.array(taskCreateSchema.extend({ projectId: idSchema.nullable(), scheduledDate: z.string().nullable(), startTime: z.string().nullable(), endTime: z.string().nullable() })).max(10)
}).strict()
export function parseAssistantProposal(content: string) {
  let value: unknown
  try { value = JSON.parse(content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')) }
  catch { throw new DomainError('VALIDATION', '模型返回了无法识别的计划，尚未添加任务。请重试或换一个模型。') }
  const parsed = proposalSchema.safeParse(value)
  if (!parsed.success) throw new DomainError('VALIDATION', '模型返回的计划不完整，尚未添加任务。请补充日期、时间和项目后重试。')
  if (parsed.data.action === 'create_tasks' && !parsed.data.tasks.length)
    throw new DomainError('VALIDATION', '模型没有提供可添加的任务。')
  if (parsed.data.action !== 'create_tasks' && parsed.data.tasks.length)
    throw new DomainError('VALIDATION', '模型回复存在冲突，尚未添加任务。')
  for (const task of parsed.data.tasks) {
    const valid = taskCreateSchema.safeParse(task)
    if (!valid.success) throw new DomainError('VALIDATION', '模型给出的日期或时间无效，尚未添加任务。')
    validateSchedule(task)
  }
  return parsed.data
}
