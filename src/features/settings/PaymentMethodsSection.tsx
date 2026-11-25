import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCounterPaymentEnabled, updateCounterPaymentEnabled } from '../../api/deposit'
import {
  getComboPaymentSettings,
  getServicePaymentSettings,
  updateComboPaymentSettings,
  updateServicePaymentSettings,
} from '../../api/settings'
import { Button, InlineAlert, StateView, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'

const COMBO_QUERY_KEY = ['settings', 'combo-payment'] as const
const SERVICE_QUERY_KEY = ['settings', 'service-payment'] as const
// Dùng chung khóa với DepositMethodSelector (nút bật/tắt ngay trên màn nạp tiền) ⇒ hai nơi luôn cùng giá trị.
const COUNTER_QUERY_KEY = ['settings', 'counter-payment'] as const

type PayMethod = 'qr' | 'cash' | 'deduct'

/** Bản nháp: chỉ chứa ô người dùng đã bấm; ô chưa đụng tới lấy giá trị đang lưu trên máy chủ. */
type Draft = {
  combo: Partial<Record<PayMethod, boolean>>
  service: Partial<Record<PayMethod, boolean>>
  transfer?: boolean
}
const EMPTY_DRAFT: Draft = { combo: {}, service: {} }

const PAY_ROWS: Array<{ key: PayMethod; label: string }> = [
  { key: 'qr', label: 'Chuyển khoản / QR' },
  { key: 'cash', label: 'Tiền mặt' },
  { key: 'deduct', label: 'Cấn trừ' },
]

/** Mặc định của máy chủ khi menu order chưa có cấu hình hoặc giá trị sai: chỉ Tiền mặt. */
const SERVICE_DEFAULT: Record<PayMethod, boolean> = { qr: false, cash: true, deduct: false }

/** Số ô đã đổi so với giá trị đang lưu. */
function countChanged(draft: Partial<Record<PayMethod, boolean>>, saved: Record<PayMethod, boolean> | undefined): number {
  if (!saved) return 0
  return PAY_ROWS.filter((row) => draft[row.key] !== undefined && draft[row.key] !== saved[row.key]).length
}

/**
 * Cài đặt → "Phương thức thanh toán": một bảng "phương thức × nơi thanh toán" và MỘT nút Lưu.
 * Hàng = phương thức; cột = nơi khách/thu ngân thanh toán. Ô nào không có cài đặt thì hiện "—" nên nhìn là biết
 * cái gì chỉnh được, cái gì không. Chỉ ADMIN được đổi (máy chủ kiểm cứng).
 */
export function PaymentMethodsSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const comboQuery = useQuery({ queryKey: COMBO_QUERY_KEY, queryFn: getComboPaymentSettings, retry: false })
  const serviceQuery = useQuery({ queryKey: SERVICE_QUERY_KEY, queryFn: getServicePaymentSettings, retry: false })
  const counterQuery = useQuery({ queryKey: COUNTER_QUERY_KEY, queryFn: getCounterPaymentEnabled })
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saveError, setSaveError] = useState('')

  const combo = comboQuery.data
  const service = serviceQuery.data
  const counter = counterQuery.data
  const comboValue: Record<PayMethod, boolean> = {
    qr: draft.combo.qr ?? combo?.qr ?? true,
    cash: draft.combo.cash ?? combo?.cash ?? true,
    deduct: draft.combo.deduct ?? combo?.deduct ?? true,
  }
  const serviceValue: Record<PayMethod, boolean> = {
    qr: draft.service.qr ?? service?.qr ?? SERVICE_DEFAULT.qr,
    cash: draft.service.cash ?? service?.cash ?? SERVICE_DEFAULT.cash,
    deduct: draft.service.deduct ?? service?.deduct ?? SERVICE_DEFAULT.deduct,
  }
  const transferValue = draft.transfer ?? counter ?? true

  const changedCombo = countChanged(draft.combo, combo)
  const changedService = countChanged(draft.service, service)
  const changedTransfer = counter !== undefined && draft.transfer !== undefined && draft.transfer !== counter ? 1 : 0
  const changeCount = changedCombo + changedService + changedTransfer
  const noComboMethod = Boolean(combo) && !comboValue.qr && !comboValue.cash && !comboValue.deduct
  const noServiceMethod = Boolean(service) && !serviceValue.qr && !serviceValue.cash && !serviceValue.deduct
  const canSave = isAdmin && changeCount > 0 && !noComboMethod && !noServiceMethod

  const mutation = useMutation({
    mutationFn: async () => {
      const tasks: Array<Promise<unknown>> = []
      if (changedCombo > 0) tasks.push(updateComboPaymentSettings(comboValue))
      if (changedService > 0) tasks.push(updateServicePaymentSettings(serviceValue))
      if (changedTransfer > 0) tasks.push(updateCounterPaymentEnabled(transferValue))
      const results = await Promise.allSettled(tasks)
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason instanceof Error ? failed.reason : new Error('Không lưu được cài đặt')
    },
    onSuccess: async () => {
      setSaveError('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: SERVICE_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: COUNTER_QUERY_KEY }),
      ])
      setDraft(EMPTY_DRAFT)
      pushToast('Đã lưu phương thức thanh toán.', 'success')
    },
    // Lỗi: giữ nguyên bản nháp để người dùng sửa/thử lại; đọc lại giá trị thật phòng trường hợp một phần đã lưu.
    onError: (error: Error) => {
      setSaveError(error.message)
      void queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: SERVICE_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: COUNTER_QUERY_KEY })
    },
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaveError('')
    mutation.mutate()
  }

  const setCombo = (method: PayMethod, checked: boolean) =>
    setDraft((current) => ({ ...current, combo: { ...current.combo, [method]: checked } }))
  const setService = (method: PayMethod, checked: boolean) =>
    setDraft((current) => ({ ...current, service: { ...current.service, [method]: checked } }))
  const setTransfer = (checked: boolean) => setDraft((current) => ({ ...current, transfer: checked }))
  const loading = comboQuery.isLoading || counterQuery.isLoading || serviceQuery.isLoading
  const disabled = !isAdmin || mutation.isPending

  return (
    <form className="settings-section settings-section--compact pay-matrix" onSubmit={save}>
      <header>
        <h2>Phương thức thanh toán</h2>
        <p>Bật hoặc tắt từng phương thức theo nơi thanh toán. Ô có dấu “—” là không có cài đặt.</p>
      </header>

      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi phương thức thanh toán.</InlineAlert>}

      {loading ? (
        <StateView title="Đang tải cấu hình" />
      ) : (
        <>
          {comboQuery.isError ? (
            <InlineAlert tone="danger">
              Không tải được cấu hình combo
              {comboQuery.error ? `: ${(comboQuery.error as Error).message}` : ''}. Máy chủ có thể chưa được cập nhật.{' '}
              <Button type="button" variant="secondary" onClick={() => void comboQuery.refetch()}>Thử lại</Button>
            </InlineAlert>
          ) : null}
          {serviceQuery.isError ? (
            <InlineAlert tone="danger">
              Không tải được cấu hình menu order
              {serviceQuery.error ? `: ${(serviceQuery.error as Error).message}` : ''}. Máy chủ có thể chưa được cập nhật.{' '}
              <Button type="button" variant="secondary" onClick={() => void serviceQuery.refetch()}>Thử lại</Button>
            </InlineAlert>
          ) : null}
          {counterQuery.isError ? (
            <InlineAlert tone="danger">
              Không tải được cấu hình nạp tiền tại quầy: {(counterQuery.error as Error).message}{' '}
              <Button type="button" variant="secondary" onClick={() => void counterQuery.refetch()}>Thử lại</Button>
            </InlineAlert>
          ) : null}
          {combo && !combo.fn1 ? (
            <InlineAlert tone="info">
              License chưa bật FN1: máy trạm luôn hiện đủ phương thức thanh toán combo. Cấu hình vẫn lưu được nhưng chưa có hiệu lực.
            </InlineAlert>
          ) : null}
          {combo?.locked ? (
            <InlineAlert tone="warning">
              Thanh toán combo đang bị khóa toàn bộ (đặt tay trong cơ sở dữ liệu). Lưu thay đổi ở đây sẽ gỡ khóa.
            </InlineAlert>
          ) : null}
          {service?.isDefault ? (
            <InlineAlert tone="info">
              Menu order chưa có cấu hình hợp lệ nên đang dùng mặc định: chỉ Tiền mặt. Bấm “Lưu thay đổi” để ghi cấu hình.
            </InlineAlert>
          ) : null}

          <table className="pay-table">
            <thead>
              <tr>
                <th scope="col">Phương thức</th>
                <th scope="col" id="setting-combo-payment">
                  <span className="pay-table__context">Combo tại máy trạm</span>
                  <small>Khách tự mua combo trên máy</small>
                </th>
                <th scope="col" id="setting-counter-payment">
                  <span className="pay-table__context">Nạp tiền tại thu ngân</span>
                  <small>Thu ngân nạp tiền ở quầy</small>
                </th>
                <th scope="col" id="setting-service-payment">
                  <span className="pay-table__context">Menu order (dịch vụ)</span>
                  <small>Khách gọi món trên máy · cần iCafe 2.1.88 trở lên</small>
                </th>
              </tr>
            </thead>
            <tbody>
              {PAY_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td data-label="Combo tại máy trạm">
                    {combo ? (
                      <Switch
                        checked={comboValue[row.key]}
                        onCheckedChange={(checked) => setCombo(row.key, checked)}
                        disabled={disabled}
                        aria-label={`${row.label} — combo tại máy trạm`}
                      />
                    ) : (
                      <span className="pay-na">—</span>
                    )}
                  </td>
                  <td data-label="Nạp tiền tại thu ngân" className={row.key === 'qr' ? undefined : 'pay-cell--na'}>
                    {row.key === 'qr' && counter !== undefined ? (
                      <Switch
                        checked={transferValue}
                        onCheckedChange={setTransfer}
                        disabled={disabled}
                        aria-label="Chuyển khoản — nạp tiền tại thu ngân"
                      />
                    ) : (
                      <span className="pay-na" title="Không có cài đặt">—</span>
                    )}
                  </td>
                  <td data-label="Menu order (dịch vụ)">
                    {service ? (
                      <Switch
                        checked={serviceValue[row.key]}
                        onCheckedChange={(checked) => setService(row.key, checked)}
                        disabled={disabled}
                        aria-label={`${row.label} — menu order`}
                      />
                    ) : (
                      <span className="pay-na">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {noComboMethod ? (
            <InlineAlert tone="danger">Combo cần bật ít nhất một phương thức thanh toán.</InlineAlert>
          ) : null}
          {noServiceMethod ? (
            <InlineAlert tone="danger">Menu order cần bật ít nhất một phương thức thanh toán.</InlineAlert>
          ) : null}
          {saveError ? <InlineAlert tone="danger">{saveError}</InlineAlert> : null}

          <footer className="pay-matrix__footer">
            <span className="pay-matrix__status" role="status" aria-live="polite">
              {changeCount > 0 ? `${changeCount} thay đổi chưa lưu` : 'Chưa có thay đổi'}
            </span>
            <div className="pay-matrix__actions">
              <Button type="button" variant="secondary" disabled={changeCount === 0 || mutation.isPending} onClick={() => { setDraft(EMPTY_DRAFT); setSaveError('') }}>
                Hoàn tác
              </Button>
              <Button type="submit" variant="primary" disabled={!canSave} loading={mutation.isPending}>
                Lưu thay đổi
              </Button>
            </div>
          </footer>
        </>
      )}
    </form>
  )
}
