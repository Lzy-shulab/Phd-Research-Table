import { forwardRef, type ReactNode } from 'react'
import { motion, useIsPresent } from 'motion/react'
import { arrivalEase, departureEase } from '../../lib/motion'

// Exiting content is inert while the new workspace is already available.
export const WorkspaceTransition = forwardRef<HTMLDivElement, { children: ReactNode; reduced: boolean }>(function WorkspaceTransition({ children, reduced }, ref) {
  const present = useIsPresent()
  return <motion.div ref={ref} className="workspace-stage" inert={!present} aria-hidden={!present || undefined}
    initial={{ opacity: reduced ? 1 : 0.58 }} animate={{ opacity: 1 }}
    exit={{ opacity: 0, transition: { duration: reduced ? 0 : 0.1, ease: departureEase } }}
    transition={{ duration: reduced ? 0 : 0.18, ease: arrivalEase }}>
    {children}
  </motion.div>
})
