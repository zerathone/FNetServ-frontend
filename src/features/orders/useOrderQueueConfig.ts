// Ngưỡng cảnh báo hàng đơn chờ (task topping-kho W1) — đọc `/settings/order` bằng React Query, dùng chung cho
// /orders, "Combo chờ duyệt" (/combo_sale) và chip đơn chờ ở trang Máy trạm. Chưa tải xong / lỗi / Server cũ
// chưa có route ⇒ mặc định 10/20 (đúng hành vi trước đây).
import { useQuery } from '@tanstack/react-query'
import { getOrderConfig, ORDER_QUEUE_MAX_MINUTES, type OrderQueueConfig } from '../../api/settings'
import { DEFAULT_ORDER_QUEUE } from './orderWaitTime'

export const ORDER_CONFIG_QUERY_KEY = ['settings', 'order'] as const

export function useOrderConfigQuery(enabled = true) {
  return useQuery({
    queryKey: ORDER_CONFIG_QUERY_KEY,
    queryFn: getOrderConfig,
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

export function normalizeQueue(value: Partial<OrderQueueConfig> | undefined): OrderQueueConfig {
  const pick = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : fallback)
  return {
    warn: pick(value?.warn, DEFAULT_ORDER_QUEUE.warn),
    danger: pick(value?.danger, DEFAULT_ORDER_QUEUE.danger),
  }
}

/** Kiểm tra trước khi gửi — cùng luật với Server (0..1440, vàng ≤ đỏ khi cả hai > 0). null = hợp lệ. */
export function validateQueueThresholds(warn: number, danger: number): string | null {
  const ok = (v: number) => Number.isInteger(v) && v >= 0 && v <= ORDER_QUEUE_MAX_MINUTES
  if (!ok(warn) || !ok(danger)) return `Số phút phải là số nguyên từ 0 đến ${ORDER_QUEUE_MAX_MINUTES}.`
  if (warn > 0 && danger > 0 && warn > danger) return 'Cảnh báo vàng phải đến trước (hoặc cùng lúc) cảnh báo đỏ.'
  return null
}

export function useOrderQueueConfig(): OrderQueueConfig {
  const query = useOrderConfigQuery()
  return normalizeQueue(query.data?.queue)
}
