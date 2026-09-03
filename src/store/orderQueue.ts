import { create } from 'zustand'

type OrderQueueState = {
  selectedUserId: string
  hostName: string
  setSelectedUserId: (value: string) => void
  setHostName: (value: string) => void
}

export const useOrderQueueStore = create<OrderQueueState>((set) => ({
  selectedUserId: '',
  hostName: '',
  setSelectedUserId: (value) => {
    set({ selectedUserId: value })
  },
  setHostName: (value) => {
    set({ hostName: value })
  },
}))
