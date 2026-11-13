import { gsap } from 'gsap'

export const reducedDesktopMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function captureDesktopPositions(rows: Iterable<HTMLElement>) {
  const positions = new Map<HTMLElement, number>()
  if (reducedDesktopMotion()) return positions
  for (const row of rows) {
    if (row.getClientRects().length) positions.set(row, row.offsetTop + Number(gsap.getProperty(row, 'y')))
  }
  return positions
}

export function animateDesktopReorder(positions: Map<HTMLElement, number>, updatePointer?: () => void) {
  const reduce = reducedDesktopMotion()
  const tweens: gsap.core.Tween[] = []
  for (const [row, previous] of positions) {
    gsap.killTweensOf(row)
    const distance = previous - row.offsetTop
    if (reduce || !distance || !row.getClientRects().length) { gsap.set(row, { clearProps: 'transform' }); continue }
    tweens.push(gsap.fromTo(row, { y: distance }, { y: 0, duration: .24, ease: 'power3.out', clearProps: 'transform', onUpdate: updatePointer }))
  }
  return () => { for (const tween of tweens) tween.kill() }
}
