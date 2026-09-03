import type { ReactNode } from 'react'

type AlertTone = 'info' | 'warning' | 'danger' | 'success'

const icons: Record<AlertTone, string> = {
  info: 'i',
  warning: '!',
  danger: '×',
  success: '✓',
}

export function InlineAlert({
  tone = 'info',
  children,
}: {
  tone?: AlertTone
  children: ReactNode
}) {
  return (
    <div className={`ds-alert ds-alert--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      <span className="ds-alert__icon" aria-hidden="true">
        {icons[tone]}
      </span>
      <div>{children}</div>
    </div>
  )
}
