import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getWorkstationsHardwareAll, getWorkstationsRuntime, type WorkstationHardware } from '../../api/workstations'
import { summarizeHealthAlerts, type HealthAlertSummary } from './healthAlertModel'

const POLL_MS = 30_000

/**
 * Badge cảnh báo phần cứng cho mục "Theo dõi hoạt động" ở menu trái: 1 nhóm duy nhất (GPU -> CPU -> lỗi máy trạm),
 * null khi không có máy nào bị. Cùng queryKey/queryFn và cùng cách ghép máy ↔ phần cứng theo hostName với
 * HealthMonitorPage nên dùng chung cache và số khớp với thanh thống kê trong trang.
 *
 * `poll` = false khi đang ở chính trang Theo dõi: trang đó tự gọi lại cả 2 query theo PollSteps (vạch tiến trình
 * phải khớp đúng lần gọi thật), nên ở đây không tự poll chồng lên.
 */
export function useHealthAlertSummary(enabled: boolean, poll: boolean): HealthAlertSummary | null {
  const refetchInterval = poll ? POLL_MS : false
  const runtimeQuery = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    refetchInterval,
    enabled,
  })
  const hardwareQuery = useQuery({
    queryKey: ['workstations-hardware-all'],
    queryFn: getWorkstationsHardwareAll,
    refetchInterval,
    enabled,
  })

  return useMemo(() => {
    const snapshot = Array.isArray(runtimeQuery.data) ? null : runtimeQuery.data
    const machines = snapshot?.items ?? []
    const hardwareByHost = new Map<string, WorkstationHardware>()
    for (const item of hardwareQuery.data?.items ?? []) {
      hardwareByHost.set(item.hostName.toLowerCase(), item.hardware)
    }
    return summarizeHealthAlerts(machines.map((machine) => hardwareByHost.get(machine.hostName.toLowerCase()) ?? null))
  }, [runtimeQuery.data, hardwareQuery.data])
}
