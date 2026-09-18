import { useState } from 'react'
import { Bot, Send, Undo2 } from 'lucide-react'
import { assistantProviderLabels } from '../../../shared/assistant'
import { useAssistant, assistantConfigured } from '../../stores/assistant'
import { useWorkbench } from '../../stores/workbench'
import { dateKey } from '../../lib/dates'
import { Dialog } from '../ui/dialog'
import { Button } from '../ui/button'
import { ProjectSelect } from '../projects/ProjectSelect'

export function AssistantDialog() {
  const { open, busy, draft, context, projectId, result, error, settings, send } = useAssistant()
  const [undoing, setUndoing] = useState(false)
  const projects = useWorkbench((state) => state.projects)
  const tasks = useWorkbench((state) => state.tasks)
  const configured = assistantConfigured(settings)
  const configure = () => { useAssistant.setState({ open: false }); useWorkbench.getState().setSection('settings'); setTimeout(() => document.getElementById('assistant-settings')?.scrollIntoView({ block: 'start' }), 150) }
  return <>
    <button className="assistant-launcher" aria-label="打开 AI 助手" onClick={() => useAssistant.getState().show()}><Bot size={18} /><span>AI 助手</span>{busy && <i className="tiny-spinner" />}</button>
    {open && <Dialog open onOpenChange={(value) => useAssistant.setState({ open: value })} title="AI 计划助手" description="例如：今天晚上6点，开组会。安排明确后会直接添加，日期或项目不清楚时会向你确认。" className="assistant-dialog">
      {!configured ? <div className="assistant-setup"><p>先选择模型并配置 API，即可用一句话安排研究计划。</p><Button variant="primary" onClick={configure}>前往 AI 设置</Button></div> : <>
        <div className="assistant-service"><span>{settings ? assistantProviderLabels[settings.activeProvider] : 'AI 服务'}</span><button disabled={busy} onClick={configure}>更改配置</button></div>
        {context && <p className="assistant-context">正在补充：{context}</p>}
        {result && <div className={`assistant-result result-${result.kind}`} role="status"><strong>{result.message}</strong>
          {result.tasks.map((task) => <div className="assistant-task" key={task.id}><b>{task.title}</b><span>{projects.find((project) => project.id === task.projectId)?.name} · {task.scheduledDate ?? '未安排日期'}{task.startTime ? ` ${task.startTime}${task.endTime ? `–${task.endTime}` : ' 开始'}` : task.scheduledDate ? ' 全天' : ''}</span><small>{task.scheduledDate === dateKey() ? '已同步到全部任务、Today Plan 和日历' : task.scheduledDate ? '已同步到全部任务和日历' : '已加入全部任务'}</small></div>)}
          {result.kind === 'created' && result.tasks.some((task) => tasks.some((item) => item.id === task.id)) && <div className="assistant-result-actions"><Button disabled={busy || undoing} onClick={() => { useWorkbench.getState().setSection('planner'); useWorkbench.getState().navigate('all', null); useAssistant.setState({ open: false }) }}>查看全部任务</Button><Button disabled={busy || undoing} onClick={async () => {
            setUndoing(true)
            try { for (const task of result.tasks) if (useWorkbench.getState().tasks.some((item) => item.id === task.id)) await useWorkbench.getState().deleteTask(task.id) }
            finally { setUndoing(false) }
          }}><Undo2 size={14} />撤销本次添加</Button></div>}
          {result.kind === 'created' && !result.tasks.some((task) => tasks.some((item) => item.id === task.id)) && <p>本次添加的任务已移除。</p>}
        </div>}
        {error && <p className="field-error" role="alert">{error}</p>}
        <form onSubmit={(event) => { event.preventDefault(); void send(draft, projectId) }}>
          <textarea aria-label="告诉 AI 你的计划" value={draft} maxLength={4000} disabled={busy} placeholder={context ? '补充日期、时间或项目…' : '今天晚上6点，开组会'} onChange={(event) => useAssistant.setState({ draft: event.target.value })} onKeyDown={(event) => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) { event.preventDefault(); void send(draft, projectId) } }} />
          <div className="assistant-compose-actions"><ProjectSelect value={projectId ?? ''} allowAutomatic onChange={(value) => useAssistant.setState({ projectId: value || null })} /><span>可自动识别项目</span><Button type="submit" variant="primary" disabled={busy || !draft.trim()}><Send size={15} />{busy ? '正在理解…' : context ? '补充并添加' : '理解并添加'}</Button></div>
        </form>
        {context && <button className="assistant-reset" disabled={busy} onClick={() => useAssistant.setState({ context: '', result: null, error: '', draft: '' })}>放弃这条，开始新计划</button>}
        <p className="assistant-note">已安排到其他日期的任务不会加入 Today Plan。模型有时会理解偏差，请查看添加结果；支持撤销。</p>
      </>}
    </Dialog>}
  </>
}
