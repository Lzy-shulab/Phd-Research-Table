import { forwardRef, type ReactNode } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { arrivalEase, departureEase } from '../../lib/motion'

// Exiting content is inert while the new workspace is already available.
export const WorkspaceTransition = forwardRef<HTMLDivElement, { children: ReactNode; reduced: boolean }>(function WorkspaceTransition({ children, reduced }, ref) {
  const present = useIsPresent()
  return <motion.div ref={ref} className="workspace-stage" inert={!present} aria-hidden={!present || undefined}
    initial={{ opacity: reduced ? 1 : 0.84, y: reduced ? 0 : 6 }} animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: reduced ? 0 : -3, transition: { duration: reduced ? 0 : 0.1, ease: departureEase } }}
    transition={{ duration: reduced ? 0 : 0.24, ease: arrivalEase }}>
    {children}
  </motion.div>
})
