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

// task 2.22r-C: kha nang cua server gui trong `hello.capabilities` (additive). null = server cu
// chua gui => coi nhu khong co tinh nang remote.
export type WsCapabilities = {
  /** Server co desktop tuong tac (MFC) de mo winviewer tren may quay. */
  remoteLegacyViewer: boolean
  /** Cau noi /ws/vnc dang bat (INT_WS_VNC) => xem/dieu khien ngay trong trinh duyet. */
  remoteNoVnc: boolean
}

type WsStatusState = {
  connected: boolean
  state: WsConnectionState
  protocolVersion: number | null
  capabilities: WsCapabilities | null
  subscribedDomains: string[]
  lastError: string
  closeInfo: WsCloseInfo
  listenerStatus: ListenerStatus | null
  setConnecting: (reconnecting: boolean) => void
  setConnected: (protocolVersion: number, capabilities?: WsCapabilities | null) => void
  setDisconnected: (closeInfo?: WsCloseInfo) => void
  setSubscribedDomains: (domains: string[]) => void
  setError: (message: string) => void
  setListenerStatus: (status: ListenerStatus) => void
}

export const useWsStatusStore = create<WsStatusState>((set) => ({
  connected: false,
  state: 'disconnected',
  protocolVersion: null,
  capabilities: null,
  subscribedDomains: [],
  lastError: '',
  closeInfo: null,
  listenerStatus: null,
  setConnecting: (reconnecting) =>
    set({ connected: false, state: reconnecting ? 'reconnecting' : 'connecting' }),
  setConnected: (protocolVersion, capabilities = null) =>
    set({ connected: true, state: 'connected', protocolVersion, capabilities, lastError: '', closeInfo: null }),
  setDisconnected: (closeInfo = null) =>
    // Mat ket noi WS = khong con biet trang thai that cua Firebase/SSE nua -> reset ve null
    // (xam) thay vi giu gia tri cu (co the sai luc reconnect).
    set({ connected: false, state: 'disconnected', subscribedDomains: [], closeInfo, listenerStatus: null }),
  setSubscribedDomains: (subscribedDomains) => set({ subscribedDomains }),
  setError: (lastError) => set({ lastError }),
  setListenerStatus: (listenerStatus) => set({ listenerStatus }),
}))
