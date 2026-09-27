import { create } from 'zustand'

export type WsConnectionState = 'disconnected' | 'connecting' | 'reconnecting' | 'connected'

/** CloseEvent.code/reason của lần đóng kết nối gần nhất (null nếu chủ động disconnect()). */
export type WsCloseInfo = { code: number; reason: string } | null

type WsStatusState = {
  connected: boolean
  state: WsConnectionState
  protocolVersion: number | null
  subscribedDomains: string[]
  lastError: string
  closeInfo: WsCloseInfo
  setConnecting: (reconnecting: boolean) => void
  setConnected: (protocolVersion: number) => void
  setDisconnected: (closeInfo?: WsCloseInfo) => void
  setSubscribedDomains: (domains: string[]) => void
  setError: (message: string) => void
}

export const useWsStatusStore = create<WsStatusState>((set) => ({
  connected: false,
  state: 'disconnected',
  protocolVersion: null,
  subscribedDomains: [],
  lastError: '',
  closeInfo: null,
  setConnecting: (reconnecting) =>
    set({ connected: false, state: reconnecting ? 'reconnecting' : 'connecting' }),
  setConnected: (protocolVersion) =>
    set({ connected: true, state: 'connected', protocolVersion, lastError: '', closeInfo: null }),
  setDisconnected: (closeInfo = null) =>
    set({ connected: false, state: 'disconnected', subscribedDomains: [], closeInfo }),
  setSubscribedDomains: (subscribedDomains) => set({ subscribedDomains }),
  setError: (lastError) => set({ lastError }),
}))
