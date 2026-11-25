// task work-shift S3b-FE — nút "Dừng nhận đơn" / "Tiếp tục nhận đơn" + hộp xác nhận ngừng (lý do tuỳ chọn ≤ 40 ký tự,
// hiện số đơn đang chờ). Dùng ở widget ca, Drawer "Thông tin ca" và Dialog Chốt ca.
// `onDialogOpenChange`: nơi chứa nút nằm TRONG một Dialog/Drawer khác thì phải bỏ qua Esc khi hộp xác nhận đang mở
// (cả hai cùng nghe phím Esc trên document ⇒ không chặn thì Esc đóng luôn hộp mẹ).
import { PauseCircle, PlayCircle } from '@phosphor-icons/react'
import { useEffect, useState } from 'react'
import { Button, ConfirmAction, InlineAlert } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import {
  MAX_PAUSE_REASON,
  describeIntakePending,
  sanitizeNoteInput,
  validatePauseReason,
} from './shiftModel'
import { useOrderIntake } from './useOrderIntake'
import './shifts.css'

type ButtonProps = {
  block?: boolean
  /**
   * Ở thanh trên cùng (trong viên thuốc cảnh báo): nút phụ nhỏ "Tiếp tục"; màn hẹp chỉ còn biểu tượng (tên đầy đủ vẫn có ở
   * `aria-label` / `title`), không phình topbar.
   */
  compact?: boolean
  onDialogOpenChange?: (open: boolean) => void
}

