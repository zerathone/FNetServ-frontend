// task work-shift S5-FE (F4) — thông báo "bị chặn vì ca" dùng chung (SHIFT_REQUIRED / ORDER_PAUSED). `api/client.ts` đẩy vào
// đây khi máy chủ trả hai mã đó; `features/shifts/ShiftBlockNotice` (gắn ở MainLayout) hiển thị kèm nút lối tắt.
// Store thuần (không import React) để gọi được từ ngoài component, giống `store/toast.ts`.
import { create } from 'zustand'
import type { ShiftBlock } from '../features/shifts/shiftScopeModel'
import { useAuthStore } from './auth'

export type ShiftBlockNotice = ShiftBlock & {
  /** Tăng mỗi lần báo — để lần chặn mới sau khi người dùng đã đóng thẻ vẫn hiện lại. */
  id: number
  /** Giờ trình duyệt (ms) lúc báo — so với `dataUpdatedAt` của `/shift/current` để biết trạng thái ca đã tải lại sau đó chưa. */
  at: number
}

type ShiftBlockState = {
  notice: ShiftBlockNotice | null
  report: (block: ShiftBlock) => void
  dismiss: () => void
}

let nextId = 1

export const useShiftBlockStore = create<ShiftBlockState>((set) => ({
  notice: null,
  report: (block) => set({ notice: { ...block, id: nextId++, at: Date.now() } }),
  dismiss: () => set({ notice: null }),
}))

// Đăng xuất / đổi tài khoản trên cùng tab (SPA không tải lại trang): thẻ của người trước KHÔNG được dính sang người sau.
useAuthStore.subscribe((state, previous) => {
  if (state.token !== previous.token) useShiftBlockStore.getState().dismiss()
})
