import type { Section } from '../../../shared/types'
import { modules } from '../../app/modules'
import { cn } from '../../lib/utils'

export function WorkspaceGlyph({ section, className }: { section: Section; className?: string }) {
  const Icon = modules.find(item => item.id === section)!.icon
  return <span className={cn('workspace-glyph', `glyph-${section}`, className)} aria-hidden="true"><Icon size={20} strokeWidth={1.75} /></span>
}
