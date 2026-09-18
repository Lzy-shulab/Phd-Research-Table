import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { useRef, type ReactNode } from 'react'
import { Button } from './button'

// shadcn-style composition; Radix owns focus trapping, Escape, and focus restoration.
export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  className?: string
  children: ReactNode
}) {
  const origin = useRef(document.activeElement)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content className={`dialog-content ${className ?? ''}`} onCloseAutoFocus={(event) => {
          const element = origin.current
          if (element instanceof HTMLElement && element.isConnected) { event.preventDefault(); element.focus() }
        }}>
          <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="dialog-description">
            {description}
          </DialogPrimitive.Description>
          <DialogPrimitive.Close asChild>
            <Button variant="ghost" className="icon-button dialog-close" aria-label="关闭对话框">
              <X size={17} />
            </Button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
export function ConfirmDialog({
  open,
  title,
  description,
  busy,
  onClose,
  onConfirm
}: {
  open: boolean
  title: string
  description: string
  busy?: boolean
  onClose: () => void
  onConfirm: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value && !busy) onClose()
      }}
      title={title}
      description={description}
    >
      <div className="dialog-actions">
        <Button autoFocus onClick={onClose} disabled={busy}>
          取消
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={busy}>
          {busy ? '正在删除…' : '删除'}
        </Button>
      </div>
    </Dialog>
  )
}
