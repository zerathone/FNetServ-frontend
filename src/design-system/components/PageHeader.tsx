import type { ReactNode } from 'react'

type PageHeaderProps = {
  eyebrow?: string
  title: string
  description?: string
  actions?: ReactNode
}

// Template gọn 1 hàng: [NHÃN / Tiêu đề] [mô tả mờ, tối đa 2 dòng] ........ [thao tác]. Mô tả dài bị cắt thì
// có tooltip (title) giữ nguyên văn. Cần bố cục khác cho 1 trang thì sửa CSS .ds-page-header, không đổi props.
export function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <header className="ds-page-header">
      <div className="ds-page-header__copy">
        <div className="ds-page-header__heading">
          {eyebrow ? <p className="ds-page-header__eyebrow">{eyebrow}</p> : null}
          <h1 className="ds-page-header__title">{title}</h1>
        </div>
        {description ? (
          <p className="ds-page-header__description" title={description}>
            {description}
          </p>
        ) : null}
      </div>
      {actions ? <div className="ds-page-header__actions">{actions}</div> : null}
    </header>
  )
}
