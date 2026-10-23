import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getAcceptedUnpaidOrders, getPendingOrders } from '../../api/orders'
import { useWsStatusStore } from '../../store/wsStatus'
import { groupAcceptedUnpaidOrders, groupOrders } from './orderQueueModel'

export type OrderNavCounts = {
  /** Đơn chờ chưa duyệt (Accept=0) -- tile "Dịch vụ" ở trang Đơn dịch vụ. */
  pending: number
  /** Đơn đã chấp nhận nhưng chưa thu tiền -- tile "Đã chấp nhận". */
  acceptedUnpaid: number
}

/**
 * 2 số cho mục Đơn dịch vụ ở menu trái. Cùng queryKey/queryFn/chu kỳ poll và cùng cách gom phiếu
 * (groupOrders / groupAcceptedUnpaidOrders) với OrderWorkspace nên dùng chung cache; khác ở chỗ KHÔNG lọc
 * theo ô tìm kiếm máy/khách của trang (số ở menu là toàn quán). Chưa có dữ liệu -> null.
 */
export function useOrderNavCounts(enabled: boolean): OrderNavCounts | null {
  const connected = useWsStatusStore((state) => state.connected)
  const refetchInterval = connected ? 30_000 : 5_000
  const pendingQuery = useQuery({
    queryKey: ['pending-orders', 'with-paid'],
    queryFn: () => getPendingOrders(undefined, { includePaid: true }),
    refetchInterval,
    enabled,
  })
  const acceptedQuery = useQuery({
    queryKey: ['orders-accepted-unpaid'],
    queryFn: () => getAcceptedUnpaidOrders(),
    refetchInterval,
    enabled,
  })

  return useMemo(() => {
    if (!pendingQuery.data || !acceptedQuery.data) return null
    return {
      pending: groupOrders(pendingQuery.data).length,
      acceptedUnpaid: groupAcceptedUnpaidOrders(acceptedQuery.data).length,
    }
  }, [pendingQuery.data, acceptedQuery.data])
}
