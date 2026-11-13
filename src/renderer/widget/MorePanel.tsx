import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, ArrowDown, CheckCircle, ListChecks, PaperPlaneTilt, BookOpenText, Cpu, Gauge } from '@phosphor-icons/react'
import { defaultWidgetPreferences, desktopPanelTitles, type DesktopShortcut, type WidgetPreferencesPatch, type WidgetSnapshot } from '../../shared/widget'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { unwrap } from './api'
import { animateDesktopReorder, captureDesktopPositions } from './desktop-motion'
import './more.css'

const icons = { checkin: CheckCircle, tasks: ListChecks, submissions: PaperPlaneTilt, reading: BookOpenText, gpu: Cpu, codex: Gauge }

export function MorePanel() {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const list = useRef<HTMLUListElement>(null)
  const previousPositions = useRef<ReturnType<typeof captureDesktopPositions>>(new Map())
  useEffect(() => {
    void window.workbench.widgetSnapshot().then(unwrap).then(setSnapshot).catch(() => setError('便签设置暂时无法读取。'))
    return window.workbench.onWidgetChanged(setSnapshot)
  }, [])
  const preferences = snapshot?.preferences ?? defaultWidgetPreferences
  const save = async (patch: WidgetPreferencesPatch) => {
    setBusy(true); setError('')
    try { setSnapshot(unwrap(await window.workbench.updateWidgetPreferences(patch))) }
    catch { setError('便签设置未能保存，请重试。') }
    finally { setBusy(false) }
  }
  const move = (id: DesktopShortcut, direction: number) => {
    const order = [...preferences.railOrder], index = order.indexOf(id), next = index + direction
    if (next < 0 || next >= order.length) return
    const [item] = order.splice(index, 1); order.splice(next, 0, item!)
    previousPositions.current = captureDesktopPositions(list.current?.querySelectorAll<HTMLLIElement>('li') ?? [])
    void save({ railOrder: order })
  }
  const entries = preferences.railOrder
  const order = entries.join(',')
  useLayoutEffect(() => {
    const positions = previousPositions.current
    previousPositions.current = new Map()
    return animateDesktopReorder(positions)
  }, [order])
  return <PanelFrame title="便签管理" busy={busy} footer={<PanelFooter status={error ? '未保存' : busy ? '保存中' : '设置自动保存'} actions={<button onClick={() => { void window.workbench.hideWidget() }} disabled={busy}><CheckCircle size={24}/><span>完成</span></button>}/> }>
    {error && <p className="desktop-error" role="alert">{error}</p>}
    <div className="desktop-more-content">
      <div className="desktop-more-columns"><span>便签顺序</span><span>在桌面显示</span></div>
      {!snapshot ? <div className="desktop-quiet-empty" role="status" aria-label="读取便签设置"><span className="desktop-spinner"/></div> : <ul ref={list} className="desktop-more-list" aria-label="便签顺序与显示">{entries.map(id => {
        const Icon = icons[id], index = preferences.railOrder.indexOf(id), title = desktopPanelTitles[id]
        return <li key={id} data-shortcut={id}>
          <Icon size={24} weight="duotone"/><span className="desktop-more-title">{title}</span><div className="desktop-more-reorder"><button aria-label={`上移${title}`} disabled={busy || index === 0} onClick={() => move(id, -1)}><ArrowUp size={20}/></button><button aria-label={`下移${title}`} disabled={busy || index === preferences.railOrder.length - 1} onClick={() => move(id, 1)}><ArrowDown size={20}/></button></div><input type="checkbox" role="switch" aria-label={`在桌面显示${title}`} checked={!preferences.hiddenPanels.includes(id)} disabled={busy} onChange={event => { void save({ hiddenPanels: event.target.checked ? preferences.hiddenPanels.filter(item => item !== id) : [...preferences.hiddenPanels, id] }) }}/>
        </li>
      })}</ul>}
    </div>
  </PanelFrame>
}
