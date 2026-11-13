import { useRef } from 'react'
import { useGSAP } from '@gsap/react'
import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'

gsap.registerPlugin(useGSAP, CustomEase)
CustomEase.create('desktop-settle', '.22,1,.36,1')

export function ProgressRing({ value, label, small = false, children }: { value: number | null; label: string; small?: boolean; children?: React.ReactNode }) {
  const ref = useRef<SVGCircleElement>(null)
  const previous = useRef(0)
  const percent = Math.max(0, Math.min(100, value ?? 0))
  useGSAP(() => {
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
    gsap.fromTo(ref.current, { strokeDashoffset: 100 - previous.current }, { strokeDashoffset: 100 - percent, duration: reduce ? 0 : .5, ease: 'desktop-settle' })
    previous.current = percent
  }, { dependencies: [percent], scope: ref, revertOnUpdate: true })
  return <span className={`progress-ring ${small ? 'is-small' : ''}`} role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(value)}>
    <svg viewBox="0 0 144 144" aria-hidden="true"><circle className="progress-track" cx="72" cy="72" r="62"/><circle ref={ref} className="progress-value" cx="72" cy="72" r="62" pathLength="100" strokeDasharray="100" strokeDashoffset={100-percent}/></svg>
    <span className="progress-ring-label">{children ?? <><strong>{value === null ? '—' : Math.round(value)}</strong>{value !== null && <small>%</small>}</>}</span>
  </span>
}
