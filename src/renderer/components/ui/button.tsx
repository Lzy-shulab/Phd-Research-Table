import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'
export function Button({
  className,
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'default' | 'primary' | 'ghost' | 'danger'
}) {
  return (
    <button type="button" className={cn('button', `button-${variant}`, className)} {...props} />
  )
}
