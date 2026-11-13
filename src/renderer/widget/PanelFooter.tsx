import type { ReactNode } from 'react'
import { ArrowClockwise } from '@phosphor-icons/react'

export function PanelFooter({ status, updatedAt, onRefresh, busy = false, refreshLabel = '刷新', actions }: {
  status?: ReactNode; updatedAt?: number | string | null; onRefresh?: () => void; busy?: boolean; refreshLabel?: string; actions?: ReactNode
}) {
  return <footer className="desktop-panel-footer">
    <span className="desktop-panel-status" role="status">{status ?? (updatedAt ? <time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })} 更新</time> : '尚未更新')}</span>
    <div>{actions}{onRefresh && <button className="widget-tone-info" aria-label={refreshLabel} disabled={busy} onClick={onRefresh}><ArrowClockwise size={24}/><span>刷新</span></button>}</div>
  </footer>
}
