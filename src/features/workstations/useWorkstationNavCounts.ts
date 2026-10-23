import { useQuery } from '@tanstack/react-query'
import { getWorkstationsRuntime } from '../../api/workstations'
import { useWsStatusStore } from '../../store/wsStatus'
import { WORKSTATION_STATUS } from './workstationModel'

export type WorkstationNavCounts = {
  playing: number
  available: number
  disconnected: number
}

/**
 * 3 số "Sử dụng / Sẵn sàng / Mất kết nối" cho mục Máy trạm ở sidebar.
 * Cùng queryKey + queryFn + chu kỳ poll với WorkstationWorkspace nên dùng chung cache, và cách đếm y hệt
 * `counts` ở đó (playing = status ONLINE, gồm cả máy admin). Chưa có dữ liệu -> null (UI không hiện chấm).
 * `poll` = false ở trang Theo dõi hoạt động: trang đó tự gọi lại query này theo PollSteps (vạch tiến trình phải
 * khớp đúng lần gọi thật), không được poll chồng lên.
 */
export function useWorkstationNavCounts(enabled: boolean, poll: boolean): WorkstationNavCounts | null {
  const connected = useWsStatusStore((state) => state.connected)
  const query = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    refetchInterval: poll ? (connected ? 30_000 : 5_000) : false,
    enabled,
  })
  const data = query.data
  if (!data || Array.isArray(data)) return null
  const items = data.items ?? []
  return {
    playing: items.filter((machine) => machine.status === WORKSTATION_STATUS.ONLINE).length,
    available: items.filter((machine) => machine.status === WORKSTATION_STATUS.AVAILABLE).length,
    disconnected: items.filter((machine) => machine.status === WORKSTATION_STATUS.DISCONNECT).length,
  }
}
