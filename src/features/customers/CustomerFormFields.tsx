import type { ReactNode } from 'react'
import { DatePicker } from '../../design-system/components'
import './customers.css'

// Thành phần form dùng CHUNG cho "Thêm hội viên/nhân viên" (CreateUserDialog) và "Sửa hồ sơ" (CustomerInspector):
// ô nhập có biểu tượng đứng đầu, nhãn là placeholder (tên trường nằm ở tooltip + trình đọc màn hình), lỗi/gợi ý nằm dưới khung.

type DateInputProps = {
  id: string
  placeholder: string
  value: string
  onChange: (value: string) => void
  disabled?: boolean
}

/** Nằm trong khung "icon + ngày": dùng biến thể embedded (khung ngoài đã có viền), chữ gợi ý là placeholder. */
export function DateInput({ id, placeholder, value, onChange, disabled }: DateInputProps) {
  return (
    <DatePicker
      id={id}
      className="ds-date-picker--embedded"
      placeholder={placeholder}
      aria-label={placeholder}
      value={value}
      disabled={disabled}
      onChange={onChange}
    />
  )
}

type FieldProps = {
  /** Tên trường: hiện ở tooltip và cho trình đọc màn hình; chữ hiển thị nằm ở placeholder. */
  label: string
  icon: ReactNode
  wide?: boolean
  top?: boolean
  error?: string
  hint?: string
  id: string
  children: ReactNode
}

export function Field({ label, icon, wide, top, error, hint, id, children }: FieldProps) {
  const groupClasses = ['ds-input-group', 'customer-create-form__group']
  if (error) groupClasses.push('is-invalid')
  if (top) groupClasses.push('customer-create-form__group--top')
  return (
    <div className={`ds-field customer-create-form__field${wide ? ' customer-create-form__wide' : ''}`}>
      <div className={groupClasses.join(' ')}>
        <label className="ds-input-group-separator customer-create-form__label" htmlFor={id} title={label}>
          {icon}
          <span className="ds-visually-hidden">{label}</span>
        </label>
        {children}
      </div>
      {error ? <span id={`${id}-error`} className="ds-field__error" role="alert">{error}</span> : null}
      {!error && hint ? <span id={`${id}-hint`} className="ds-field__hint">{hint}</span> : null}
    </div>
  )
}
