import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getCounterPaymentEnabled, updateCounterPaymentEnabled } from '../../api/deposit'
import { getComboPaymentSettings, updateComboPaymentSettings } from '../../api/settings'
import { Button, InlineAlert, StateView, StatusBadge, Switch } from '../../design-system/components'
import { pushToast } from '../../store/toast'

const COMBO_QUERY_KEY = ['settings', 'combo-payment'] as const
// Dùng chung khóa với DepositMethodSelector (nút bật/tắt ngay trên màn nạp tiền) ⇒ hai nơi luôn cùng giá trị.
const COUNTER_QUERY_KEY = ['settings', 'counter-payment'] as const

/** Bản nháp: chỉ chứa ô người dùng đã bấm; ô chưa đụng tới lấy giá trị đang lưu trên máy chủ. */
type Draft = { qr?: boolean; cash?: boolean; deduct?: boolean; transfer?: boolean }
type ComboMethod = 'qr' | 'cash' | 'deduct'

const COMBO_ROWS: Array<{ key: ComboMethod; label: string }> = [
  { key: 'qr', label: 'Chuyển khoản / QR' },
  { key: 'cash', label: 'Tiền mặt' },
  { key: 'deduct', label: 'Cấn trừ' },
]

/**
 * Cài đặt → "Phương thức thanh toán": một bảng "phương thức × nơi thanh toán" và MỘT nút Lưu.
 * Hàng = phương thức; cột = nơi khách/thu ngân thanh toán. Ô nào không có cài đặt thì hiện "—" nên nhìn là biết
 * cái gì chỉnh được, cái gì không. Chỉ ADMIN được đổi (máy chủ kiểm cứng).
 */
export function PaymentMethodsSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const comboQuery = useQuery({ queryKey: COMBO_QUERY_KEY, queryFn: getComboPaymentSettings, retry: false })
  const counterQuery = useQuery({ queryKey: COUNTER_QUERY_KEY, queryFn: getCounterPaymentEnabled })
  const [draft, setDraft] = useState<Draft>({})
  const [saveError, setSaveError] = useState('')

  const combo = comboQuery.data
  const counter = counterQuery.data
  const value = {
    qr: draft.qr ?? combo?.qr ?? true,
    cash: draft.cash ?? combo?.cash ?? true,
    deduct: draft.deduct ?? combo?.deduct ?? true,
    transfer: draft.transfer ?? counter ?? true,
  }

  const changedCombo = combo
    ? COMBO_ROWS.filter((row) => draft[row.key] !== undefined && draft[row.key] !== combo[row.key]).length
    : 0
  const changedTransfer = counter !== undefined && draft.transfer !== undefined && draft.transfer !== counter ? 1 : 0
  const changeCount = changedCombo + changedTransfer
  const noComboMethod = Boolean(combo) && !value.qr && !value.cash && !value.deduct
  const canSave = isAdmin && changeCount > 0 && !noComboMethod

  const mutation = useMutation({
    mutationFn: async () => {
      const tasks: Array<Promise<unknown>> = []
      if (changedCombo > 0) tasks.push(updateComboPaymentSettings({ qr: value.qr, cash: value.cash, deduct: value.deduct }))
      if (changedTransfer > 0) tasks.push(updateCounterPaymentEnabled(value.transfer))
      const results = await Promise.allSettled(tasks)
      const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
      if (failed) throw failed.reason instanceof Error ? failed.reason : new Error('Không lưu được cài đặt')
    },
    onSuccess: async () => {
      setSaveError('')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY }),
        queryClient.invalidateQueries({ queryKey: COUNTER_QUERY_KEY }),
      ])
      setDraft({})
      pushToast('Đã lưu phương thức thanh toán.', 'success')
    },
    // Lỗi: giữ nguyên bản nháp để người dùng sửa/thử lại; đọc lại giá trị thật phòng trường hợp một phần đã lưu.
    onError: (error: Error) => {
      setSaveError(error.message)
      void queryClient.invalidateQueries({ queryKey: COMBO_QUERY_KEY })
      void queryClient.invalidateQueries({ queryKey: COUNTER_QUERY_KEY })
    },
  })

  const save = (event: FormEvent) => {
    event.preventDefault()
    if (!canSave) return
    setSaveError('')
    mutation.mutate()
  }

  const set = (patch: Draft) => setDraft((current) => ({ ...current, ...patch }))
  const loading = comboQuery.isLoading || counterQuery.isLoading
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
                <th scope="col" className="pay-table__soon">
                  <span className="pay-table__context">
                    Menu order <StatusBadge tone="neutral" dot={false}>Sắp có</StatusBadge>
                  </span>
                  <small>Chờ thống nhất cách phối hợp với iCafe</small>
                </th>
              </tr>
            </thead>
            <tbody>
              {COMBO_ROWS.map((row) => (
                <tr key={row.key}>
                  <th scope="row">{row.label}</th>
                  <td data-label="Combo tại máy trạm">
                    {combo ? (
                      <Switch
                        checked={value[row.key]}
                        onCheckedChange={(checked) => set({ [row.key]: checked })}
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
                        checked={value.transfer}
                        onCheckedChange={(checked) => set({ transfer: checked })}
                        disabled={disabled}
                        aria-label="Chuyển khoản — nạp tiền tại thu ngân"
                      />
                    ) : (
                      <span className="pay-na" title="Không có cài đặt">—</span>
                    )}
                  </td>
                  <td data-label="Menu order" className="pay-cell--na pay-table__soon">
                    <span className="pay-na" title="Chưa có cài đặt">—</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {noComboMethod ? (
            <InlineAlert tone="danger">Combo cần bật ít nhất một phương thức thanh toán.</InlineAlert>
          ) : null}
          {saveError ? <InlineAlert tone="danger">{saveError}</InlineAlert> : null}

          <footer className="pay-matrix__footer">
            <span className="pay-matrix__status" role="status" aria-live="polite">
              {changeCount > 0 ? `${changeCount} thay đổi chưa lưu` : 'Chưa có thay đổi'}
            </span>
            <div className="pay-matrix__actions">
              <Button type="button" variant="secondary" disabled={changeCount === 0 || mutation.isPending} onClick={() => { setDraft({}); setSaveError('') }}>
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
