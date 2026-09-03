import { useEffect, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes } from 'react'

type MoneyInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'inputMode' | 'value' | 'onChange'
> & {
  label: string
  value: number | null
  onChange: (value: number | null) => void
  hint?: string
  error?: string
  currency?: string
  allowNegative?: boolean
}

const formatter = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 })

function toDisplay(value: number | null) {
  return value === null ? '' : formatter.format(value)
}

export function MoneyInput({
  label,
  value,
  onChange,
  hint,
  error,
  currency = 'đ',
  allowNegative = false,
  id,
  className = '',
  ...props
}: MoneyInputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const messageId = `${inputId}-message`
  const [display, setDisplay] = useState(() => toDisplay(value))
  const inputRef = useRef<HTMLInputElement>(null)

  useLayoutEffect(() => {
    if (props.autoFocus && !props.disabled) inputRef.current?.focus()
  }, [props.autoFocus, props.disabled])

  useEffect(() => {
    setDisplay(toDisplay(value))
  }, [value])

  return (
    <label className={`ds-field ${className}`}>
      <span className="ds-field__label">{label}</span>
      <span className={`ds-money-input${error ? ' ds-money-input--error' : ''}`}>
        <input
          {...props}
          ref={inputRef}
          id={inputId}
          className="ds-money-input__control"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          value={display}
          aria-invalid={Boolean(error)}
          aria-describedby={hint || error ? messageId : undefined}
          onChange={(event) => {
            const retainFocus = props.autoFocus && document.activeElement === event.currentTarget
            const raw = event.target.value
            const digits = raw.replace(/\D/g, '')
            const negative = allowNegative && raw.trimStart().startsWith('-')
            const nextValue = digits ? Number(digits) * (negative ? -1 : 1) : null
            setDisplay(nextValue === null ? '' : formatter.format(nextValue))
            onChange(nextValue)

            if (retainFocus) {
              window.requestAnimationFrame(() => inputRef.current?.focus())
            }
          }}
        />
        <span aria-hidden="true">{currency}</span>
      </span>
      {error || hint ? (
        <span
          id={messageId}
          className={error ? 'ds-field__error' : 'ds-field__hint'}
        >
          {error ?? hint}
        </span>
      ) : null}
    </label>
  )
}
