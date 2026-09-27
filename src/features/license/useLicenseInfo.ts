import { useQuery } from '@tanstack/react-query'
import { getLicenseInfo } from '../../api/system'

// Hook dùng chung cho LicenseButton (nút "Thông tin" ở topbar) và MainLayout (tên phòng máy cạnh
// đồng hồ sidebar) — cùng queryKey nên React Query dedupe, chỉ 1 request /system/license thực sự
// bắn đi dù 2 nơi cùng gọi. Gộp hook để tránh 2 nơi copy tay config (staleTime/refetchInterval) rồi
// lệch nhau về sau.
export function useLicenseInfo() {
  return useQuery({
    queryKey: ['license-info'],
    queryFn: getLicenseInfo,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  })
}
