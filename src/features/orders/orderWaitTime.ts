// Thời gian khách đã chờ một đơn -- dùng chung cho thẻ đơn ở /orders và thẻ "Combo chờ duyệt" ở /combo_sale.
// Ngưỡng vàng/đỏ lấy từ cài đặt `/settings/order` (nhóm queue, xem useOrderQueueConfig); chưa tải / lỗi ⇒ 10/20.
// CHỈ import type: file này được model có unit test (node --test) import — không được kéo api/client vào.
import type { OrderQueueConfig } from '../../api/settings'

/** Mặc định = đúng hai số trước đây hardcode (tiệm chưa cấu hình không đổi hành vi). */
export const DEFAULT_ORDER_QUEUE: OrderQueueConfig = { warn: 10, danger: 20 }

function waitMinutes(createdAtMs: number, now: number) {
  if (!createdAtMs) return null
  return Math.max(0, Math.floor((now - createdAtMs) / 60_000))
}

export function waitLabel(createdAtMs: number, now: number) {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return '–'
  if (minutes < 1) return 'vừa gọi'
  if (minutes < 60) return `${minutes}p`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}g` : `${h}g ${m}p`
}

/** `warn`/`danger` = 0 ⇒ tắt mức đó. */
export function waitTone(
  createdAtMs: number,
  now: number,
  thresholds: OrderQueueConfig = DEFAULT_ORDER_QUEUE,
): 'neutral' | 'info' | 'warning' | 'danger' {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return 'neutral'
  if (thresholds.danger > 0 && minutes >= thresholds.danger) return 'danger'
  if (thresholds.warn > 0 && minutes >= thresholds.warn) return 'warning'
  return 'info'
}

/** Đơn đã chờ quá ngưỡng đỏ (ngưỡng đỏ tắt ⇒ không bao giờ). */
export function isOverDangerWait(createdAtMs: number, now: number, thresholds: OrderQueueConfig = DEFAULT_ORDER_QUEUE) {
  const minutes = waitMinutes(createdAtMs, now)
  return minutes !== null && thresholds.danger > 0 && minutes >= thresholds.danger
}
