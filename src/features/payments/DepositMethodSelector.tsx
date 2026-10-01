import { Bank, Money, QrCode } from '@phosphor-icons/react'
import {
  DEPOSIT_METHOD_OPTIONS,
  type DepositMethod,
} from './depositModel'
import './deposit-method.css'

const METHOD_ICONS: Record<DepositMethod, typeof Money> = {
  cash: Money,
  transfer: Bank,
  qr: QrCode,
}

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
        {DEPOSIT_METHOD_OPTIONS.map((option) => {
          const Icon = METHOD_ICONS[option.id]
          return (
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
              <Icon className="deposit-method__icon" size={18} weight="bold" aria-hidden="true" />
              <strong className="deposit-method__label">{option.label}</strong>
              <span className="deposit-method__radio" aria-hidden="true" />
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
