import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { getRefundSettings, updateRefundSettings } from '../../api/settings'
import { Button, InlineAlert, StateView } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { SettingsConfirmDialog } from './SettingsConfirmDialog'
import { OpsErrorState } from './SettingsOpsKit'
import { isRefundInDomain, REFUND_MAX_MINUTES, REFUND_MIN_MINUTES, validateRefundMinutes } from './settingsOpsModel'

const QUERY_KEY = ['settings', 'refund'] as const

/**
 * Cài đặt → Thiết lập chung → "Thời hạn hoàn tiền" (GET|PUT /settings/refund, PUT chỉ ADMIN). Cùng giá trị MFC đang đọc
 * ⇒ đổi ở đây có hiệu lực cho cả hai giao diện. Liên quan tiền: đổi phải xác nhận.
 */
export function RefundSection({ isAdmin }: { isAdmin: boolean }) {
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getRefundSettings, retry: false })
  const [draft, setDraft] = useState<string | undefined>(undefined)
  const [error, setError] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)

  const saved = query.data?.timeoutMinutes
  const text = draft ?? (saved === undefined ? '' : String(saved))
  const parsed = text.trim() === '' ? Number.NaN : Number(text)
  const dirty = saved !== undefined && draft !== undefined && parsed !== saved

  const mutation = useMutation({
    mutationFn: updateRefundSettings,
    onSuccess: (result) => {
      queryClient.setQueryData(QUERY_KEY, result)
      setDraft(undefined)
      setError('')
      setConfirmOpen(false)
      pushToast('Đã lưu thời hạn hoàn tiền.', 'success')
    },
    onError: (err: Error) => {
      setConfirmOpen(false)
      setError(err.message)
      pushToast(err.message, 'error')
    },
  })

  const requestSave = (event: FormEvent) => {
    event.preventDefault()
    if (!isAdmin || !dirty) return
    const problem = validateRefundMinutes(parsed)
    setError(problem ?? '')
    if (!problem) setConfirmOpen(true)
  }

  return (
    <form id="setting-refund-timeout" className="settings-section settings-section--compact" onSubmit={requestSave}>
      <header>
        <h2>Thời hạn hoàn tiền</h2>
        <p>
          Phiếu thu chỉ được hoàn tiền trong khoảng thời gian này kể từ lúc thu. Quá hạn, hệ thống từ chối hoàn tiền.
        </p>
      </header>
      {isAdmin ? null : <InlineAlert tone="warning">Chỉ quản trị viên được đổi thời hạn hoàn tiền.</InlineAlert>}
      {query.isLoading ? (
        <StateView title="Đang tải cấu hình" />
      ) : query.isError || !query.data ? (
        <OpsErrorState error={query.error} onRetry={() => void query.refetch()} />
      ) : (
        <>
          {isRefundInDomain(query.data.timeoutMinutes) ? null : (
            <InlineAlert tone="warning">
              Giá trị đang lưu là {query.data.timeoutMinutes} phút, ngoài khoảng cho phép ({REFUND_MIN_MINUTES} đến{' '}
              {REFUND_MAX_MINUTES} phút). Giá trị này vẫn đang được áp dụng; hãy nhập lại một giá trị hợp lệ nếu cần đổi.
            </InlineAlert>
          )}
          {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
          <div className="ops-field">
            <label className="ds-field settings-short-field">
              <span className="ds-field__label">Số phút được hoàn tiền</span>
              <span className="ops-field__row">
                <input
                  className="ds-input"
                  type="number"
                  inputMode="numeric"
                  min={REFUND_MIN_MINUTES}
                  max={REFUND_MAX_MINUTES}
                  step={1}
                  value={text}
                  disabled={!isAdmin || mutation.isPending}
                  onChange={(event) => setDraft(event.target.value)}
                />
                <span className="ops-field__unit">phút ({REFUND_MIN_MINUTES} đến {REFUND_MAX_MINUTES})</span>
              </span>
            </label>
            <p className="ops-hint">
              Hoàn tiền cần máy chủ có internet vì hệ thống so sánh với giờ mạng, không dùng giờ của máy tính.
            </p>
          </div>
          <footer>
            <Button type="submit" variant="primary" disabled={!isAdmin || !dirty} loading={mutation.isPending}>
              Lưu thời hạn hoàn tiền
            </Button>
          </footer>
        </>
      )}
      <SettingsConfirmDialog
        open={confirmOpen}
        title="Đổi thời hạn hoàn tiền?"
        consequences={[
          `Thời hạn hoàn tiền mới: ${Number.isFinite(parsed) ? parsed : '?'} phút${saved === undefined ? '' : ` (hiện tại ${saved} phút)`}.`,
          'Phiếu thu quá thời hạn mới sẽ bị từ chối hoàn tiền, cả trên máy chủ lẫn giao diện MFC.',
          'Thay đổi áp dụng ngay cho các lần hoàn tiền tiếp theo.',
        ]}
        pending={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate({ timeoutMinutes: parsed })}
      />
    </form>
  )
}
