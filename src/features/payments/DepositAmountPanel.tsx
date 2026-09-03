import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Backspace, CaretDown, CaretUp, Minus, PencilSimple } from '@phosphor-icons/react'
import {
  getDepositMoneyUnitSettings,
  updateDepositMoneyUnitSettings,
} from '../../api/deposit'
import {
  Button,
  InlineAlert,
  MoneyInput,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  parseDepositMoneyUnits,
  toggleDepositAmountSign,
} from './depositModel'
import './deposit-method.css'

type DepositAmountPanelProps = {
  value: number | null
  disabled?: boolean
  allowNegative: boolean
  onChange: (value: number | null) => void
  onIntentChange?: () => void
}

const moneyFormatter = new Intl.NumberFormat('vi-VN')

export function DepositAmountPanel({
  value,
  disabled = false,
  allowNegative,
  onChange,
  onIntentChange,
}: DepositAmountPanelProps) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [allowCustomAmount, setAllowCustomAmount] = useState(true)
  const [draftError, setDraftError] = useState('')
  const [denominationsExpanded, setDenominationsExpanded] = useState(false)

  const settingsQuery = useQuery({
    queryKey: ['settings', 'deposit-money-units'],
    queryFn: getDepositMoneyUnitSettings,
    retry: false,
  })

  useEffect(() => {
    if (!settingsQuery.data || editing) return
    setDraft(settingsQuery.data.units.join(', '))
    setAllowCustomAmount(settingsQuery.data.allowWorkstationCustomAmount)
  }, [editing, settingsQuery.data])

  const settingsMutation = useMutation({
    mutationFn: updateDepositMoneyUnitSettings,
    onSuccess: async (_, variables) => {
      setEditing(false)
      setDraftError('')
      try {
        const refreshed = await queryClient.fetchQuery({
          queryKey: ['settings', 'deposit-money-units'],
          queryFn: getDepositMoneyUnitSettings,
        })
        if (
          !variables.allowWorkstationCustomAmount &&
          refreshed.allowWorkstationCustomAmount
        ) {
          pushToast(
            'Đã lưu mệnh giá; máy chủ giữ quyền nhập tay vì license chưa bật FN1.',
            'info',
          )
        } else {
          pushToast('Đã lưu bảng mệnh giá nạp tiền.', 'success')
        }
      } catch {
        void queryClient.invalidateQueries({
          queryKey: ['settings', 'deposit-money-units'],
        })
        pushToast('Đã lưu; chưa đọc lại được cấu hình mới từ máy chủ.', 'info')
      }
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const changeAmount = (nextValue: number | null) => {
    onIntentChange?.()
    onChange(nextValue)
  }

  const selectUnit = (unit: number) => {
    changeAmount(unit)
  }

  const toggleDenominations = () => {
    setDenominationsExpanded((current) => {
      if (current) setEditing(false)
      return !current
    })
  }

  const saveSettings = () => {
    const parsed = parseDepositMoneyUnits(draft)
    setDraftError(parsed.error)
    if (parsed.error) return
    settingsMutation.mutate({
      units: parsed.units,
      allowWorkstationCustomAmount: allowCustomAmount,
    })
  }

  const configuredUnits = settingsQuery.data?.units ?? []
  // Keep compact mode in the same configured order as expanded mode. Reordering
  // after a click would move the focused button beneath the user's cursor.
  const compactUnits = configuredUnits.slice(0, 3)
  const displayedUnits = denominationsExpanded ? configuredUnits.slice(0, 12) : compactUnits

  return (
    <section className="deposit-amount">
      <MoneyInput
        label="Số tiền"
        value={value}
        allowNegative={allowNegative}
        disabled={disabled}
        autoFocus
        data-deposit-amount-input
        onChange={changeAmount}
      />

      <div className="deposit-amount__denominations">
        <div className="deposit-amount__denominations-heading">
          <span>Mệnh giá</span>
          <button
            type="button"
            className="deposit-amount__icon-button"
            disabled={disabled || configuredUnits.length === 0}
            aria-label={denominationsExpanded ? 'Thu gọn bảng mệnh giá' : 'Mở rộng bảng mệnh giá'}
            title={denominationsExpanded ? 'Thu gọn bảng mệnh giá' : 'Mở rộng bảng mệnh giá'}
            onClick={toggleDenominations}
          >
            {denominationsExpanded ? <CaretUp size={18} weight="bold" /> : <CaretDown size={18} weight="bold" />}
          </button>
        </div>
        <div className="deposit-amount__matrix" aria-label="Bảng mệnh giá nạp tiền">
          {displayedUnits.map((unit, index) => (
            <Button
              key={`${unit}-${index}`}
              type="button"
              variant={value === unit ? 'primary' : 'ghost'}
              className="deposit-amount__unit"
              disabled={disabled}
              onClick={() => selectUnit(unit)}
            >
              {moneyFormatter.format(unit)}
            </Button>
          ))}
        </div>
      </div>

      {denominationsExpanded ? (
        <div className="deposit-amount__commands" aria-label="Thao tác mệnh giá">
          <button
            type="button"
            className="deposit-amount__icon-button"
            disabled={disabled || !allowNegative || !value}
            aria-label="Đổi dấu số tiền"
            title={!allowNegative ? 'Thiếu quyền nhập số tiền âm' : 'Đổi dấu số tiền nạp/rút'}
            onClick={() => changeAmount(toggleDepositAmountSign(value))}
          >
            <Minus size={18} weight="bold" />
          </button>
          <button
            type="button"
            className="deposit-amount__icon-button"
            disabled={disabled || value === null}
            aria-label="Xóa số tiền đã chọn"
            title="Xóa số tiền đã chọn"
            onClick={() => changeAmount(null)}
          >
            <Backspace size={18} weight="bold" />
          </button>
          <button
            type="button"
            className={`deposit-amount__icon-button${editing ? ' is-active' : ''}`}
            disabled={disabled || !settingsQuery.data}
            aria-label={editing ? 'Đóng chỉnh sửa bảng mệnh giá' : 'Sửa bảng mệnh giá'}
            title={editing ? 'Đóng chỉnh sửa bảng mệnh giá' : 'Sửa bảng mệnh giá'}
            onClick={() => {
              setDraftError('')
              setEditing((current) => !current)
            }}
          >
            <PencilSimple size={18} weight="bold" />
          </button>
        </div>
      ) : null}

      {settingsQuery.isLoading ? (
        <p className="deposit-amount__status">Đang tải bảng mệnh giá từ máy chủ…</p>
      ) : null}
      {settingsQuery.isError ? (
        <InlineAlert tone="warning">
          Chưa tải được bảng mệnh giá trong cơ sở dữ liệu. WebUI không dùng danh
          sách hard-code; vẫn có thể nhập số tiền thủ công.
        </InlineAlert>
      ) : null}

      {editing && settingsQuery.data ? (
        <div className="deposit-amount__editor">
          <label className="ds-field">
            <span className="ds-field__label">Mệnh giá, phân cách bằng dấu phẩy</span>
            <textarea
              className="ds-input"
              rows={3}
              value={draft}
              disabled={settingsMutation.isPending}
              onChange={(event) => {
                setDraft(event.target.value)
                setDraftError('')
              }}
            />
            <span className={draftError ? 'ds-field__error' : 'ds-field__hint'}>
              {draftError || 'Tối đa 12 giá trị; thứ tự này cũng là thứ tự nút.'}
            </span>
          </label>

          <label className="deposit-amount__workstation-setting">
            <span>
              <strong>Cho phép hội viên đổi số tiền nạp</strong>
              <small>
                Tắt: ô số tiền trên máy trạm bị khóa, hội viên chỉ chọn mệnh giá.
              </small>
            </span>
            <input
              type="checkbox"
              checked={allowCustomAmount}
              disabled={settingsMutation.isPending}
              onChange={(event) => setAllowCustomAmount(event.target.checked)}
            />
          </label>

          <InlineAlert tone="info">
            Nếu license chưa bật FN1, máy chủ sẽ giữ quyền nhập tay theo hành vi
            MFC và WebUI sẽ đọc lại trạng thái thực sau khi lưu.
          </InlineAlert>

          <div className="deposit-amount__editor-actions">
            <Button
              type="button"
              variant="primary"
              loading={settingsMutation.isPending}
              onClick={saveSettings}
            >
              Lưu bảng mệnh giá
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
