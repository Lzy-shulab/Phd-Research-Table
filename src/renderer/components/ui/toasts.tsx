import { AlertCircle, Info, X } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { Button } from './button'
import { useEffect } from 'react'
function ToastItem({ notice, dismiss }: { notice: { id: number; message: string; kind: 'error' | 'info' }; dismiss: (id: number) => void }) {
  useEffect(() => {
    if (notice.kind !== 'info') return
    const timer = window.setTimeout(() => dismiss(notice.id), 4000)
    return () => window.clearTimeout(timer)
  }, [notice.id, notice.kind, dismiss])
  return <div className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
    {notice.kind === 'error' ? <AlertCircle size={17} /> : <Info size={17} />}
    <span>{notice.message}</span>
    <Button variant="ghost" className="icon-button" aria-label="关闭消息" onClick={() => dismiss(notice.id)}><X size={15} /></Button>
  </div>
}
export function Toasts() {
  const notices = useWorkbench((s) => s.notices)
  const dismiss = useWorkbench((s) => s.dismiss)
  return (
    <div className="toast-region" aria-label="消息提示">
      {notices.map((n) => <ToastItem key={n.id} notice={n} dismiss={dismiss} />)}
    </div>
  )
}
