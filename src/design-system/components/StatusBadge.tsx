import type { ReactNode } from 'react'

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

export function StatusBadge({
  tone = 'neutral',
  title,
  dot = true,
  children,
}: {
  tone?: StatusTone
  title?: string
  /** Chấm tròn đầu badge = "đang ở trạng thái này" (hiện tại). Bản ghi lịch sử/nhật ký thì đặt false. */
  dot?: boolean
  children: ReactNode
}) {
  return (
    <span className={`ds-badge ds-badge--${tone}${dot ? '' : ' ds-badge--no-dot'}`} title={title}>
      {children}
    </span>
  )
}
