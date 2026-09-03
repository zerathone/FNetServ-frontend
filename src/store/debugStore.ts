import { create } from 'zustand'

export type LogType = 'API_ERROR' | 'RENDER_ERROR'

export interface ErrorLog {
  id: string
  type: LogType
  timestamp: string
  message: string
  details?: any
  url?: string
}

interface DebugState {
  logs: ErrorLog[]
  addLog: (log: Omit<ErrorLog, 'id' | 'timestamp'>) => void
  clearLogs: () => void
}

export const useDebugStore = create<DebugState>((set) => ({
  logs: [],
  addLog: (log) => set((state) => {
    const newLog = {
      ...log,
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
    }
    // Giữ tối đa 50 log gần nhất
    const newLogs = [newLog, ...state.logs].slice(0, 50)
    return { logs: newLogs }
  }),
  clearLogs: () => set({ logs: [] }),
}))
