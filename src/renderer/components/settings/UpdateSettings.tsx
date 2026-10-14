import { useEffect, useState } from 'react'
import { CheckCircle2, Download, RefreshCw, ShieldCheck } from 'lucide-react'
import type { Result } from '../../../shared/types'
import type { UpdateSnapshot } from '../../../shared/update'
import { useWorkbench } from '../../stores/workbench'
import { Button } from '../ui/button'
import { SettingsHeading } from './SettingsHeading'

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw new Error(result.error.message)
  return result.data
}

const pendingStates = new Set(['checking', 'downloading', 'installing'])

export function UpdateSettings() {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot | null>(null)
  const [error, setError] = useState('')
  useEffect(() => {
    const unsubscribe = window.workbench.onUpdateChanged((next) => {
      setSnapshot(next)
      if (next.state !== 'error') setError('')
    })
    void window.workbench.updateSnapshot()
      .then((result) => setSnapshot(unwrap(result)))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '无法读取更新状态。'))
    return unsubscribe
  }, [])
  const act = async () => {
    setError('')
    try {
      if (snapshot?.state === 'ready') {
        if (!await useWorkbench.getState().flushAll()) throw new Error('请先保存尚未完成的任务修改。')
        unwrap(await window.workbench.installUpdate())
      } else setSnapshot(unwrap(await window.workbench.prepareUpdate()))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '更新未能完成，请稍后重试。')
    }
  }
  const busy = snapshot ? pendingStates.has(snapshot.state) : true
  const buttonLabel = snapshot?.state === 'ready'
    ? '重启并更新'
    : snapshot?.state === 'checking'
      ? '正在检查…'
      : snapshot?.state === 'downloading'
        ? snapshot.progress === null ? '正在下载…' : `正在下载 ${snapshot.progress}%`
        : snapshot?.state === 'installing'
          ? '正在更新…'
          : '检查并下载更新'
  const Icon = snapshot?.state === 'ready' ? CheckCircle2 : snapshot?.state === 'downloading' ? Download : RefreshCw
  return <section className="update-settings settings-action-card" aria-labelledby="update-heading">
    <SettingsHeading icon={ShieldCheck} title="软件更新" id="update-heading">
        {(error || snapshot?.message) && <p className={error ? 'field-error update-message' : 'update-message'} role={error ? 'alert' : 'status'}>{error || snapshot?.message}</p>}
    </SettingsHeading>
    <Button disabled={busy} onClick={() => void act()} aria-label={buttonLabel}>
      <Icon size={15} className={busy ? 'spin-when-busy' : undefined} />{buttonLabel}
    </Button>
  </section>
}
