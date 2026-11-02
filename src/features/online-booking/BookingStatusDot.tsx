import { Check, UserCheck, X } from '@phosphor-icons/react'
import type { BookingStatus } from '../../api/onlineBooking'

const ICON_SIZE = 10

/**
 * Chấm trạng thái trên thẻ đơn (Sơ đồ + Theo thời gian của Lịch theo máy): ba trạng thái hay gặp nhất
 * đổi sang icon để nhận ra ngay không cần đọc chữ, còn lại giữ chấm tròn trung tính như cũ.
 */
export function BookingStatusDot({ status }: { status: BookingStatus }) {
  switch (status) {
    case 'confirmed':
      return <Check size={ICON_SIZE} weight="bold" className="ob-map__status-icon" aria-hidden="true" />
    case 'in_use':
      return <UserCheck size={ICON_SIZE} weight="bold" className="ob-map__status-icon" aria-hidden="true" />
    case 'cancelled':
    case 'rejected':
      return <X size={ICON_SIZE} weight="bold" className="ob-map__status-icon" aria-hidden="true" />
    default:
      return <i className="ob-map__dot" aria-hidden="true" />
  }
}
