// Kiểu + hàm thuần dùng chung cho "Dịch vụ chờ" ở trang Máy trạm (khung bên phải và thẻ trên thanh công cụ).
import type { PendingComboOrder } from '../../api/orders'
import type { OperationNotification } from '../../api/notifications'
import type { AcceptedUnpaidGroup, CompletedGroup, GroupedOrder } from '../orders/orderQueueModel'
import { waitLabel } from '../orders/orderWaitTime'

export type PendingRow =
  | { kind: 'service'; key: string; createdAtMs: number; order: GroupedOrder }
  | { kind: 'combo'; key: string; createdAtMs: number; order: PendingComboOrder }
  // Thông báo `charge_request` (khách nạp tiền qua chat, server sinh theo từ khoá — chỉ nằm trong RAM server).
  | { kind: 'request'; key: string; createdAtMs: number; item: OperationNotification }
  // Tab "Đã duyệt": đơn đã Chấp nhận nhưng CHƯA thu tiền (còn thao tác Thanh toán / Cấn trừ / Hủy)…
  | { kind: 'unpaid'; key: string; createdAtMs: number; group: AcceptedUnpaidGroup }
  // …và đơn đã thu xong hôm nay (chỉ xem). `createdAtMs` của dòng này là lúc THU TIỀN, không phải lúc gọi món.
  | { kind: 'done'; key: string; createdAtMs: number; group: CompletedGroup }

/** Hai tab của khung bên phải: việc đang chờ duyệt, hoặc đơn đã duyệt (chưa thu + hoàn thành). */
export type PendingPanelView = 'pending' | 'approved'

export type PendingPayKind = 'cash' | 'deduct' | 'request' | null

export type PendingRowView = {
  host: string
  name: string
  quantity: number | null
  changed: boolean
  amount: number
  payKind: PendingPayKind
  detail: string
  /** Cột cuối: "Chờ" (thời gian chờ) cho việc đang chờ, giờ thu "HH:mm" cho đơn hoàn thành. */
  waitText?: string
}

export type MachineSource = {
  hostName: string
  status: number
  userId: number
  userName?: string | null
  userGroupType: number
}

/** Hai cách hiển thị: khung dọc bên phải danh sách máy, hoặc thẻ nằm ngang trên thanh công cụ. */
export type PendingDisplayMode = 'panel' | 'tags'

/** Số tiền khách xin nạp (server đã tách từ tin nhắn vào `meta.suggestMoney`); 0 = không tách được. */
export function suggestMoneyOf(item: OperationNotification) {
  const value = Number(item.meta?.suggestMoney)
  return Number.isFinite(value) && value > 0 ? value : 0
}

/** Thời gian chờ rút gọn cho khung hẹp: "mới" / "5p" / "1g 5p" (cùng cách tính với `waitLabel`). */
export function compactWait(createdAtMs: number, now: number) {
  const label = waitLabel(createdAtMs, now)
  return label === 'vừa gọi' ? 'mới' : label
}

/**
 * Tiền rút gọn: 25.000 → "25k", 12.500 → "12,5k", 1.500.000 → "1,5tr". Chỉ rút gọn khi KHÔNG làm tròn
 * (bội số của 10đ với k, của 1.000đ với tr); số lẻ hơn hiện đủ để không ai đọc nhầm số tiền.
 */
export function compactMoney(value: number) {
  const trim = (n: number, digits: number) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(n)
  if (value >= 1_000_000 && value % 1_000 === 0) return `${trim(value / 1_000_000, 3)}tr`
  if (value >= 1_000 && value < 1_000_000 && value % 10 === 0) return `${trim(value / 1_000, 2)}k`
  return trim(value, 0)
}

const COLLAPSED_KEY = 'fnet.ws.pendingServicePanel.collapsed'
const MODE_KEY = 'fnet.ws.pendingServiceMode'

export function readCollapsed() {
  try {
    return window.localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

export function writeCollapsed(value: boolean) {
  try {
    window.localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Trình duyệt chặn storage: chỉ mất nhớ trạng thái, không ảnh hưởng chức năng.
  }
}

const VIEW_KEY = 'fnet.ws.pendingServiceView'

export function readView(): PendingPanelView {
  try {
    return window.localStorage.getItem(VIEW_KEY) === 'approved' ? 'approved' : 'pending'
  } catch {
    return 'pending'
  }
}

export function writeView(value: PendingPanelView) {
  try {
    window.localStorage.setItem(VIEW_KEY, value)
  } catch {
    // Như writeCollapsed.
  }
}

export function readMode(): PendingDisplayMode {
  try {
    return window.localStorage.getItem(MODE_KEY) === 'tags' ? 'tags' : 'panel'
  } catch {
    return 'panel'
  }
}

export function writeMode(value: PendingDisplayMode) {
  try {
    window.localStorage.setItem(MODE_KEY, value)
  } catch {
    // Như writeCollapsed.
  }
}

export const MENU_WIDTH = 224
export const MENU_HEIGHT = 236
