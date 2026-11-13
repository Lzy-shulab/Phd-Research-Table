import { useCallback, useEffect, useState } from 'react'
import { CaretDown, Clock, Gauge } from '@phosphor-icons/react'
import { emptyCodexUsage, type CodexUsageSnapshot } from '../../shared/codex-usage'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { DesktopDisclosure } from './DesktopDisclosure'
import { ProgressRing } from './ProgressRing'
import { unwrap } from './api'
import './codex-usage.css'

const dateTime = (value: number) => new Date(value).toLocaleString('zh-CN', { month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })

export function CodexPanel() {
  const [snapshot, setSnapshot] = useState<CodexUsageSnapshot>(emptyCodexUsage)
  const [loading, setLoading] = useState(true), [expanded, setExpanded] = useState(false)
  const refresh = useCallback(async (force = false) => {
    setLoading(true)
    try { setSnapshot(unwrap(await window.workbench.codexUsage(force))) }
    catch { setSnapshot(current => ({ ...current, error: '暂时无法读取 Codex 额度，请稍后刷新。' })) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => {
    void refresh()
    return window.workbench.onCodexUsageChanged(setSnapshot)
  }, [refresh])
  const { windows, availableResetCredits, resetExpirations, updatedAt, error } = snapshot
  return <PanelFrame title="Codex 额度" footer={<PanelFooter updatedAt={updatedAt} refreshLabel="刷新额度" busy={loading} onRefresh={() => { void refresh(true) }}/> }>
    <div className="codex-content" aria-busy={loading}>
      {error && <p className="codex-notice" role="alert">{error}{updatedAt && <span>显示上次读取结果</span>}</p>}
      {!updatedAt ? <div className="codex-empty">{loading ? <span className="desktop-spinner" role="status" aria-label="读取 Codex 额度"/> : <><Gauge size={40} weight="duotone"/>{!error && <p>暂无额度信息</p>}<button className="codex-retry" onClick={() => { void refresh(true) }}>重新读取</button></>}</div> : <>
        <h2 className="codex-section-title">剩余额度</h2>
        <section className={`codex-windows${windows.length === 1 ? ' is-single' : ''}`} aria-label="各周期剩余额度">
          {windows.map((window, index) => <article className={`codex-window${window.remainingPercent !== null && window.remainingPercent <= 10 ? ' is-low' : ''}`} key={index}>
            <h3>{window.label}</h3>
            <ProgressRing value={window.remainingPercent} label={`${window.label}剩余额度`}/>
            <time dateTime={window.resetsAt ? new Date(window.resetsAt).toISOString() : undefined}>{window.resetsAt ? <>{dateTime(window.resetsAt)}<span>重置</span></> : '重置时间未提供'}</time>
          </article>)}
          {!windows.length && <p className="codex-unavailable">额度周期暂未提供</p>}
        </section>
        <section className="codex-resets">
          <button className="codex-reset-toggle" aria-expanded={expanded} aria-controls="codex-reset-details" onClick={() => setExpanded(!expanded)}>
            <Clock size={24}/><span>完整重置</span><strong>{availableResetCredits === null ? '—' : <>{availableResetCredits}<small> 次</small></>}</strong><CaretDown size={20} className={expanded ? 'is-expanded' : ''}/>
          </button>
          <DesktopDisclosure open={expanded} id="codex-reset-details">{() => <div className="codex-reset-details">
            {availableResetCredits === null ? <p>完整重置次数暂未提供</p> : availableResetCredits === 0 ? <p>暂无可用次数</p> : resetExpirations === null || !resetExpirations.length ? <p>到期明细暂未提供</p> : <>
              <ul>{resetExpirations.map((expires, index) => <li key={index}><span>{expires ? '到期' : '到期时间未提供'}</span>{expires && <time dateTime={new Date(expires).toISOString()}>{dateTime(expires)}</time>}</li>)}</ul>
              {resetExpirations.length < availableResetCredits && <p>已提供 {resetExpirations.length} 次的到期明细</p>}
            </>}
          </div>}</DesktopDisclosure>
        </section>
      </>}
    </div>
  </PanelFrame>
}
