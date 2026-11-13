import { SquarePen } from 'lucide-react'
import { useWorkbenchCodex } from '../../stores/workbench-codex'
import { Button } from '../ui/button'

export function CodexNewChat() {
  const running = useWorkbenchCodex(state => !!state.running)
  const start = async () => {
    const { turns, draft, reset } = useWorkbenchCodex.getState()
    if (turns.length || draft) await reset()
    document.getElementById('codex-message')?.focus()
  }

  return <Button className="codex-new-chat" disabled={running} onClick={() => void start()}>
    <SquarePen size={17} aria-hidden="true" />
    新对话
  </Button>
}
