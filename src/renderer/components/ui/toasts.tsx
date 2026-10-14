import { AlertCircle, Info, X } from 'lucide-react'
import { useWorkbench } from '../../stores/workbench'
import { Button } from './button'
import { useEffect } from 'react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { settleSpring } from '../../lib/motion'
function ToastItem({ notice, dismiss }: { notice: { id: number; message: string; kind: 'error' | 'info' }; dismiss: (id: number) => void }) {
  const reduced = useReducedMotion()
  useEffect(() => {
    if (notice.kind !== 'info') return
    const timer = window.setTimeout(() => dismiss(notice.id), 4000)
    return () => window.clearTimeout(timer)
  }, [notice.id, notice.kind, dismiss])
  return <motion.div layout="position" initial={{ opacity: 0, y: reduced ? 0 : 8, scale: reduced ? 1 : 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: reduced ? 0 : 4, transition: { duration: 0.12 } }} transition={reduced ? { duration: 0.08 } : settleSpring} className={`toast toast-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
    {notice.kind === 'error' ? <AlertCircle size={17} /> : <Info size={17} />}
    <span>{notice.message}</span>
    <Button variant="ghost" className="icon-button" aria-label="关闭消息" onClick={() => dismiss(notice.id)}><X size={15} /></Button>
  </motion.div>
}
export function Toasts() {
  const notices = useWorkbench((s) => s.notices)
  const dismiss = useWorkbench((s) => s.dismiss)
  return (
    <div className="toast-region" aria-label="消息提示">
      <AnimatePresence initial={false}>{notices.map((n) => <ToastItem key={n.id} notice={n} dismiss={dismiss} />)}</AnimatePresence>
    </div>
  )
}
