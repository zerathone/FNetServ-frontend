// task work-shift S3b-FE — nút "Ngừng nhận đơn" / "Tiếp tục nhận đơn" + hộp xác nhận ngừng (lý do tuỳ chọn ≤ 40 ký tự,
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
  onDialogOpenChange?: (open: boolean) => void
}

export function PauseIntakeButton({ block, onDialogOpenChange }: ButtonProps) {
  const { enabled, orderPause, canResume, paused, resumeMutation } = useOrderIntake()
  const [open, setOpen] = useState(false)
  // Hộp chỉ hiện khi đang nhận đơn; trạng thái đổi sang ngừng (máy khác bấm / poll) thì tự đóng, không kẹt open.
  const dialogOpen = open && enabled && !paused
  useEffect(() => {
    if (open && !dialogOpen) setOpen(false)
  }, [open, dialogOpen])
  // Báo nơi chứa nút: ref chỉ về false SAU khi hộp đã gỡ khỏi DOM (cleanup) — nên Esc không đóng nhầm hộp mẹ dù thứ tự listener thế nào.
  useEffect(() => {
    if (!dialogOpen) return
    onDialogOpenChange?.(true)
    return () => onDialogOpenChange?.(false)
  }, [dialogOpen, onDialogOpenChange])

  // Máy chủ không gửi orderPause (bản cũ, chưa có B3) ⇒ không có tính năng, ẩn nút thay vì bấm ra lỗi 404.
  if (!enabled || !orderPause) return null
  // Nguồn tự động (không có ca) không có nút: tự hết khi có người mở ca.
  if (paused && !canResume) return null

  if (canResume) {
    return (
      <Button
        type="button"
        variant="primary"
        block={block}
        loading={resumeMutation.isPending}
        icon={<PlayCircle size={18} weight="bold" aria-hidden="true" />}
        onClick={() =>
          resumeMutation.mutate(undefined, {
            onSuccess: (result) =>
              pushToast(result.changed ? 'Đã tiếp tục nhận đơn.' : 'Quán đã nhận đơn trở lại từ trước.', 'success'),
            onError: (error: Error) => pushToast(error.message || 'Không tiếp tục nhận đơn được. Thử lại.'),
          })
        }
      >
        Tiếp tục nhận đơn
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
        title="Tạm ngừng nhận đơn món để kiểm kho giao ca"
        onClick={() => setOpen(true)}
      >
        Ngừng nhận đơn
      </Button>
      {dialogOpen ? <PauseIntakeDialog onClose={() => setOpen(false)} /> : null}
    </>
  )
}

function PauseIntakeDialog({ onClose }: { onClose: () => void }) {
  const { orderPause, pauseMutation } = useOrderIntake()
  const [reason, setReason] = useState('')
  const [failure, setFailure] = useState<string | null>(null)

  const reasonError = validatePauseReason(reason)
  const pendingText = orderPause ? describeIntakePending(orderPause.pendingOrders) : ''

  const submit = () => {
    if (pauseMutation.isPending || reasonError) return
    setFailure(null)
    pauseMutation.mutate(reason.trim() || undefined, {
      onSuccess: (result) => {
        pushToast(result.changed ? 'Đã ngừng nhận đơn.' : 'Quán đang ngừng nhận đơn từ trước.', 'success')
        onClose()
      },
      onError: (error: Error) => setFailure(error.message || 'Không ngừng nhận đơn được. Thử lại.'),
    })
  }

  return (
    <ConfirmAction
      open
      title="Ngừng nhận đơn để kiểm kho?"
      description="Đơn món mới sẽ bị ngừng nhận cho tới khi có người bấm Tiếp tục nhận đơn."
      confirmLabel="Ngừng nhận đơn"
      cancelLabel="Hủy"
      pending={pauseMutation.isPending}
      confirmDisabled={Boolean(reasonError)}
      onCancel={onClose}
      onConfirm={submit}
    >
      <div className="shift-form">
        {pendingText ? (
          <InlineAlert tone="warning">
            <strong>Còn đơn đang chờ:</strong> {pendingText}. Nên duyệt hoặc hủy xong trước khi đếm kho — đơn đang chờ
            vẫn duyệt, hủy và thu tiền được bình thường.
          </InlineAlert>
        ) : (
          <InlineAlert tone="info">Hiện không có đơn món nào đang chờ duyệt.</InlineAlert>
        )}
        <ul className="shift-list">
          <li>Chỉ ngừng đơn món, dịch vụ và hàng hóa. Nạp tiền QR và combo vẫn hoạt động.</li>
          <li>Chốt ca không tự bật lại. Người mở ca sau sẽ được hỏi có tiếp tục nhận đơn không.</li>
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
            placeholder="Ví dụ: kiểm kho giao ca"
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
