import { useEffect, useState } from 'react'
import { BookOpenText, CheckCircle2, Clock3, Cpu, Eye, EyeOff, Gauge, ListChecks, MonitorDot, Send, SlidersHorizontal } from 'lucide-react'
import { desktopPanelTitles, desktopShortcuts, type DesktopShortcut, type WidgetPreferencesPatch, type WidgetSnapshot } from '../../../shared/widget'
import { Button } from '../ui/button'
import { SettingsHeading } from './SettingsHeading'

const shortcutIcons = {
  checkin: Clock3, tasks: ListChecks, submissions: Send,
  reading: BookOpenText, gpu: Cpu, codex: Gauge
} satisfies Record<DesktopShortcut, typeof Clock3>

export function WidgetSettings() {
  const [snapshot, setSnapshot] = useState<WidgetSnapshot | null>(null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  useEffect(() => {
    void window.workbench.widgetSnapshot().then(result => {
      if (result.ok) setSnapshot(result.data); else setError(result.error.message)
    })
    return window.workbench.onWidgetChanged(setSnapshot)
  }, [])
  const update = async (patch: WidgetPreferencesPatch) => {
    setBusy(true); setError('')
    try {
      const result = await window.workbench.updateWidgetPreferences(patch)
      if (!result.ok) setError(result.error.message); else setSnapshot(result.data)
    } catch { setError('桌面便签设置未能保存，请重试。') }
    finally { setBusy(false) }
  }
  const hidden = snapshot?.preferences.hiddenPanels ?? []
  const toggleShortcut = (id: DesktopShortcut) => update({ hiddenPanels: hidden.includes(id) ? hidden.filter(item => item !== id) : [...hidden, id] })
  return <section className="appearance-section widget-settings" id="desktop-widget-settings" aria-labelledby="widget-settings-heading">
    <SettingsHeading icon={MonitorDot} title="桌面便签" id="widget-settings-heading"><p>只保留你需要的便签；顺序与显示状态会自动保存。</p></SettingsHeading>
    <div className="appearance-card settings-panel">
      <div className="widget-behavior-grid">
        {[
          { key: 'enabled', title: '显示桌面便签', label: '启用桌面便签', checked: snapshot?.preferences.enabled ?? false },
          { key: 'openAtLogin', title: '开机时启动', label: '开机启动桌面便签', checked: snapshot?.preferences.openAtLogin ?? false },
          { key: 'alwaysOnTop', title: '始终置顶', label: '桌面便签始终置顶', checked: snapshot?.preferences.alwaysOnTop ?? false }
        ].map(item => <div className="settings-toggle-row" key={item.key}><span>{item.title}</span><label className="settings-switch"><input type="checkbox" role="switch" aria-label={item.label} disabled={!snapshot || busy} checked={item.checked} onChange={event => { void update({ [item.key]: event.target.checked }) }} /><i aria-hidden="true" /></label></div>)}
      </div>
      <div className="widget-visibility-setting">
        <div className="settings-subheading"><div><h3>显示哪些便签</h3><p>{desktopShortcuts.length - hidden.length} 个便签正在显示</p></div></div>
        <div className="widget-visibility-grid" role="group" aria-label="选择显示的桌面便签">
          {desktopShortcuts.map(id => {
            const Icon = shortcutIcons[id], visible = !hidden.includes(id)
            return <button type="button" key={id} aria-pressed={visible} disabled={!snapshot || busy} onClick={() => { void toggleShortcut(id) }}>
              <Icon size={19} /><span>{desktopPanelTitles[id]}</span>{visible ? <Eye size={17} /> : <EyeOff size={17} />}
            </button>
          })}
        </div>
      </div>
      <div className="widget-settings-actions">
        <Button disabled={!snapshot || busy} onClick={async () => {
          const result = await window.workbench.showWidget()
          if (result.ok) setSnapshot(result.data); else setError(result.error.message)
        }}><CheckCircle2 size={16} />显示桌面便签</Button>
        <Button disabled={!snapshot || busy} onClick={async () => {
          const result = await window.workbench.openDesktopPanel('more')
          if (!result.ok) setError(result.error.message)
        }}><SlidersHorizontal size={16} />调整便签顺序</Button>
      </div>
    </div>
    {(error || snapshot?.startupError) && <p className="field-error" role="alert">{error || snapshot?.startupError}</p>}
  </section>
}
