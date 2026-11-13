import { useState, type ReactNode } from 'react'
import { reducedDesktopMotion } from './desktop-motion'

export function DesktopDisclosure({ open, id, children }: { open: boolean; id?: string; children: () => ReactNode }) {
  const [shown, setShown] = useState(open)
  if (open && !shown) setShown(true)
  return <div className="desktop-disclosure" id={id} data-open={open} inert={!open} aria-hidden={!open} onTransitionEnd={event => {
    if (!open && event.target === event.currentTarget && event.propertyName === 'grid-template-rows') setShown(false)
  }}>
    <div className="desktop-disclosure-clip">{(open || shown && !reducedDesktopMotion()) && children()}</div>
  </div>
}
