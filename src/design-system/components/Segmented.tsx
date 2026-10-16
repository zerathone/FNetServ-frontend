export type SegmentedOption<T extends string> = {
  value: T
  label: string
  /** task 2.22r: vô hiệu riêng 1 lựa chọn (vd engine không khả dụng) — tuỳ chọn, mặc định bật. */
  disabled?: boolean
  /** Chú thích hiện khi rê chuột (thường giải thích vì sao bị vô hiệu). */
  title?: string
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
        <button
          key={option.value}
          type="button"
          className={`ds-segmented__item${option.value === value ? ' is-active' : ''}`}
          aria-pressed={option.value === value}
          disabled={disabled || option.disabled}
          title={option.title}
          onClick={() => !disabled && !option.disabled && onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
