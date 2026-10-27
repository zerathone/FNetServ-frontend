import { Fragment, type ReactNode } from 'react'

export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** Icon đứng trước nhãn — tuỳ chọn. */
  icon?: ReactNode
  /** task 2.22r: vô hiệu riêng 1 lựa chọn (vd engine không khả dụng) — tuỳ chọn, mặc định bật. */
  disabled?: boolean
  /** Chú thích hiện khi rê chuột (thường giải thích vì sao bị vô hiệu). */
  title?: string
  /** Dòng phụ mờ nhỏ dưới nhãn (vd ngày tháng) — tuỳ chọn; có thì nút cao hơn thành 2 dòng. */
  sublabel?: string
  /** Vạch ngăn dọc ngay trước lựa chọn này (tách nhóm lựa chọn) — tuỳ chọn. */
  dividerBefore?: boolean
}

type SegmentedProps<T extends string> = {
  value: T
  options: readonly SegmentedOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}

// Nhóm nút chọn một trong vài chế độ xem (khác Select: luôn thấy hết lựa chọn).
export function Segmented<T extends string>({ value, options, onChange, ariaLabel, disabled }: SegmentedProps<T>) {
  return (
    <div className={`ds-segmented${disabled ? ' is-disabled' : ''}`} role="group" aria-label={ariaLabel}>
      {options.map((option) => (
        <Fragment key={option.value}>
          {option.dividerBefore ? <span className="ds-segmented__divider" aria-hidden="true" /> : null}
          <button
            type="button"
            className={`ds-segmented__item${option.value === value ? ' is-active' : ''}${option.sublabel ? ' has-sublabel' : ''}`}
            aria-pressed={option.value === value}
            disabled={disabled || option.disabled}
            title={option.title}
            onClick={() => !disabled && !option.disabled && onChange(option.value)}
          >
            {option.icon ? <span className="ds-segmented__icon">{option.icon}</span> : null}
            {option.sublabel ? (
              <span className="ds-segmented__text">
                {option.label}
                <small className="ds-segmented__sub">{option.sublabel}</small>
              </span>
            ) : (
              option.label
            )}
          </button>
        </Fragment>
      ))}
    </div>
  )
}
