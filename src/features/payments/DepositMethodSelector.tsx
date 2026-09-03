import {
  DEPOSIT_METHOD_OPTIONS,
  type DepositMethod,
} from './depositModel'
import './deposit-method.css'

type DepositMethodSelectorProps = {
  value: DepositMethod
  disabled?: boolean
  onChange: (method: DepositMethod) => void
}

export function DepositMethodSelector({
  value,
  disabled = false,
  onChange,
}: DepositMethodSelectorProps) {
  return (
    <fieldset className="deposit-method" disabled={disabled}>
      <legend>Phương thức nạp tiền</legend>
      <div className="deposit-method__grid" role="radiogroup">
        {DEPOSIT_METHOD_OPTIONS.map((option) => (
          <label
            key={option.id}
            className={`deposit-method__option${value === option.id ? ' is-selected' : ''}`}
          >
            <input
              type="radio"
              name="deposit-method"
              value={option.id}
              checked={value === option.id}
              onChange={() => onChange(option.id)}
            />
            <strong className="deposit-method__label">{option.label}</strong>
            <span className="deposit-method__radio" aria-hidden="true" />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
