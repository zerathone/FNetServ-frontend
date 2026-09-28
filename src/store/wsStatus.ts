import { create } from 'zustand'

export type WsConnectionState = 'disconnected' | 'connecting' | 'reconnecting' | 'connected'

/** CloseEvent.code/reason của lần đóng kết nối gần nhất (null nếu chủ động disconnect()). */
export type WsCloseInfo = { code: number; reason: string } | null

// task system-listener-status: trang thai 2 "listener" ben ngoai (Firebase Realtime DB + SSE
// cloud) day tu server qua message "system.listener_status" (snapshot ngay sau "hello", roi
// moi lan doi that su). null = chua nhan duoc snapshot nao (vd vua mo WS).
export type ListenerStatus = {
  firebase: boolean
  sse: 'connected' | 'disconnected' | 'disabled'
}

type WsStatusState = {
  connected: boolean
  state: WsConnectionState
  protocolVersion: number | null
  subscribedDomains: string[]
  lastError: string
  closeInfo: WsCloseInfo
  listenerStatus: ListenerStatus | null
  setConnecting: (reconnecting: boolean) => void
  setConnected: (protocolVersion: number) => void
  setDisconnected: (closeInfo?: WsCloseInfo) => void
  setSubscribedDomains: (domains: string[]) => void
  setError: (message: string) => void
  setListenerStatus: (status: ListenerStatus) => void
}

export const useWsStatusStore = create<WsStatusState>((set) => ({
  connected: false,
  state: 'disconnected',
  protocolVersion: null,
  subscribedDomains: [],
  lastError: '',
  closeInfo: null,
  listenerStatus: null,
  setConnecting: (reconnecting) =>
    set({ connected: false, state: reconnecting ? 'reconnecting' : 'connecting' }),
  setConnected: (protocolVersion) =>
    set({ connected: true, state: 'connected', protocolVersion, lastError: '', closeInfo: null }),
  setDisconnected: (closeInfo = null) =>
    // Mat ket noi WS = khong con biet trang thai that cua Firebase/SSE nua -> reset ve null
    // (xam) thay vi giu gia tri cu (co the sai luc reconnect).
    set({ connected: false, state: 'disconnected', subscribedDomains: [], closeInfo, listenerStatus: null }),
  setSubscribedDomains: (subscribedDomains) => set({ subscribedDomains }),
  setError: (lastError) => set({ lastError }),
  setListenerStatus: (listenerStatus) => set({ listenerStatus }),
}))
