import { useCallback, useEffect } from 'react'
import { create } from 'zustand'
import type { WorkstationRuntime } from '../../api/workstations'
import { WORKSTATION_STATUS } from './workstationModel'

// Máy "VỪA tắt trong phiên đang xem" (task ws-status-icons) → icon có viền đỏ. Máy đã tắt từ trước khi mở
// trang chỉ hiện tối. Server không báo "vừa tắt" nên web tự so snapshot sau với snapshot trước.
//
// Lưu trong zustand (không phải state của trang) để chuyển sang trang khác rồi quay lại vẫn còn viền đỏ;
// chỉ mất khi tải lại tab — đúng nghĩa "phiên đang xem". Độ trễ phát hiện = một chu kỳ poll snapshot (~30 giây
// khi có WebSocket). Lệnh "Tắt máy" do chính nhân viên bấm cũng ra viền đỏ vì client không phân biệt được.
//
// Viền đỏ gỡ khi: máy kết nối lại, máy biến mất khỏi danh sách, hoặc nhân viên mở chi tiết máy (acknowledge).

type RecentlyOffState = {
  /** Trạng thái của snapshot trước — chỉ để so sánh. Rỗng = chưa có snapshot nào (lần đầu không đánh dấu máy nào). */
  lastStatus: Record<string, number>
  /** hostName → epoch ms lúc phát hiện tắt. Có mặt trong đây = đang hiện viền đỏ. */
  offAt: Record<string, number>
  observe: (machines: readonly WorkstationRuntime[], nowMs: number) => void
  acknowledge: (hostName: string) => void
}

export const useRecentlyOffStore = create<RecentlyOffState>((set, get) => ({
  lastStatus: {},
  offAt: {},
  observe: (machines, nowMs) => {
    const { lastStatus, offAt } = get()
    const hasBaseline = Object.keys(lastStatus).length > 0
    const nextStatus: Record<string, number> = {}
    const nextOffAt: Record<string, number> = {}
    let offAtChanged = false

    for (const machine of machines) {
      const host = machine.hostName
      nextStatus[host] = machine.status
      if (machine.status !== WORKSTATION_STATUS.DISCONNECT) continue

      if (offAt[host] !== undefined) {
        nextOffAt[host] = offAt[host]
      } else {
        const previous = lastStatus[host]
        // Chỉ tính là "vừa tắt" khi ĐÃ thấy máy ở trạng thái khác (đang bật) ở snapshot trước.
        if (hasBaseline && previous !== undefined && previous !== WORKSTATION_STATUS.DISCONNECT) {
          nextOffAt[host] = nowMs
          offAtChanged = true
        }
      }
    }
    // Máy không còn DISCONNECT (kết nối lại) hoặc đã biến mất khỏi danh sách ⇒ gỡ viền.
    if (Object.keys(offAt).some((host) => nextOffAt[host] === undefined)) offAtChanged = true

    set({ lastStatus: nextStatus, ...(offAtChanged ? { offAt: nextOffAt } : {}) })
  },
  acknowledge: (hostName) => {
    const { offAt } = get()
    if (offAt[hostName] === undefined) return
    const next = { ...offAt }
    delete next[hostName]
    set({ offAt: next })
  },
}))

/**
 * Gọi MỘT lần ở trang Máy trạm với danh sách CHƯA lọc (lọc theo nhóm/từ khóa sẽ tạo "máy biến mất" giả).
 * Trả về hàm hỏi "máy này vừa tắt?".
 */
export function useRecentlyOff(allMachines: readonly WorkstationRuntime[]) {
  const observe = useRecentlyOffStore((state) => state.observe)
  const offAt = useRecentlyOffStore((state) => state.offAt)

  useEffect(() => {
    // Danh sách rỗng thường là đang tải / lỗi chứ không phải mọi máy biến mất ⇒ không cập nhật mốc so sánh.
    if (allMachines.length === 0) return
    observe(allMachines, Date.now())
  }, [allMachines, observe])

  // Identity chỉ đổi khi tập máy "vừa tắt" đổi ⇒ dùng làm dependency được.
  return useCallback((hostName: string) => offAt[hostName] !== undefined, [offAt])
}
