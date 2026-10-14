// Shared timings for continuity, immediate feedback, and shorter departures.
export const settleSpring = { type: 'spring' as const, stiffness: 460, damping: 38, mass: 0.9 }
export const arrivalEase = [0.16, 1, 0.3, 1] as const
export const departureEase = [0.4, 0, 1, 1] as const