export function PauseIntakeButton({ block, compact, onDialogOpenChange }: ButtonProps) {
  const { enabled: shiftOn, orderPause, canResume, paused, resumeMutation } = useOrderIntake()
  const [open, setOpen] = useState(false)
  // Hộp chỉ hiện khi đang nhận đơn; trạng thái đổi sang ngừng (máy khác bấm / poll) thì tự đóng, không kẹt open.
  // KHÔNG phụ thuộc chế độ ca (user chốt 2026-11-25): mode 0 cũng ngừng/nhận đơn được.
  const dialogOpen = open && !paused
  useEffect(() => {
    if (open && !dialogOpen) setOpen(false)
  }, [open, dialogOpen])
  // Báo nơi chứa nút: ref chỉ về false SAU khi hộp đã gỡ khỏi DOM (cleanup) — nên Esc không đóng nhầm hộp mẹ dù thứ tự listener thế nào.
  useEffect(() => {
    if (!dialogOpen) return
    onDialogOpenChange?.(true)
    return () => onDialogOpenChange?.(false)
  }, [dialogOpen, onDialogOpenChange])

  // Máy chủ không gửi orderPause (bản cũ, chưa có B3 / chưa hỗ trợ mode 0) ⇒ không có tính năng, ẩn nút thay vì bấm ra lỗi.
  if (!orderPause) return null
  // Nguồn tự động (không có ca) không có nút: tự hết khi có người mở ca.
  if (paused && !canResume) return null

  if (canResume) {
    return (
      <Button
        type="button"
        // Màu cảnh báo (user chốt 2026-11-25: nút quan trọng) — cùng họ màu với nút "Dừng nhận đơn" (warning-outline).
        variant="warning"
        block={block}
        className={compact ? 'order-pause-chip__resume' : undefined}
        title="Tiếp tục nhận đơn"
        aria-label="Tiếp tục nhận đơn"
        loading={resumeMutation.isPending}
        icon={<PlayCircle size={compact ? 16 : 18} weight="bold" aria-hidden="true" />}
        onClick={() =>
          resumeMutation.mutate(undefined, {
            onSuccess: (result) =>
              result.orderPause?.on
                ? // S4b: đã bỏ cờ thủ công nhưng chế độ Bắt buộc + chưa có ca nào mở vẫn đang chặn ⇒ nói đúng sự thật.
                  pushToast('Đã bỏ cờ dừng thủ công, nhưng quán vẫn dừng nhận đơn vì chưa có ca nào mở.', 'info')
                : pushToast(result.changed ? 'Đã tiếp tục nhận đơn.' : 'Quán đã nhận đơn trở lại từ trước.', 'success'),
            onError: (error: Error) => pushToast(error.message || 'Không tiếp tục nhận đơn được. Thử lại.'),
          })
        }
      >
        {/* Trong viên thuốc "Dừng nhận đơn" chữ "Tiếp tục" đã đủ nghĩa (tên đầy đủ ở aria-label/title). */}
        <span className={compact ? 'order-pause-chip__resume-label' : undefined}>
          {compact ? 'Tiếp tục' : 'Tiếp tục nhận đơn'}
        </span>
      </Button>
    )
  }

  return (
    <>
      <Button
        type="button"
        variant="warning-outline"
        block={block}
        icon={<PauseCircle size={18} weight="bold" aria-hidden="true" />}
        title={shiftOn ? 'Tạm dừng nhận đơn món để kiểm kho giao ca' : 'Tạm dừng nhận đơn món'}
        onClick={() => setOpen(true)}
      >
        Dừng nhận đơn
      </Button>
      {dialogOpen ? <PauseIntakeDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function PauseIntakeDialog({ onClose }: { onClose: () => void }) {
  const { enabled: shiftOn, orderPause, pauseMutation } = useOrderIntake()
  // Chế độ ca bật ⇒ ngừng để kiểm kho giao ca (câu chữ cũ). Chế độ ca tắt ⇒ chỉ là công tắc nhận / dừng nhận đơn.
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const reasonError = validatePauseReason(reason)
  const pendingText = orderPause ? describeIntakePending(orderPause.pendingOrders) : ''

  const submit = () => {
    if (pauseMutation.isPending || reasonError) return
    setFailure(null)
    pauseMutation.mutate(reason.trim() || undefined, {
      onSuccess: (result) => {
        pushToast(result.changed ? 'Đã dừng nhận đơn.' : 'Quán đang dừng nhận đơn từ trước.', 'success')
        onClose()
      },
      onError: (error: Error) => setFailure(error.message || 'Không dừng nhận đơn được. Thử lại.'),
    })
  }

  return (
    <ConfirmAction
      open
      title={shiftOn ? 'Dừng nhận đơn để kiểm kho?' : 'Dừng nhận đơn?'}
      description="Đơn món mới sẽ bị dừng nhận cho tới khi có người bấm Tiếp tục nhận đơn."
      confirmLabel="Dừng nhận đơn"
      cancelLabel="Hủy"
      pending={pauseMutation.isPending}
      confirmDisabled={Boolean(reasonError)}
      onCancel={onClose}
      onConfirm={submit}
    >
      <div className="shift-form">
        {pendingText ? (
          <InlineAlert tone="warning">
            <strong>Còn đơn đang chờ:</strong> {pendingText}.{' '}
            {shiftOn ? 'Nên duyệt hoặc hủy xong trước khi đếm kho — đơn' : 'Đơn'} đang chờ vẫn duyệt, hủy và thu tiền được
            bình thường.
          </InlineAlert>
        ) : (
          <InlineAlert tone="info">Hiện không có đơn món nào đang chờ duyệt.</InlineAlert>
        )}
        <ul className="shift-list">
          <li>Chỉ dừng đơn món, dịch vụ và hàng hóa. Nạp tiền QR và combo vẫn hoạt động.</li>
          {shiftOn ? <li>Chốt ca không tự bật lại. Người mở ca sau sẽ được hỏi có tiếp tục nhận đơn không.</li> : null}
        </ul>
        <label className="ds-field">
          <span className="ds-field__label">Lý do (tuỳ chọn)</span>
          <input
            className="ds-input"
            type="text"
            maxLength={MAX_PAUSE_REASON}
            autoFocus
            value={reason}
            disabled={pauseMutation.isPending}
            aria-invalid={Boolean(reasonError)}
            placeholder={shiftOn ? 'Ví dụ: kiểm kho giao ca' : 'Ví dụ: hết hàng, tạm nghỉ'}
            onChange={(event) => setReason(sanitizeNoteInput(event.target.value))}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                submit()
              }
            }}
          />
          {reasonError ? (
            <span className="ds-field__error">{reasonError}</span>
          ) : (
            <span className="ds-field__hint">
              {reason.length}/{MAX_PAUSE_REASON}
            </span>
          )}
        </label>
        {failure ? <InlineAlert tone="danger">{failure}</InlineAlert> : null}
      </div>
    </ConfirmAction>
  )
}
