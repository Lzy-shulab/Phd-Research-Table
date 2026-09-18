import { useState } from 'react'
import { ExternalLink, Sparkles } from 'lucide-react'
import { useEncouragement } from '../../hooks/use-encouragement'
import { Dialog } from '../ui/dialog'
import { Button } from '../ui/button'

export function DailyEncouragement() {
  const { value, busy, retry } = useEncouragement()
  const [open, setOpen] = useState(false)
  const [sourceError, setSourceError] = useState('')
  return <>
    <button className="daily-encouragement" aria-label="查看每日科研鼓励语" title={`${value.quote.text}\n${value.state === 'local' ? '工作台原创' : `一言 · ${value.sourceDate}`} · 点击查看完整内容和来源`} onClick={() => setOpen(true)}>
      <Sparkles size={13} strokeWidth={1.5} aria-hidden="true" /><span className="daily-encouragement-label">每日科研</span><span className="daily-encouragement-text" data-testid="daily-encouragement-text">{value.quote.text}</span>
    </button>
    {open && <Dialog open title="每日科研鼓励" description={`${value.date} · 每天留一句话给正在探索的自己。`} className="encouragement-dialog" onOpenChange={setOpen}>
      <blockquote>{value.quote.text}</blockquote>
      <p className="encouragement-origin">{value.state === 'local' ? '工作台原创' : `一言社区收录${value.quote.origin ? ` · ${value.quote.origin}` : ''}${value.quote.author ? ` · ${value.quote.author}` : ''}`}</p>
      <p className="field-hint">{value.message}{value.state !== 'local' && ' 出处信息沿用来源平台的收录。'}</p>
      <p className="field-hint">按本机日期零点更新，休眠或关闭后在下次打开时补查。同一天保持同一句。</p>
      {sourceError && <p className="field-error" role="status">{sourceError}</p>}
      <div className="dialog-actions">{value.state !== 'local' && <Button variant="ghost" className="push-right" onClick={async () => { try { const result = await window.workbench.openEncouragementSource(); if (!result.ok) setSourceError(result.error.message) } catch { setSourceError('来源页面暂时无法打开。') } }}><ExternalLink size={14} />查看来源</Button>}
        {value.state !== 'online' && <Button disabled={busy} onClick={retry}>{busy ? '正在连接…' : '重新连接'}</Button>}<Button onClick={() => setOpen(false)}>关闭</Button></div>
    </Dialog>}
  </>
}
