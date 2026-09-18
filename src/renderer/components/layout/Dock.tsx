import { modules } from '../../app/modules'
import { useWorkbench } from '../../stores/workbench'
import { cn } from '../../lib/utils'
import { motion } from 'motion/react'
export function Dock() {
  const section = useWorkbench((s) => s.section)
  const setSection = useWorkbench((s) => s.setSection)
  return (
    <div className="dock-wrap">
      <nav className="dock" aria-label="科研工作空间">
        {modules.map((item) => (
          <button
            key={item.id}
            className={cn('dock-item', section === item.id && 'selected')}
            aria-current={section === item.id ? 'page' : undefined}
            onClick={() => setSection(item.id)}
          >
            {section === item.id && <motion.span className="dock-selection" layoutId="workspace-dock" />}
            <item.icon size={19} strokeWidth={1.65} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}
