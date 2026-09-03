import type { ReactNode } from 'react'

type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__copy">
        {eyebrow ? <p className="ds-page-header__eyebrow">{eyebrow}</p> : null}
        <h1 className="ds-page-header__title">{title}</h1>
        {description ? <p className="ds-page-header__description">{description}</p> : null}
      </div>
      {actions ? <div className="ds-page-header__actions">{actions}</div> : null}
    </header>
  )
}
