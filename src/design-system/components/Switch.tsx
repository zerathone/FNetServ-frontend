import { useId, type ReactNode } from 'react'
import './switch.css'

export type SwitchProps = {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Nhãn đọc cho trình đọc màn hình khi không có `label` hiển thị (vd công tắc nằm trong hàng tuỳ biến). */
  'aria-label'?: string
  label?: ReactNode
  description?: ReactNode
  disabled?: boolean
  className?: string
}

/**
 * Công tắc bật/tắt kiểu Windows — `<input type="checkbox" role="switch">` nên bàn phím (Space) và
 * trình đọc màn hình hoạt động sẵn. Có `label` thì render cả hàng (nhãn + mô tả bên trái, công tắc
 * bên phải); không có thì chỉ render công tắc trơn để nhúng vào hàng tuỳ biến.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  className = '',
  'aria-label': ariaLabel,
}: SwitchProps) {
  const id = useId()
  const control = (
    <span className="ds-switch">
      <input
        id={id}
        className="ds-switch__input"
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(event) => onCheckedChange(event.target.checked)}
      />
      <span className="ds-switch__track" aria-hidden="true" />
    </span>
  )

  if (!label) return control

  return (
    <label
      className={`ds-switch-row${disabled ? ' is-disabled' : ''} ${className}`.trim()}
      htmlFor={id}
    >
      <span className="ds-switch-row__copy">
        <strong>{label}</strong>
        {description ? <small>{description}</small> : null}
      </span>
      {control}
    </label>
  )
}
