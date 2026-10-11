import { useId, useState, type ReactNode } from 'react'
import { CaretDown, CaretUp } from '@phosphor-icons/react'
import { IconButton } from '../../design-system/components'

type InspectorGroupProps = {
  icon: ReactNode
  title: string
  /** Badge dat ngay sau tieu de, cung dong. */
  badges?: ReactNode
  /** Dong thu 2 o dang compact -- 1 dong, cat "..." neu dai. */
  summary?: ReactNode
  /** Nut chinh cua nhom, luon hien (compact lan expanded). */
  action?: ReactNode
  /** Mo san khi nhom vua hien (mac dinh thu gon). Chi la gia tri khoi tao. */
  defaultExpanded?: boolean
  /** Noi dung day du, chi hien khi expand. Bo trong = nhom khong co nut expand. */
  children?: ReactNode
}

/**
 * Nhom trong drawer chi tiet may. Compact: [icon] tieu de + 1 dong tom tat
 * [nut chinh] [mui ten]. Bam mui ten (hoac vung chu) de bung noi dung day du.
 * State expand la cuc bo -- caller doi `key` khi doi may de nhom tu thu gon lai.
 */
export function InspectorGroup({
  icon,
  title,
  badges,
  summary,
  action,
  defaultExpanded = false,
  children,
}: InspectorGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  const bodyId = useId()
  const expandable = children != null && children !== false

  return (
    <section className={expanded ? 'ws-group ws-group--expanded' : 'ws-group'}>
      <div className="ws-group__header">
        <span className="ws-group__icon" aria-hidden="true">{icon}</span>
        <div
          className={expandable ? 'ws-group__text ws-group__text--clickable' : 'ws-group__text'}
          onClick={expandable ? () => setExpanded((value) => !value) : undefined}
        >
          <div className="ws-group__titleRow">
            <h3 className="ws-group__title">{title}</h3>
            {badges}
          </div>
          {summary != null && summary !== '' ? <p className="ws-group__summary">{summary}</p> : null}
        </div>
        {action ? <div className="ws-group__action">{action}</div> : null}
        {expandable ? (
          <IconButton
            label={expanded ? `Thu gọn ${title}` : `Mở rộng ${title}`}
            icon={expanded ? <CaretUp size={16} weight="bold" /> : <CaretDown size={16} weight="bold" />}
            aria-expanded={expanded}
            aria-controls={bodyId}
            onClick={() => setExpanded((value) => !value)}
          />
        ) : null}
      </div>
      {expandable && expanded ? (
        <div className="ws-group__body" id={bodyId}>
          {children}
        </div>
      ) : null}
    </section>
  )
}
