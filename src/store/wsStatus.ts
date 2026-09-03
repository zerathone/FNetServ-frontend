import { create } from 'zustand'

export type WsConnectionState = 'disconnected' | 'connecting' | 'reconnecting' | 'connected'

type WsStatusState = {
  connected: boolean
  state: WsConnectionState
  protocolVersion: number | null
  subscribedDomains: string[]
  lastError: string
  setConnecting: (reconnecting: boolean) => void
  setConnected: (protocolVersion: number) => void
  setDisconnected: () => void
  setSubscribedDomains: (domains: string[]) => void
  setError: (message: string) => void
}

export const useWsStatusStore = create<WsStatusState>((set) => ({
  connected: false,
  state: 'disconnected',
  protocolVersion: null,
  subscribedDomains: [],
  lastError: '',
  setConnecting: (reconnecting) =>
    set({ connected: false, state: reconnecting ? 'reconnecting' : 'connecting' }),
  setConnected: (protocolVersion) =>
    set({ connected: true, state: 'connected', protocolVersion, lastError: '' }),
  setDisconnected: () =>
    set({ connected: false, state: 'disconnected', subscribedDomains: [] }),
  setSubscribedDomains: (subscribedDomains) => set({ subscribedDomains }),
  setError: (lastError) => set({ lastError }),
}))
