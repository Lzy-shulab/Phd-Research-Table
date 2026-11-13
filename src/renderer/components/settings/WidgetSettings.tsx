import { useEffect, useState } from 'react'
import { MonitorDot } from 'lucide-react'
import type { WidgetPreferencesPatch, WidgetSnapshot } from '../../../shared/widget'
import { Button } from '../ui/button'
import { SettingsHeading } from './SettingsHeading'

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
    } catch { setError('桌面面板设置未能保存，请重试。') }
    finally { setBusy(false) }
  }
  return <section className="appearance-section" id="desktop-widget-settings" aria-labelledby="widget-settings-heading">
    <SettingsHeading icon={MonitorDot} title="桌面打卡面板" id="widget-settings-heading">{null}</SettingsHeading>
    <div className="appearance-card">
      <div className="appearance-setting"><div><h3>显示桌面面板</h3></div><label className="checkbox-row"><input type="checkbox" role="switch" aria-label="启用桌面打卡面板" disabled={!snapshot || busy} checked={snapshot?.preferences.enabled ?? false} onChange={event => { void update({ enabled: event.target.checked }) }} /></label></div>
      <div className="appearance-setting"><div><h3>开机启动面板</h3></div><label className="checkbox-row"><input type="checkbox" role="switch" aria-label="开机启动面板" disabled={!snapshot || busy} checked={snapshot?.preferences.openAtLogin ?? false} onChange={event => { void update({ openAtLogin: event.target.checked }) }} /></label></div>
      <div className="appearance-setting"><div><h3>始终置顶</h3></div><label className="checkbox-row"><input type="checkbox" role="switch" aria-label="桌面面板始终置顶" disabled={!snapshot || busy} checked={snapshot?.preferences.alwaysOnTop ?? false} onChange={event => { void update({ alwaysOnTop: event.target.checked }) }} /></label></div>
      <div className="appearance-setting"><Button disabled={!snapshot || busy} onClick={async () => {
        const result = await window.workbench.showWidget()
        if (result.ok) setSnapshot(result.data); else setError(result.error.message)
      }}>显示面板</Button></div>
    </div>
    {(error || snapshot?.startupError) && <p className="field-error" role="alert">{error || snapshot?.startupError}</p>}
  </section>
}
