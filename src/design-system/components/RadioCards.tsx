import { useId, type ReactNode } from 'react'

export type RadioCardOption<T extends string> = {
  value: T
  label: string
  /** Dòng giải thích mờ dưới nhãn — tuỳ chọn; không truyền thì thẻ chỉ có nhãn. */
  description?: ReactNode
  /** Vô hiệu riêng một lựa chọn. */
  disabled?: boolean
  /** Chú thích khi rê chuột (thường giải thích vì sao bị vô hiệu). */
  title?: string
}

type RadioCardsProps<T extends string> = {
  value: T
  options: readonly RadioCardOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
  disabled?: boolean
}

/**
 * Chọn MỘT trong vài giá trị của form: mỗi lựa chọn là một thẻ radio, luôn thấy hết các lựa chọn.
 * Dùng cho giá trị sẽ được lưu (cài đặt, loại dữ liệu). Chuyển tab/chế độ xem thì dùng Segmented.
 */
export function RadioCards<T extends string>({ value, options, onChange, ariaLabel, disabled }: RadioCardsProps<T>) {
  const name = useId()
  return (
    <div className="ds-radio-cards" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const optionDisabled = disabled || option.disabled
        return (
          <label
            key={option.value}
            className={`ds-radio-card${option.value === value ? ' is-selected' : ''}${optionDisabled ? ' is-disabled' : ''}`}
            title={option.title}
          >
            <input
              type="radio"
              name={name}
              checked={option.value === value}
              disabled={optionDisabled}
              onChange={() => onChange(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              {option.description ? <small>{option.description}</small> : null}
            </span>
          </label>
        )
      })}
    </div>
  )
}
