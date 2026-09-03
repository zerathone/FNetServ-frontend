import type { ReactNode } from 'react'

type StateViewProps = {
  title: string
  description?: string
  action?: ReactNode
}

export function StateView({ title, description, action }: StateViewProps) {
  return (
    <div className="ds-state">
      <h2 className="ds-state__title">{title}</h2>
      {description ? <p className="ds-state__description">{description}</p> : null}
      {action}
    </div>
  )
}
