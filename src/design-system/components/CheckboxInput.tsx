import { useId, type InputHTMLAttributes, type ReactNode } from 'react'

/**
 * Input-group 1 dòng với checkbox prefix gắn liền bên trái:
 *
 *   [☐ label | ______placeholder______]
 *
 * Khi `checked=false` → toàn bộ control mờ đi (`is-off`).
 * Nhận tất cả props của `<input>` (trừ `type`) để truyền thêm
 * `inputMode`, `maxLength`, `value`, `onChange`, `disabled`, v.v.
 *
 * @example
 * <CheckboxInput
 *   label="Tối thiểu"
 *   checked={form.useMinPaid}
 *   onCheckedChange={(v) => update('useMinPaid', v)}
 *   placeholder="Số tiền (đ)"
 *   value={form.minPaid}
 *   disabled={!form.useMinPaid}
 *   inputMode="numeric"
 *   maxLength={11}
 *   onChange={(e) => update('minPaid', e.target.value.trim())}
 *   error={errors.minPaid}
 * />
 */

export type CheckboxInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type'
> & {
  /** Text hiển thị trong prefix (cạnh checkbox). */
  label: ReactNode
  /** Trạng thái checkbox. */
  checked: boolean
  /** Callback khi checkbox thay đổi. */
  onCheckedChange: (checked: boolean) => void
  /** Thông báo lỗi hiển thị dưới control. */
  error?: string
}

export function CheckboxInput({
  label,
  checked,
  onCheckedChange,
  error,
  id,
  className = '',
  ...inputProps
}: CheckboxInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const errorId = `${inputId}-error`

  return (
    <div className={`ds-checkbox-input-field ${className}`.trim()}>
      <div className={`ds-checkbox-input${checked ? '' : ' is-off'}`}>
        {/* Prefix: checkbox + label gắn liền, nền xám, border-right */}
        <label className="ds-checkbox-input__prefix" htmlFor={inputId}>
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => onCheckedChange(e.target.checked)}
          />
          <span>{label}</span>
        </label>

        {/* Input phần phải — flex chiếm hết không gian còn lại */}
        <input
          {...inputProps}
          id={inputId}
          type="text"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
        />
      </div>

      {error ? (
        <span id={errorId} className="ds-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  )
}
