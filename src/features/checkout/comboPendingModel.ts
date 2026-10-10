import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getPendingComboOrders } from '../../api/orders'
import { useWsStatusStore } from '../../store/wsStatus'

// Chuyển từ OrderWorkspace (/orders) sang trang /combo_sale -- than hàm giữ nguyên.

export function parseComboCreatedAt(value?: string) {
  if (!value) return 0
  const normalized = value.trim().replace(' ', 'T')
  const parsed = new Date(normalized).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

/** BE trả "YYYY-MM-DD HH:MM:SS" (date_to + time_to) -- đổi sang dd/mm/yyyy hh:mm cho card combo. */
export function formatExpireDate(value?: string) {
  if (!value) return '--'
  const parsed = new Date(value.trim().replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/** zone = tên các nhóm máy nối bằng '|' (DAOCombo::get) -- đổi dấu nối sang "·" cho dễ đọc. */
export function formatZoneList(value: string) {
  return value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')
}

/**
 * Combo khách mua từ máy trạm đang chờ thu ngân xác nhận (Accept=0). Cùng query key `['pending-orders-combo']`
 * với trước đây nên các nơi đang invalidate key này (ServerEventsProvider, fintechQueries) vẫn làm mới được;
 * nút trên thanh thống kê và danh sách dùng chung 1 cache.
 */
export function usePendingComboOrders() {
  const connected = useWsStatusStore((state) => state.connected)
  const query = useQuery({
    queryKey: ['pending-orders-combo'],
    queryFn: getPendingComboOrders,
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const orders = useMemo(
    () =>
      [...(query.data ?? [])].sort((left, right) => {
        // Hết hạn sớm nhất lên đầu; nếu bằng nhau thì đơn cũ hơn lên trước.
        const expL = parseComboCreatedAt(left.expireDate)
        const expR = parseComboCreatedAt(right.expireDate)
        if (expL !== expR) return expL - expR
        return parseComboCreatedAt(left.createdAt) - parseComboCreatedAt(right.createdAt)
      }),
    [query.data],
  )
  const total = orders.reduce((sum, order) => sum + order.price, 0)
  return { query, orders, total }
}
