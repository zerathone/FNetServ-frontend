import { create } from 'zustand'

type OrderQueueState = {
  /** Dùng bởi /orders/legacy — truyền thẳng lên API làm param `userId`, KHÔNG đổi ý nghĩa. */
  selectedUserId: string
  /** Dùng bởi /orders (OrderWorkspace) — lọc client-side theo tên, không phải userId số. */
  customerNameFilter: string
  hostName: string
  setSelectedUserId: (value: string) => void
  setCustomerNameFilter: (value: string) => void
  setHostName: (value: string) => void
}

export const useOrderQueueStore = create<OrderQueueState>((set) => ({
  selectedUserId: '',
  customerNameFilter: '',
  hostName: '',
  setSelectedUserId: (value) => {
    set({ selectedUserId: value })
  },
  setCustomerNameFilter: (value) => {
    set({ customerNameFilter: value })
  },
  setHostName: (value) => {
    set({ hostName: value })
  },
}))
