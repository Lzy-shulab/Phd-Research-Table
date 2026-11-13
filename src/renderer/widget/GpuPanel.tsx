import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Cpu, ArrowClockwise, ArrowSquareOut, Copy, Check, SignIn, UserCircle, Globe, TerminalWindow, BellRinging, BellSlash, PencilSimple } from '@phosphor-icons/react'
import { emptyGpuSnapshot, type GpuMonitorSnapshot, type GpuDevice } from '../../shared/gpu'
import { PanelFrame } from './PanelFrame'
import { PanelFooter } from './PanelFooter'
import { DesktopTabs } from './DesktopTabs'
import { WidgetSheet } from './panels'
import { unwrap } from './api'
import './gpu.css'

const stateLabels = { idle: '空闲', busy: '使用中', unknown: '未知' }
const gib = (mb: number | null) => mb === null ? '—' : (mb / 1024).toFixed(1)
const clock = (value: string | null) => value ? new Date(value).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—'
function Device({ gpu, edit, disabled, children }: { gpu: GpuDevice; edit: () => void; disabled: boolean; children?: ReactNode }) {
  const memory = gpu.memoryUsedMb !== null && gpu.memoryTotalMb ? Math.min(100, gpu.memoryUsedMb / gpu.memoryTotalMb * 100) : null
  return <article className={`gpu-device state-${gpu.state}`} data-device-id={gpu.id}>
    <header><strong>GPU {gpu.index}</strong><span title={gpu.name}>{gpu.name.replace(/^NVIDIA\s+/, '')}</span><b className={`gpu-state ${gpu.state}`}>{stateLabels[gpu.state]}</b></header>
    <div className="gpu-metrics"><div><span>利用率<strong>{gpu.utilization === null ? '—' : Math.round(gpu.utilization) + '%'}</strong></span><div className="gpu-meter" role="meter" aria-label={`GPU ${gpu.index} 利用率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={gpu.utilization ?? undefined}><i style={{ width: `${gpu.utilization ?? 0}%` }}/></div></div>
      <div><span>显存<strong>{gib(gpu.memoryUsedMb)} / {gib(gpu.memoryTotalMb)} GiB</strong></span><div className="gpu-meter memory" role="meter" aria-label={`GPU ${gpu.index} 显存使用率`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={memory ?? undefined}><i style={{ width: `${memory ?? 0}%` }}/></div></div></div>
    <div className="gpu-owners"><button className="gpu-owner-edit" disabled={disabled} aria-label={`设置 GPU ${gpu.index} 使用人`} aria-expanded={Boolean(children)} onClick={edit}><UserCircle size={20}/><span>{gpu.owners.join('、') || '设置使用人'}</span><PencilSimple size={18}/></button>{gpu.workloads > 0 && <span>{gpu.workloads} 个进程</span>}</div>
    {children}
  </article>
}
export function GpuPanel() {
  const [data, setData] = useState<GpuMonitorSnapshot>(emptyGpuSnapshot)
  const [view, setView] = useState<'gpu' | 'cpolar'>('gpu')
  const [busy, setBusy] = useState(true), [error, setError] = useState(''), [copied, setCopied] = useState('')
  const [loginOpen, setLoginOpen] = useState(false), [loginBusy, setLoginBusy] = useState(false), [loginError, setLoginError] = useState('')
  const [alertSaving, setAlertSaving] = useState(false)
  const [editing, setEditing] = useState<{ id: string; names: string[] } | null>(null)
  const [ownerSaving, setOwnerSaving] = useState(false), [ownerError, setOwnerError] = useState(''), [ownerSaved, setOwnerSaved] = useState(false)
  const editor = useRef<HTMLFormElement>(null)
  const editingId = editing?.id
  useEffect(() => {
    if (editingId) { editor.current?.scrollIntoView({ block: 'nearest' }); editor.current?.querySelector<HTMLInputElement>('input')?.focus({ preventScroll: true }) }
  }, [editingId])
  useEffect(() => { if (ownerError) editor.current?.scrollIntoView({ block: 'nearest' }) }, [ownerError])
  useEffect(() => { if (!ownerSaved) return; const timer = setTimeout(() => setOwnerSaved(false), 3000); return () => clearTimeout(timer) }, [ownerSaved])
  const closeEditor = () => {
    const id = editing?.id; setEditing(null); setOwnerError('')
    requestAnimationFrame(() => { const article = [...document.querySelectorAll<HTMLElement>('.gpu-device')].find(item => item.dataset.deviceId === id); article?.querySelector<HTMLButtonElement>('.gpu-owner-edit')?.focus({ preventScroll: true }) })
  }
  const saveOwners = async () => {
    if (!editing || ownerSaving) return
    setOwnerSaving(true); setOwnerError(''); setOwnerSaved(false)
    try { setData(unwrap(await window.workbench.setGpuOwners(editing.id, editing.names))); closeEditor(); setOwnerSaved(true) }
    catch (e) { setOwnerError(e instanceof Error ? e.message : '保存失败，请重试。') }
    finally { setOwnerSaving(false) }
  }
  const syncSsh = async () => {
    setBusy(true); setError('')
    try { setData(unwrap(await window.workbench.syncCpolarSsh())) } catch (e) { setError(e instanceof Error ? e.message : 'SSH 更新失败，请重试') } finally { setBusy(false) }
  }
  const reload = useCallback(async (force = false) => {
    setBusy(true); setError('')
    try { setData(unwrap(await window.workbench.gpuMonitor(force))) } catch (e) { setError(e instanceof Error ? e.message : '连接失败，请重试') } finally { setBusy(false) }
  }, [])
  useEffect(() => { void reload(); return window.workbench.onGpuMonitorChanged(setData) }, [reload])
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(''), 1600); return () => clearTimeout(timer) }, [copied])
  const openSite = async () => { try { unwrap(await window.workbench.openGpuWebsite()) } catch (e) { setError(e instanceof Error ? e.message : '无法打开看板') } }
  const closeLogin = () => { if (!loginBusy) { setLoginOpen(false); setLoginError('') } }
  const rememberLogin = async (form: HTMLFormElement) => {
    const values = new FormData(form)
    setLoginBusy(true); setLoginError('')
    try {
      setData(unwrap(await window.workbench.saveGpuLogin({ username: String(values.get('username') ?? ''), password: String(values.get('password') ?? '') })))
      form.reset(); setLoginOpen(false)
    } catch (error) { setLoginError(error instanceof Error ? error.message : '登录失败，请重试。') }
    finally { setLoginBusy(false) }
  }
  const forgetLogin = async () => {
    setLoginBusy(true); setLoginError('')
    try { setData(unwrap(await window.workbench.forgetGpuLogin())); setLoginOpen(false) }
    catch (error) { setLoginError(error instanceof Error ? error.message : '设置未能保存。') }
    finally { setLoginBusy(false) }
  }
  const copy = async (id: string) => { try { unwrap(await window.workbench.copyGpuTunnel(id)); setCopied(id) } catch (e) { setError(e instanceof Error ? e.message : '复制失败') } }
  const open = async (id: string) => { try { unwrap(await window.workbench.openGpuTunnel(id)) } catch (e) { setError(e instanceof Error ? e.message : '打开失败') } }
  const toggleAlerts = async (enabled: boolean) => {
    setAlertSaving(true); setError('')
    try { setData(unwrap(await window.workbench.setGpuAlerts(enabled))) } catch (e) { setError(e instanceof Error ? e.message : '设置未保存') } finally { setAlertSaving(false) }
  }
  const tunnels = [...data.cpolar.tunnels].sort((a, b) => ({ online: 0, unknown: 1, offline: 2 })[a.status] - ({ online: 0, unknown: 1, offline: 2 })[b.status] || a.name.localeCompare(b.name))
  const notice = error || (view === 'gpu' ? data.error : data.sshSync?.error || data.cpolar.error)
  const syncing = busy || Boolean(data.sshSync?.syncing)
  return <><PanelFrame title="GPU 监控" covered={loginOpen} busy={Boolean(editing) || ownerSaving || loginOpen} footer={<PanelFooter status={ownerSaved ? '使用人已同步到网页' : copied ? '已复制' : `${clock(view === 'gpu' ? data.updatedAt : data.cpolar.checkedAt)} ${view === 'gpu' ? '快照' : '查询'}`} actions={<><button aria-label="GPU 自动登录设置" title="GPU 自动登录" onClick={() => setLoginOpen(true)}><UserCircle size={24}/></button><button aria-label="打开 GPU 看板网站" title="打开 GPU 看板" onClick={() => { void openSite() }}><ArrowSquareOut size={24}/></button></>}/> }>
    <DesktopTabs label="监控视图" selected={view} className="gpu-tabs">
      <button role="tab" aria-selected={view === 'gpu'} disabled={Boolean(editing)} onClick={() => setView('gpu')}>GPU 监控</button><button role="tab" aria-selected={view === 'cpolar'} disabled={Boolean(editing)} onClick={() => setView('cpolar')}>Cpolar</button>
      <button className={`gpu-refresh${(view === 'cpolar' ? syncing : busy) ? ' is-loading' : ''}`} aria-label={view === 'cpolar' ? '刷新地址并更新 SSH' : '刷新监控'} disabled={view === 'cpolar' ? syncing : busy} onClick={() => { void (view === 'cpolar' ? syncSsh() : reload(true)) }}><ArrowClockwise size={24}/></button>
    </DesktopTabs>
    {view === 'gpu' && <label className="gpu-alert-switch widget-switch"><span>{data.alerts?.enabled !== false ? <BellRinging size={24}/> : <BellSlash size={24}/>}空闲提醒</span><input type="checkbox" role="switch" aria-label="GPU 空闲提醒" checked={data.alerts?.enabled !== false} disabled={alertSaving} onChange={event => { void toggleAlerts(event.target.checked) }}/></label>}
    {(notice || data.alerts?.error) && <p className="gpu-notice" role="status">{notice || data.alerts?.error}</p>}
    {data.auth === 'required' ? <div className="gpu-empty"><Cpu size={48} weight="duotone"/><button className="desktop-action" onClick={() => setLoginOpen(true)}><SignIn size={24}/>登录 GPU 看板</button></div>
      : busy && !data.updatedAt ? <div className="gpu-empty" role="status" aria-label="连接 GPU 看板"><span className="desktop-spinner"/></div>
        : view === 'gpu' ? <>
          {data.total > 0 && <div className="gpu-summary" aria-label="GPU 数量"><div className="idle"><strong>{data.idle}</strong><span>空闲</span></div><div><strong>{data.busy}</strong><span>使用中</span></div><div><strong>{data.unknown || data.total}</strong><span>{data.unknown ? '未知' : '总计'}</span></div></div>}
          <div className="gpu-content">{data.servers.map(server => <section className="gpu-server" key={server.id}><h2><Cpu size={20}/><span>{server.name}</span><small>{server.devices.length} GPU</small></h2>
            {server.warning && <p className="gpu-server-warning">{server.warning}</p>}{server.devices.map(gpu => <Device key={gpu.id} gpu={gpu} disabled={ownerSaving || Boolean(editing && editing.id !== gpu.id)} edit={() => { if (editing?.id === gpu.id) { closeEditor(); return }; setOwnerError(''); setOwnerSaved(false); setEditing({ id: gpu.id, names: [...gpu.owners] }) }}>
              {editing?.id === gpu.id && <form ref={editor} className="gpu-owner-form" aria-label={`${server.name} GPU ${gpu.index} 使用人`} aria-busy={ownerSaving} onSubmit={event => { event.preventDefault(); void saveOwners() }} onKeyDown={event => { if (event.key === 'Escape' && !ownerSaving) { event.preventDefault(); closeEditor() } }}>
                <fieldset disabled={ownerSaving} aria-describedby={ownerError ? 'gpu-owner-error' : undefined}><legend>选择使用人</legend>
                  <div className="gpu-owner-options">{data.teamMembers.map(name => <label key={name}><input type="checkbox" checked={editing.names.includes(name)} onChange={event => { const checked = event.target.checked; setOwnerError(''); setEditing({ ...editing, names: checked ? [...editing.names, name] : editing.names.filter(item => item !== name) }) }}/><span>{name}</span></label>)}</div>
                  {!data.teamMembers.length && <p className="gpu-owner-hint">暂未读取到团队成员，请刷新监控。</p>}
                </fieldset>
                {ownerError && <p id="gpu-owner-error" className="gpu-owner-error" role="alert">{ownerError}</p>}
                <div className="gpu-owner-actions"><button type="button" disabled={ownerSaving || !editing.names.length} onClick={() => { setEditing({ ...editing, names: [] }); setOwnerError('') }}>清空</button><button type="button" disabled={ownerSaving} onClick={closeEditor}>取消</button><button type="submit" className="desktop-action" disabled={ownerSaving || (!data.teamMembers.length && editing.names.length > 0)}>{ownerSaving ? '同步中…' : '保存并同步'}</button></div>
              </form>}
            </Device>)}</section>)}
            {!data.servers.length && !busy && <div className="gpu-empty"><Cpu size={48} weight="duotone"/><span>{notice ? '等待连接' : '暂无服务器'}</span></div>}</div>
        </> : <>
          <div className="gpu-tunnel-summary"><strong>{tunnels.filter(t => t.status === 'online').length}<span>在线</span></strong><span>{tunnels.filter(t => t.status === 'offline').length} 离线</span>{tunnels.some(t => t.status === 'unknown') && <span>{tunnels.filter(t => t.status === 'unknown').length} 未知</span>}</div>
          <div className="gpu-content" aria-label="Cpolar 地址">
            {data.sshSync && <section className="gpu-ssh-sync" aria-label="SSH 自动更新">
              <div className="gpu-ssh-action"><strong title={data.sshSync.configPath}>{data.sshSync.host}</strong><button className="desktop-action" disabled={syncing} onClick={() => { void syncSsh() }}><ArrowClockwise size={20}/>{syncing ? '更新中…' : '更新 SSH'}</button></div>
              <p>后台运行时每 5 小时自动更新</p>
              <p role="status">{data.sshSync.syncing ? '正在读取最新地址…' : data.sshSync.error ? '未更新，保留原配置' : data.sshSync.syncedAt ? `${clock(data.sshSync.syncedAt)} ${data.sshSync.result === 'updated' ? '已写入 SSH 配置' : 'SSH 配置已是最新'}` : '等待首次更新'}{data.sshSync.nextCheckAt && !data.sshSync.syncing && ` · 下次 ${clock(data.sshSync.nextCheckAt)}`}</p>
            </section>}
            {tunnels.map(tunnel => <article className={`gpu-tunnel state-${tunnel.status}`} key={tunnel.id}>
            <header>{tunnel.protocol === 'tcp' ? <TerminalWindow size={24}/> : <Globe size={24}/>}<strong>{tunnel.name}</strong><span className={`gpu-state ${tunnel.status}`}>{({ online: '在线', offline: '离线', unknown: '未知' })[tunnel.status]}</span></header>
            <div className="gpu-tunnel-address"><span title={tunnel.url}>{tunnel.protocol === 'tcp' ? tunnel.url.replace(/^tcp:\/\//, '') : tunnel.url}</span><button aria-label={`复制 ${tunnel.name} ${tunnel.protocol.toUpperCase()} 地址`} title={copied === tunnel.id ? '已复制' : '复制地址'} data-copied={copied === tunnel.id} onClick={() => { void copy(tunnel.id) }}>{copied === tunnel.id ? <Check size={24}/> : <Copy size={24}/>}</button>
              {['http', 'https'].includes(tunnel.protocol) && <button aria-label={`打开 ${tunnel.name} ${tunnel.protocol.toUpperCase()} 地址`} title="在浏览器打开" onClick={() => { void open(tunnel.id) }}><ArrowSquareOut size={24}/></button>}</div>
            <div className="gpu-tunnel-meta"><span>{tunnel.protocol.toUpperCase()}</span>{tunnel.status !== 'online' && tunnel.lastSeenAt && <time dateTime={tunnel.lastSeenAt}>最近在线 {new Date(tunnel.lastSeenAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })} {clock(tunnel.lastSeenAt)}</time>}</div>
          </article>)}{!tunnels.length && <div className="gpu-empty"><Globe size={48} weight="duotone"/><span>暂无隧道地址</span></div>}</div>
        </>}
  </PanelFrame>
  {loginOpen && <WidgetSheet page="gpu-login" title="GPU 自动登录" backLabel="返回 GPU 监控" close={closeLogin} back={closeLogin}>
    <form className="widget-form widget-task-review" onSubmit={event => { event.preventDefault(); void rememberLogin(event.currentTarget) }}>
      <label>团队账号<input name="username" autoComplete="username" required maxLength={40} disabled={loginBusy}/></label>
      <label>密码<input name="password" autoComplete="current-password" type="password" required maxLength={512} disabled={loginBusy}/></label>
      <button type="submit" className="widget-primary" disabled={loginBusy}>{loginBusy ? '正在登录…' : '登录并记住'}</button>
      {data.rememberedLogin && <button type="button" className="widget-text-button" disabled={loginBusy} onClick={() => { void forgetLogin() }}>关闭自动登录</button>}
      {loginError && <p className="widget-error" role="alert">{loginError}</p>}
    </form>
  </WidgetSheet>}</>
}
