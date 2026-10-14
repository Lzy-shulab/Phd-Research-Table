import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'

export function SettingsHeading({ icon: Icon, title, id, children }: { icon: LucideIcon; title: string; id?: string; children: ReactNode }) {
  return <div className="storage-section-heading">
    <span className="settings-heading-icon" aria-hidden="true"><Icon size={20} strokeWidth={1.7} /></span>
    <div><h2 id={id}>{title}</h2>{children}</div>
  </div>
}
