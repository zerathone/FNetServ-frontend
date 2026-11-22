// task work-shift S5-FE (F4) — thẻ thông báo khi máy chủ chặn thao tác vì ca: `SHIFT_REQUIRED` (thu tiền / tạo QR khi chưa mở ca,
// chế độ Bắt buộc) và `ORDER_PAUSED` (tạo đơn món khi đang ngừng nhận đơn hoặc chưa có ca). `api/client.ts` đẩy vào
// `useShiftBlockStore` ở MỘT chỗ chung nên mọi màn đều có thẻ này mà không phải sửa từng màn.
// - SHIFT_REQUIRED: "Bạn chưa mở ca. Hãy mở ca rồi thử lại." + nút Mở ca (Dialog Mở ca có sẵn). Bấm lại thao tác sau khi mở ca:
//   các màn tiền giữ nguyên `idem` (chỉ xoá khi thành công) nên phiếu đã ghi trước đó được trả lại, không ghi đôi (Q-S4-1).
// - ORDER_PAUSED: câu của máy chủ. Ngừng thủ công ⇒ nút Tiếp tục nhận đơn; không có ca ⇒ nút Mở ca.
// Khi lý do chặn đã hết (đã mở ca / đã tiếp tục nhận đơn — trạng thái ca tải lại SAU lúc báo lỗi) thẻ đổi sang xanh
// "đã xong, hãy thử lại" rồi tự đóng. Nằm TRÊN hộp thoại (lỗi thường phát sinh ngay trong Dialog) và dưới toast.
import { CheckCircle, LockKeyOpen, PauseCircle, Warning, X } from '@phosphor-icons/react'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Button, IconButton } from '../../design-system/components'
import { useShiftBlockStore } from '../../store/shiftBlock'
import { PauseIntakeButton } from './PauseIntakeButton'
import { isShiftBlockResolved, SHIFT_REQUIRED_CODE } from './shiftScopeModel'
import { useOrderIntake } from './useOrderIntake'
import { useShift, useShiftUiStore } from './useShift'
import './shifts.css'

const RESOLVED_AUTO_CLOSE_MS = 8000

export function ShiftBlockNotice() {
  const notice = useShiftBlockStore((state) => state.notice)
  const dismiss = useShiftBlockStore((state) => state.dismiss)
  const requestOpen = useShiftUiStore((state) => state.requestOpen)
  const { enabled, shift, dataUpdatedAt } = useShift()
  const { paused, canResume } = useOrderIntake()
  const queryClient = useQueryClient()

  const noticeId = notice?.id
  // Trạng thái ca trong cache có thể đã cũ lúc bị chặn (vd ca bị chốt ở máy khác) ⇒ đọc lại ngay.
  useEffect(() => {
    if (noticeId === undefined) return
    void queryClient.invalidateQueries({ queryKey: ['shift', 'current'] })
  }, [noticeId, queryClient])

  const resolved = notice
    ? isShiftBlockResolved(notice.code, {
        fresh: dataUpdatedAt >= notice.at,
        enabled,
        hasShift: shift !== null,
        intakePaused: paused,
      })
    : false

  useEffect(() => {
    if (!resolved || noticeId === undefined) return
    const timer = window.setTimeout(dismiss, RESOLVED_AUTO_CLOSE_MS)
    return () => window.clearTimeout(timer)
  }, [resolved, noticeId, dismiss])

  if (!notice) return null

  const needsShift = notice.actions.includes('open-shift')
  const canResumeIntake = notice.actions.includes('resume-intake') && canResume
  const Icon = resolved ? CheckCircle : notice.code === SHIFT_REQUIRED_CODE ? Warning : PauseCircle

  return (
    <div
      className={`shift-block-notice${resolved ? ' is-resolved' : ''}`}
      role="alert"
      aria-live="assertive"
      data-code={notice.code}
    >
      <Icon className="shift-block-notice__icon" size={24} weight="fill" aria-hidden="true" />
      <div className="shift-block-notice__body">
        <strong className="shift-block-notice__title">{resolved ? 'Đã xử lý xong lý do chặn' : notice.title}</strong>
        <p className="shift-block-notice__message">
          {resolved ? 'Bạn có thể bấm lại thao tác vừa rồi để tiếp tục.' : notice.message}
        </p>
        {!resolved && (needsShift || canResumeIntake) ? (
          <div className="shift-block-notice__actions">
            {needsShift && shift === null ? (
              <Button
                type="button"
                variant="primary"
                icon={<LockKeyOpen size={18} weight="bold" aria-hidden="true" />}
                onClick={() => {
                  // Dialog Mở ca có sẵn tự hiện (kể cả ngoài vai trò Thu ngân); thẻ này đóng để không chồng hai lớp.
                  requestOpen()
                  dismiss()
                }}
              >
                Mở ca
              </Button>
            ) : null}
            {canResumeIntake ? <PauseIntakeButton /> : null}
          </div>
        ) : null}
      </div>
      <IconButton
        type="button"
        label="Đóng thông báo"
        icon={<X size={18} weight="bold" />}
        onClick={dismiss}
      />
    </div>
  )
}
