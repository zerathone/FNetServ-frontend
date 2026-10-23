import { useQuery } from '@tanstack/react-query'
import { getBookingList } from '../../api/onlineBooking'
import { useWsStatusStore } from '../../store/wsStatus'

export type BookingNavCounts = {
  /** Đơn chờ duyệt (wait_approval) -- thẻ "Chờ duyệt" ở trang Đặt máy online. null = chưa tải xong. */
  waiting: number | null
  /** Đơn đã duyệt, đang chờ khách đến nhận máy (confirmed, mọi ngày) -- thẻ "Đã duyệt". null = chưa tải xong. */
  confirmed: number | null
}

/**
 * 2 số cho mục Đặt máy online ở menu trái. Cùng queryKey/queryFn/chu kỳ poll với OnlineBookingWorkspace
 * (`total` của 2 truy vấn queue + confirmed) nên dùng chung cache và số khớp với 2 thẻ ở trang. Chưa có dữ
 * liệu -> null (không hiện chấm, và lần tải đầu không bị tính là "số thay đổi" để nháy).
 */
export function useBookingNavCounts(enabled: boolean): BookingNavCounts {
  const connected = useWsStatusStore((state) => state.connected)
  const queueQuery = useQuery({
    queryKey: ['onlinebook-queue'],
    queryFn: () => getBookingList({ status: 'wait_approval', limit: 50 }),
    refetchInterval: connected ? 15_000 : 5_000,
    enabled,
  })
  const confirmedQuery = useQuery({
    queryKey: ['onlinebook-confirmed'],
    queryFn: () => getBookingList({ status: 'confirmed', limit: 50 }),
    refetchInterval: connected ? 30_000 : 10_000,
    enabled,
  })
  return {
    waiting: queueQuery.data ? queueQuery.data.total : null,
    confirmed: confirmedQuery.data ? confirmedQuery.data.total : null,
  }
}
