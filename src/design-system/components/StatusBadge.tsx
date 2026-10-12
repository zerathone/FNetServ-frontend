import type { ReactNode } from 'react'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export function StatusBadge({
  tone = 'neutral',
  title,
  children,
}: {
  tone?: StatusTone
  title?: string
  children: ReactNode
}) {
  return (
    <span className={`ds-badge ds-badge--${tone}`} title={title}>
      {children}
    </span>
  )
}
