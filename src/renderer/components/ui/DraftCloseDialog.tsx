import { Button } from './button'
import { Dialog } from './dialog'

export function DraftCloseDialog({ open, onContinue, onKeep, onDiscard }: {
  open: boolean
  onContinue: () => void
  onKeep: () => void
  onDiscard: () => void
}) {
  return <Dialog open={open} title="保留尚未保存的修改？" description="你可以保留本机草稿，下次打开继续；也可以放弃本次修改。" onOpenChange={(value) => { if (!value) onContinue() }}>
    <div className="dialog-actions draft-close-actions">
      <Button onClick={onContinue}>继续编辑</Button>
      <Button variant="danger" onClick={onDiscard}>放弃修改</Button>
      <Button variant="primary" onClick={onKeep}>保留草稿并关闭</Button>
    </div>
  </Dialog>
}
