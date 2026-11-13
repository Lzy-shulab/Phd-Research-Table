import type { HTMLAttributes } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion } from 'motion/react'
import { arrivalEase } from '../../lib/motion'

function DisclosureContent({ children, id, role, 'aria-labelledby': labelledBy }: HTMLAttributes<HTMLDivElement>) {
  const present = useIsPresent()
  const reduced = useReducedMotion()
  return <motion.div className="workbench-disclosure" id={id} role={role} aria-labelledby={labelledBy} inert={!present}
    initial={{ height: 0, opacity: .65 }} animate={{ height: 'auto', opacity: 1 }}
    exit={{ height: 0, opacity: 0, transition: { duration: reduced ? 0 : .13 } }}
    transition={{ duration: reduced ? 0 : .22, ease: arrivalEase }}>
    {children}
  </motion.div>
}

export function Disclosure({ open, ...props }: { open: boolean } & HTMLAttributes<HTMLDivElement>) {
  return <AnimatePresence initial={false}>{open && <DisclosureContent {...props} />}</AnimatePresence>
}
