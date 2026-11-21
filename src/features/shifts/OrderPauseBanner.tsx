// task work-shift S3b-FE — banner đỏ toàn trang khi đang ngừng nhận đơn (design mục 8b). Gắn ở MainLayout nên mọi trang
// đều thấy. Có nút "Tiếp tục nhận đơn" (chỉ cờ thủ công). Quá 30 phút (Q10): nhấn mạnh + nhắc MỘT lần, KHÔNG tự tiếp tục.
// Nguồn tự động `no_shift` (S4b): chỉ thông báo, không có nút (tự hết khi có người mở ca).
import { PauseCircle, Warning } from '@phosphor-icons/react'
import { useEffect } from 'react'
import { pushToast } from '../../store/toast'
import { formatElapsed, isIntakePaused, isPauseOverdue, pauseHeadline } from './shiftModel'
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

export function OrderPauseBanner() {
  const { orderPause } = useOrderIntake()
  const minutes = usePauseElapsedMinutes()
  const overdue = isPauseOverdue(minutes)
  const manualSince = orderPause?.source === 'manual' ? orderPause.since : ''

  useEffect(() => {
    if (!overdue || !manualSince || minutes === null || wasReminded(manualSince)) return
    markReminded(manualSince)
    pushToast(
      `Đã ngừng nhận đơn ${formatElapsed(minutes)}. Kiểm kho xong thì bấm Tiếp tục nhận đơn.`,
      'info',
    )
  }, [overdue, manualSince, minutes])

  if (!orderPause || !isIntakePaused(orderPause)) return null

  const manual = orderPause.source === 'manual'
  const Icon = overdue ? Warning : PauseCircle

  return (
    <div
      className={`order-pause-banner${overdue ? ' is-overdue' : ''}`}
      role="status"
      aria-live="polite"
      data-source={orderPause.source}
    >
      <Icon className="order-pause-banner__icon" size={22} weight="fill" aria-hidden="true" />
      <div className="order-pause-banner__text">
        <strong>{pauseHeadline(orderPause)}</strong>
        {manual && minutes !== null ? (
          <span>
            {overdue
              ? `Đã ngừng ${formatElapsed(minutes)} — kiểm kho xong chưa? Bấm Tiếp tục nhận đơn để khách gọi món lại.`
              : `Đã ngừng ${formatElapsed(minutes)}. Duyệt, hủy và thu đơn đã có vẫn dùng được.`}
          </span>
        ) : manual ? (
          <span>Duyệt, hủy và thu đơn đã có vẫn dùng được.</span>
        ) : (
          <span>Ca đầu tiên được mở thì quán nhận đơn trở lại.</span>
        )}
      </div>
      {manual ? <PauseIntakeButton /> : null}
    </div>
  )
}
