import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { CalendarClock, ChevronDown, Plus, Settings2, Trash2 } from 'lucide-react'
import type { ImportantCountdown } from '../../../shared/countdowns'
import { countdownTime } from '../../../shared/countdowns'
import { countdownInputSchema } from '../../../domain/countdowns'
import { useClock } from '../../hooks/use-clock'
import { useWorkbench } from '../../stores/workbench'
import { Button } from '../ui/button'
import { ConfirmDialog, Dialog } from '../ui/dialog'

function localInput(value: string) {
  const date = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
export function ImportantCountdowns() {
  const [items, setItems] = useState<ImportantCountdown[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)
  const [selected, setSelected] = useState<string | undefined>()
  const [title, setTitle] = useState('')
  const [deadline, setDeadline] = useState('')
  const [saving, setSaving] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [previewCount, setPreviewCount] = useState(3)
  const [removing, setRemoving] = useState<ImportantCountdown | null>(null)
  const section = useRef<HTMLElement>(null)
  const reduced = useReducedMotion()
  const now = useClock()
  const reset = useCallback(() => { setSelected(undefined); setTitle(''); setDeadline('') }, [])
  useEffect(() => {
    let active = true
    void window.workbench.countdowns().then(result => {
      if (!active) return
      if (result.ok) setItems(result.data); else setError(result.error.message)
    }).catch(() => { if (active) setError('倒计时未能读取，请切换页面后重试。') }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [])
  useEffect(() => {
    if (!items.length) return
    let active = true
    let timer: ReturnType<typeof setTimeout>
    const refresh = async () => {
      try {
        const result = await window.workbench.countdowns()
        if (!active) return
        if (result.ok) { setItems(result.data); if (selected && !result.data.some(item => item.id === selected)) reset() }
        else { setError(result.error.message); timer = setTimeout(() => { void refresh() }, 30_000) }
      } catch {
        if (active) { setError('到期事件暂时未能清理，请稍后重试。'); timer = setTimeout(() => { void refresh() }, 30_000) }
      }
    }
    const deadline = Math.min(...items.map(item => new Date(item.deadline).getTime()))
    timer = setTimeout(() => { void refresh() }, Math.min(2_147_483_647, Math.max(1, deadline - Date.now())))
    const onFocus = () => { if (Date.now() >= deadline) void refresh() }
    window.addEventListener('focus', onFocus)
    return () => { active = false; clearTimeout(timer); window.removeEventListener('focus', onFocus) }
  }, [items, selected, reset])
  useEffect(() => {
    const element = section.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      const fontSize = parseFloat(getComputedStyle(document.documentElement).fontSize)
      setPreviewCount(Math.max(1, Math.min(3, Math.floor((entry.contentRect.width + 16) / (fontSize * 20 + 16)))))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const ordered = [...items].sort((a, b) => Number(countdownTime(a, now).expired) - Number(countdownTime(b, now).expired) || a.deadline.localeCompare(b.deadline))
  const visible = expanded ? ordered : ordered.slice(0, previewCount)
  return <section ref={section} className="important-countdowns" aria-label="重要事件倒计时">
    <header><h2><CalendarClock size={17} />重要事件倒计时{items.length > 0 && <small>{items.length} 个</small>}</h2><div className="countdown-toolbar">{items.length > previewCount && <Button variant="ghost" aria-expanded={expanded} aria-controls="countdown-list" onClick={() => setExpanded(!expanded)}>{expanded ? '收起事件' : `展开全部 ${items.length} 个`}<ChevronDown size={15} className={expanded ? 'is-open' : ''} /></Button>}<Button variant="ghost" disabled={loading || saving} aria-haspopup="dialog" onClick={() => { reset(); setError(''); setEditing(true) }}><Settings2 size={15} />设置</Button></div></header>
    {loading ? <p role="status">正在读取…</p> : !items.length && !editing && <button className="countdown-empty" onClick={() => setEditing(true)}><Plus size={16} />添加一个重要日期</button>}
    {error && !editing && <p className="field-error" role="alert">{error}</p>}
    {items.length > 0 && <div className="countdown-list" id="countdown-list" style={{ gridTemplateColumns: `repeat(${previewCount}, minmax(0, 1fr))` }}><AnimatePresence initial={false}>{visible.map(item => {
      const time = countdownTime(item, now)
      const remaining = `${time.days} 天 ${String(time.hours).padStart(2, '0')} 时 ${String(time.minutes).padStart(2, '0')} 分`
      return <motion.article layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reduced ? 0.08 : 0.2 }} className={time.expired ? 'countdown-item is-expired' : 'countdown-item'} key={item.id}>
        <div className="countdown-ring" role="img" aria-label={`${item.title}：${time.expired ? '已到期' : `剩余 ${remaining}`}`}><svg viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="32" r="27" /><circle className="ring-value" cx="32" cy="32" r="27" pathLength="100" strokeDasharray={`${time.ratio * 100} 100`} /></svg><span><b>{time.expired ? '0' : time.days || String(time.hours).padStart(2, '0')}</b><small>{time.days ? '天' : '小时'}</small></span></div>
        <div className="countdown-detail"><strong title={item.title}>{item.title}</strong><span className="countdown-value">{time.expired ? '已到期' : remaining}</span><time dateTime={item.deadline}>{new Date(item.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} 截止</time></div>
      </motion.article>
    })}</AnimatePresence></div>}
    <Dialog open={editing} onOpenChange={open => { if (!saving) { setEditing(open); if (!open) reset() } }} title="重要事件倒计时" description="到达截止时间后自动移除；事件独立保存，不计入研究任务。" className="countdown-dialog">
      {items.length > 0 && <div className="countdown-management" aria-label="已保存的重要事件">{ordered.map(item => <div key={item.id} className={selected === item.id ? 'is-selected' : ''}><div><strong title={item.title}>{item.title}</strong><time dateTime={item.deadline}>{new Date(item.deadline).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div><Button variant="ghost" aria-label={`编辑倒计时 ${item.title}`} disabled={saving} onClick={() => { setSelected(item.id); setTitle(item.title); setDeadline(localInput(item.deadline)); setError('') }}>编辑</Button><Button variant="ghost" aria-label={`移除倒计时 ${item.title}`} disabled={saving} onClick={() => setRemoving(item)}><Trash2 size={15} /></Button></div>)}</div>}
      <form className="countdown-form" onSubmit={async event => {
      event.preventDefault(); if (saving) return
      const date = new Date(deadline)
      const parsed = countdownInputSchema.safeParse({ title, deadline: Number.isFinite(date.getTime()) ? date.toISOString() : '' })
      if (!parsed.success) { setError(parsed.error.issues[0]?.message ?? '请检查名称和截止时间。'); return }
      setSaving(true); setError('')
      try { const result = await window.workbench.saveCountdown(parsed.data, selected); if (!result.ok) { setError(result.error.message); return }; setItems(current => selected ? current.map(item => item.id === selected ? result.data : item) : [...current, result.data]); reset(); useWorkbench.getState().notify('重要事件倒计时已保存。', 'info') }
      catch { setError('倒计时未能保存，请重试。') } finally { setSaving(false) }
    }}>
      <h3>{selected ? '编辑事件' : '添加事件'}</h3>
      <label className="field">名称<input aria-label="倒计时名称" value={title} maxLength={120} required onChange={event => setTitle(event.target.value)} /></label>
      <label className="field">截止时间<input aria-label="倒计时截止时间" type="datetime-local" value={deadline} required onChange={event => setDeadline(event.target.value)} /></label>
      <div><Button type="submit" variant="primary" disabled={saving}>{saving ? '保存中…' : selected ? '保存修改' : '添加倒计时'}</Button>{selected && <Button onClick={reset}>取消编辑</Button>}</div>
      </form>
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="dialog-actions"><Button disabled={saving} onClick={() => { setEditing(false); reset() }}>完成</Button></div>
    </Dialog>
    {removing && <ConfirmDialog open title="删除这个重要事件？" description={`将移除“${removing.title}”的倒计时。`} busy={saving} onClose={() => setRemoving(null)} onConfirm={async () => {
      setSaving(true)
      try { const result = await window.workbench.deleteCountdown(removing.id); if (!result.ok) { setError(result.error.message); return }; setItems(current => current.filter(item => item.id !== removing.id)); if (selected === removing.id) reset(); setRemoving(null) }
      catch { setError('移除未能保存，请重试。') } finally { setSaving(false) }
    }} />}
  </section>
}
