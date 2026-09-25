import type { ReactNode } from 'react'

type ListToolbarProps = {
  count: ReactNode
  actions: ReactNode
  className?: string
}

/** Count + pagination row, always placed above a list's column header. */
export function ListToolbar({ count, actions, className = '' }: ListToolbarProps) {
  return (
    <div className={`ds-list-toolbar ${className}`.trim()}>
      <span className="ds-list-toolbar__count">{count}</span>
      <div className="ds-list-toolbar__actions">{actions}</div>
    </div>
  )
}
