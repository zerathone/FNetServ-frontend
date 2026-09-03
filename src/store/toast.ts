import { create } from 'zustand'

export type ToastKind = 'error' | 'info' | 'success'

export type Toast = {
  id: number
  kind: ToastKind
  message: string
}

type ToastState = {
  toasts: Toast[]
  push: (message: string, kind?: ToastKind) => void
  dismiss: (id: number) => void
}

// Bộ đếm id đơn điệu (không dùng Date.now/Math.random để tránh phụ thuộc thời gian).
let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, kind = 'error') => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }] }))
  },
  dismiss: (id) => {
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
  },
}))

/** Helper gọi được ngoài React (vd interceptor client.ts). */
export function pushToast(message: string, kind: ToastKind = 'error') {
  useToastStore.getState().push(message, kind)
}
