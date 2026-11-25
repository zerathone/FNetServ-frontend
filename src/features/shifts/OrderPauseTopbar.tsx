// task work-shift S3b-FE — khối "Dừng nhận đơn" Ở THANH TRÊN CÙNG (topbar), mọi trang (user chốt 2026-11-21: chuyển từ dải cố
// định ở đáy màn hình lên topbar). Nằm TRONG chiều cao topbar hiện có (4rem) — không thêm hàng nên không đẩy layout xuống
// (nhiều trang tính chiều cao theo 100vh). Màn hẹp: chữ rút gọn còn "Dừng nhận đơn" + nút chỉ biểu tượng; giờ ngừng,
// tên, lý do, thời gian đã ngừng nằm ở `title` (tooltip).
// Cờ thủ công: khối đỏ + nút "Tiếp tục nhận đơn". Quá 30 phút (Q10): nhấn mạnh + nhắc MỘT lần, KHÔNG tự tiếp tục.
// "Không có ca" (`noShift`, S4b): chế độ Bắt buộc ⇒ khối đỏ không nút (tự hết khi có người mở ca); chế độ Ghi sổ ⇒ khối vàng chỉ nhắc.
import { PauseCircle, Warning } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { pushToast } from '../../store/toast'
import { formatElapsed, isIntakePaused, isNoShiftWarningOnly, isPauseOverdue, pauseChipText } from './shiftModel'
import { PauseIntakeButton } from './PauseIntakeButton'
import { useOrderIntake, usePauseElapsedMinutes } from './useOrderIntake'
import './shifts.css'

const REMINDED_KEY = 'fnet-intake-pause-reminded'

/** Đã nhắc cho lần ngừng này (khoá bằng `since`) trong tab này chưa. Lỗi storage ⇒ coi như chưa (tối đa nhắc lại sau F5). */
function wasReminded(since: string): boolean {
  try {
    return sessionStorage.getItem(REMINDED_KEY) === since
  } catch {
    return false
  }
}

function markReminded(since: string) {
  try {
    sessionStorage.setItem(REMINDED_KEY, since)
  } catch {
    // bỏ qua: chỉ là chống nhắc lặp
  }
}

export function OrderPauseTopbar() {
  const { enabled: shiftOn, orderPause } = useOrderIntake()
  const minutes = usePauseElapsedMinutes()
  const overdue = isPauseOverdue(minutes)
  const manualSince = orderPause?.manual.on ? orderPause.manual.since : ''

  useEffect(() => {
    if (!overdue || !manualSince || minutes === null || wasReminded(manualSince)) return
    markReminded(manualSince)
    pushToast(
      shiftOn
        ? `Đã dừng nhận đơn ${formatElapsed(minutes)}. Kiểm kho xong thì bấm Tiếp tục nhận đơn.`
        : `Đã dừng nhận đơn ${formatElapsed(minutes)}. Sẵn sàng thì bấm Tiếp tục nhận đơn.`,
      'info',
    )
  }, [overdue, manualSince, minutes, shiftOn])

  if (!orderPause) return null
  const manual = orderPause.manual.on
  const blocking = isIntakePaused(orderPause)
  const warningOnly = !manual && isNoShiftWarningOnly(orderPause)
  // Ba trường hợp có khối: cờ thủ công, "không có ca" đang chặn, "không có ca" chỉ nhắc (không chặn).
  if (!manual && !blocking && !warningOnly) return null

  const text = pauseChipText(orderPause, minutes)
  const Icon = warningOnly || overdue ? Warning : PauseCircle

  return (
    <div
      className={`order-pause-chip${overdue ? ' is-overdue' : ''}${warningOnly ? ' is-warning' : ''}${manual ? ' has-action' : ''}`}
      role="status"
      aria-live="polite"
      title={text.tooltip}
      data-kind={manual ? 'manual' : warningOnly ? 'no-shift-warning' : 'no-shift'}
    >
      <Icon className="order-pause-chip__icon" size={20} weight="fill" aria-hidden="true" />
      <span className="order-pause-chip__text">
        <strong className="order-pause-chip__short">{text.short}</strong>
        <strong className="order-pause-chip__long">
          {text.long}
          {manual && overdue && minutes !== null ? ` · đã dừng ${formatElapsed(minutes)}` : ''}
        </strong>
      </span>
      {manual ? <PauseIntakeButton compact /> : null}
    </div>
  )
}
