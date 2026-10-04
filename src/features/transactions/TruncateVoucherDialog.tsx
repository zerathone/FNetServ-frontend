import { useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { truncateVoucherLogs } from '../../api/logs'
import { ApiError, RbacDeniedError } from '../../api/client'
import { Button, DatePicker, Dialog, InlineAlert } from '../../design-system/components'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { pushToast } from '../../store/toast'

const WARN_RECENT_DAYS = 365

// Server chỉ trả `code` ASCII; câu tiếng Việt map ở FE (HANDOFF §4.3).
const ERROR_BY_CODE: Record<string, string> = {
  HOARD_PROMO_ACTIVE:
    'Phòng máy đang có (hoặc từng có) khuyến mãi tích tiền — hãy xóa nhật ký bằng ứng dụng quản lý trên máy chủ.',
  TRUNCATE_IN_PROGRESS:
    'Đang có một lượt xóa nhật ký khác chạy, vui lòng thử lại sau.',
  DATE_NOT_ALLOWED: 'Chỉ được xóa nhật ký đến hết ngày hôm qua.',
  INVALID_DATE: 'Ngày không hợp lệ.',
  AUTH_REQUIRED: 'Cần đăng nhập bằng tài khoản nhân viên để xóa nhật ký.',
  DB_ERROR: 'Lỗi cơ sở dữ liệu, chưa xóa xong. Vui lòng thử lại.',
  DELETE_FAILED: 'Xóa thất bại giữa chừng, có thể bấm xóa lại.',
}

function toDateValue(date: Date) {
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function daysBeforeToday(value: string) {
  const [y, m, d] = value.split('-').map(Number)
  const selected = new Date(y, m - 1, d)
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((today.getTime() - selected.getTime()) / 86_400_000)
}

/**
 * Server trả `message` ASCII tiếng Anh nên KHÔNG hiển thị — chỉ map theo `code`.
 * 403 RBAC_DENIED: `client.ts` đã toast message server → dialog chỉ dừng, không báo thêm (null).
 */
function describeError(error: unknown): string | null {
  if (error instanceof RbacDeniedError) return null
  if (error instanceof ApiError && error.code && ERROR_BY_CODE[error.code]) {
    return ERROR_BY_CODE[error.code]
  }
  return 'Không thể xóa nhật ký. Vui lòng thử lại.'
}

/** Lỗi 409/500 có thể kèm `details.affected` (số phiếu lô đó đã xóa — vd DB_ERROR ở bước đếm cuối). */
function affectedFromError(error: unknown) {
  if (!(error instanceof ApiError)) return 0
  const details = error.details as { affected?: unknown } | undefined
  return typeof details?.affected === 'number' ? details.affected : 0
}

type Progress = { affected: number; failed: number; remaining: number | null }

type Props = {
  open: boolean
  onClose: () => void
}

export function TruncateVoucherDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const stopRef = useRef(false)
  const [date, setDate] = useState('')
  const [acknowledged, setAcknowledged] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<Progress>({ affected: 0, failed: 0, remaining: null })
  const [error, setError] = useState<string | null>(null)
  const [finished, setFinished] = useState(false)

  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return toDateValue(d)
  })()
  const dateValid = date !== '' && date <= yesterday
  const isRecent = dateValid && daysBeforeToday(date) < WARN_RECENT_DAYS
  const canStart = dateValid && (!isRecent || acknowledged) && !running && !finished

  const reset = () => {
    stopRef.current = false
    setDate('')
    setAcknowledged(false)
    setProgress({ affected: 0, failed: 0, remaining: null })
    setError(null)
    setFinished(false)
  }

  const close = () => {
    if (running) return
    reset()
    onClose()
  }

  const start = async () => {
    stopRef.current = false
    setRunning(true)
    setError(null)
    let affected = 0
    let failed = 0
    let remaining: number | null = null
    try {
      // Mỗi request = 1 lô (server tự giới hạn). Lặp tới khi hết, bị dừng hoặc lỗi.
      for (;;) {
        const result = await truncateVoucherLogs(date)
        affected += result.affected
        failed += result.failed
        remaining = result.remaining
        setProgress({ affected, failed, remaining })
        if (remaining === 0) break
        if (stopRef.current) break
        // Lô không xóa được phiếu nào mà vẫn còn phiếu → dừng, tránh lặp vô hạn.
        if (result.affected === 0) {
          setError('Không xóa thêm được phiếu nào dù vẫn còn phiếu thỏa điều kiện. Vui lòng kiểm tra nhật ký máy chủ.')
          break
        }
      }
    } catch (err) {
      const partial = affectedFromError(err)
      if (partial > 0) {
        affected += partial
        setProgress({ affected, failed, remaining })
      }
      setError(describeError(err))
    } finally {
      setRunning(false)
      setFinished(true)
      if (affected > 0) {
        // Invalidate MỘT lần ở cuối, không phải sau mỗi lô.
        void invalidateMoneyQueries(queryClient)
        pushToast(
          failed > 0
            ? `Đã xóa ${affected} giao dịch, ${failed} giao dịch xóa lỗi.`
            : `Đã xóa ${affected} giao dịch.`,
          failed > 0 ? 'error' : 'success',
        )
      } else if (remaining === 0) {
        pushToast('Không có giao dịch nào cần xóa.', 'info')
      }
    }
  }

  return (
    <Dialog
      open={open}
      title="Xóa nhật ký giao dịch"
      description="Xóa các phiếu đã thanh toán đến hết ngày được chọn (bao gồm ngày đó). Phiếu công nợ được giữ lại. Không thể hoàn tác."
      size="sm"
      onClose={close}
      footer={
        <>
          {running ? (
            <Button type="button" variant="secondary" onClick={() => { stopRef.current = true }}>
              Dừng sau lô này
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={close}>
              {finished ? 'Đóng' : 'Hủy'}
            </Button>
          )}
          {finished ? null : (
            <Button
              type="button"
              variant="danger"
              loading={running}
              disabled={!canStart}
              onClick={() => void start()}
            >
              Xóa nhật ký
            </Button>
          )}
        </>
      }
    >
      <div className="transaction-truncate">
        <label className="ds-field">
          <span>Xóa đến hết ngày</span>
          <DatePicker
            max={yesterday}
            value={date}
            disabled={running || finished}
            allowClear={false}
            aria-label="Xóa đến hết ngày"
            onChange={(value) => { setDate(value); setAcknowledged(false) }}
          />
        </label>

        {date !== '' && !dateValid ? (
          <InlineAlert tone="danger">Chỉ được xóa nhật ký đến hết ngày hôm qua.</InlineAlert>
        ) : null}

        {isRecent && !finished ? (
          <>
            <InlineAlert tone="warning">
              Xóa dữ liệu trong 365 ngày gần đây thấp hơn mức khuyến nghị của FUS. Nếu tiếp tục,
              bạn xác nhận đã cân nhắc và tự chịu trách nhiệm với cấu hình đã chọn.
            </InlineAlert>
            <label className="transaction-truncate__ack">
              <input
                type="checkbox"
                checked={acknowledged}
                disabled={running}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              Tôi đã cân nhắc và xác nhận tiếp tục
            </label>
          </>
        ) : null}

        {running || finished ? (
          <p className="transaction-truncate__progress" role="status">
            Đã xóa <strong>{progress.affected}</strong> giao dịch
            {progress.remaining !== null ? <>, còn <strong>{progress.remaining}</strong></> : null}
            {progress.failed > 0 ? <>, lỗi <strong>{progress.failed}</strong></> : null}
            {running ? ' …' : '.'}
          </p>
        ) : null}

        {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      </div>
    </Dialog>
  )
}
