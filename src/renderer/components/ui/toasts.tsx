import { AlertCircle, Info, X } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { Button } from './button'
export function Toasts() {
  const notices = useWorkbench((s) => s.notices)
  const dismiss = useWorkbench((s) => s.dismiss)
  return (
    <div className="toast-region" aria-label="消息提示">
      {notices.map((n) => (
        <div
          className={`toast toast-${n.kind}`}
          key={n.id}
          role={n.kind === 'error' ? 'alert' : 'status'}
        >
          {n.kind === 'error' ? <AlertCircle size={17} /> : <Info size={17} />}
          <span>{n.message}</span>
          <Button
            variant="ghost"
            className="icon-button"
            aria-label="关闭消息"
            onClick={() => dismiss(n.id)}
          >
            <X size={15} />
          </Button>
        </div>
      ))}
    </div>
  )
}
