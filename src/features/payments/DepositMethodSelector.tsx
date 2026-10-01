import { useEffect } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bank, Money, QrCode } from '@phosphor-icons/react'
import { getCounterPaymentEnabled, updateCounterPaymentEnabled } from '../../api/deposit'
import { useAuthStore } from '../../store/auth'
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

const COUNTER_PAYMENT_KEY = ['settings', 'counter-payment'] as const

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
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const queryClient = useQueryClient()

  // Parity MFC INT_COUNTER_PAYMENT: mặc định bật; chỉ tắt khi server trả "0".
  // Lỗi đọc cấu hình → giữ bật (không khoá nhầm nghiệp vụ đang chạy).
  const counterPayment = useQuery({
    queryKey: COUNTER_PAYMENT_KEY,
    queryFn: getCounterPaymentEnabled,
    staleTime: 30_000,
  })
  const transferEnabled = counterPayment.data ?? true

  const toggleMutation = useMutation({
    mutationFn: updateCounterPaymentEnabled,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: COUNTER_PAYMENT_KEY }),
  })

  // Đang chọn Chuyển khoản mà bị tắt → về Tiền mặt để không submit phương thức đã khoá.
  useEffect(() => {
    if (!transferEnabled && value === 'transfer') onChange('cash')
  }, [transferEnabled, value, onChange])

  return (
    <fieldset className="deposit-method" disabled={disabled}>
      <legend>Phương thức nạp tiền</legend>
      <div className="deposit-method__grid" role="radiogroup">
        {DEPOSIT_METHOD_OPTIONS.map((option) => {
          const Icon = METHOD_ICONS[option.id]
          const optionDisabled = option.id === 'transfer' && !transferEnabled
          return (
            <label
              key={option.id}
              className={`deposit-method__option${value === option.id ? ' is-selected' : ''}${optionDisabled ? ' is-disabled' : ''}`}
              title={optionDisabled ? 'Chuyển khoản đang tắt tại quầy' : undefined}
            >
              <input
                type="radio"
                name="deposit-method"
                value={option.id}
                checked={value === option.id}
                disabled={optionDisabled}
                onChange={() => onChange(option.id)}
              />
              <Icon className="deposit-method__icon" size={18} weight="bold" aria-hidden="true" />
              <strong className="deposit-method__label">{option.label}</strong>
              <span className="deposit-method__radio" aria-hidden="true" />
            </label>
          )
        })}
      </div>
      {isAdmin ? (
        <label className="deposit-method__admin-toggle">
          <input
            type="checkbox"
            checked={transferEnabled}
            disabled={toggleMutation.isPending || counterPayment.isLoading}
            onChange={(event) => toggleMutation.mutate(event.target.checked)}
          />
          <span>Cho phép Chuyển khoản</span>
        </label>
      ) : null}
      {toggleMutation.isError ? (
        <p className="deposit-amount__status" role="alert">
          {toggleMutation.error instanceof Error
            ? toggleMutation.error.message
            : 'Không đổi được cấu hình Chuyển khoản.'}
        </p>
      ) : null}
    </fieldset>
  )
}
