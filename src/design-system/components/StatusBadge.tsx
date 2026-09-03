import type { ReactNode } from 'react'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export function StatusBadge({
  tone = 'neutral',
  children,
}: {
  tone?: StatusTone
  children: ReactNode
}) {
  return <span className={`ds-badge ds-badge--${tone}`}>{children}</span>
}
