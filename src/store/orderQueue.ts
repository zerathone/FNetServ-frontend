import { create } from 'zustand'

/** Nhóm đang xem ở /orders (OrderWorkspace.activeView). */
export type OrderView = 'all' | 'service' | 'paid' | 'accepted-unpaid' | 'completed'

type OrderQueueState = {
  /** Dùng bởi /orders/legacy — truyền thẳng lên API làm param `userId`, KHÔNG đổi ý nghĩa. */
  selectedUserId: string
  /** Dùng bởi /orders (OrderWorkspace) — lọc client-side theo tên, không phải userId số. */
  customerNameFilter: string
  hostName: string
  /**
   * Nhóm mở sẵn cho LẦN VÀO /orders kế tiếp (vd bấm "Đã nhận món" ở bảng máy → "Đã chấp nhận"). OrderWorkspace đọc rồi xóa
   * ngay sau khi mở; null = mặc định "Đơn chờ".
   */
  initialView: OrderView | null
  setSelectedUserId: (value: string) => void
  setCustomerNameFilter: (value: string) => void
  setHostName: (value: string) => void
  setInitialView: (value: OrderView | null) => void
}

export const useOrderQueueStore = create<OrderQueueState>((set) => ({
  selectedUserId: '',
  customerNameFilter: '',
  hostName: '',
  initialView: null,
  setSelectedUserId: (value) => {
    set({ selectedUserId: value })
  },
  setCustomerNameFilter: (value) => {
    set({ customerNameFilter: value })
  },
  setHostName: (value) => {
    set({ hostName: value })
  },
  setInitialView: (value) => {
    set({ initialView: value })
  },
}))
