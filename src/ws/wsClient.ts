import { API_BASE_URL } from '../api/client'
import { useWsStatusStore } from '../store/wsStatus'

export type WsMessage<T = unknown> = {
  type: string
  data?: T
  requestId?: string
}

type SubscriberFn = (msg: WsMessage) => void
type PendingRequest = {
  expectedType: string
  resolve: (value: unknown) => void
  reject: (reason: Error) => void
  timer: number
}

const REQUEST_TIMEOUT_MS = 7_000
const RECONNECT_MAX_MS = 30_000

export class WsCommandError extends Error {
  readonly status: string
  readonly requiredRight?: number

  constructor(status: string, requiredRight?: number) {
    super(
      status === 'forbidden'
        ? `Không đủ quyền thực hiện lệnh${requiredRight ? ` (${requiredRight})` : ''}.`
        : status === 'offline'
          ? 'Máy trạm đang ngoại tuyến.'
          : status === 'timeout'
            ? 'Máy trạm không phản hồi trong thời gian chờ.'
            : 'Không thực hiện được lệnh realtime.',
    )
    this.name = 'WsCommandError'
    this.status = status
    this.requiredRight = requiredRight
  }
}

let requestSequence = 0
export function makeWsRequestId(now = Date.now()) {
  requestSequence = (requestSequence + 1) % 1_000_000
  return `web_${now.toString(36)}_${requestSequence.toString(36)}`
}

function commandFamily(type: string) {
  const separator = type.lastIndexOf('.')
  return separator > 0 ? type.slice(0, separator) : type
}

class WsClient {
  private socket: WebSocket | null = null
  private retryCount = 0
  private timer: number | null = null
  private token: string | null = null
  private subscribers = new Set<SubscriberFn>()
  private pending = new Map<string, PendingRequest>()
  private domains: string[] = []
  private intentionalDisconnect = false

  public connect(token: string) {
    if (this.token && this.token !== token) {
      this.closeSocket('Phiên realtime đã thay đổi.')
    }
    this.token = token
    this.intentionalDisconnect = false
    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return
    }
    this.createSocket()
  }

  public disconnect() {
    this.intentionalDisconnect = true
    this.token = null
    this.clearTimer()
    this.closeSocket('Kết nối realtime đã đóng.')
    useWsStatusStore.getState().setDisconnected()
  }

  public setDomains(domains: string[]) {
    this.domains = [...new Set(domains)]
    if (this.socket?.readyState === WebSocket.OPEN) this.sendSubscription()
  }

  public subscribe(fn: SubscriberFn): () => void {
    this.subscribers.add(fn)
    return () => this.subscribers.delete(fn)
  }

  public send(msg: object): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(JSON.stringify(msg))
    return true
  }

  public request<TData extends { status?: string; requiredRight?: number }>(
    type: string,
    payload: Record<string, unknown>,
    timeoutMs = REQUEST_TIMEOUT_MS,
    expectedTypeOverride?: string,
  ): Promise<TData> {
    const requestId = makeWsRequestId()
    // §17-IMPL: hầu hết command trả về `<family>.result`, nhưng `workstation.apps.close` trả
    // riêng `workstation.apps.close.result` (khác `.get` cùng family) -- phải cho override.
    const expectedType = expectedTypeOverride ?? `${commandFamily(type)}.result`
    return new Promise<TData>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId)
        reject(new WsCommandError('timeout'))
      }, timeoutMs)
      this.pending.set(requestId, {
        expectedType,
        resolve: (value) => resolve(value as TData),
        reject,
        timer,
      })
      if (!this.send({ type, requestId, ...payload })) {
        window.clearTimeout(timer)
        this.pending.delete(requestId)
        reject(new Error('Realtime chưa kết nối.'))
      }
    })
  }

  public sendBinary(buf: ArrayBuffer): boolean {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return false
    this.socket.send(buf)
    return true
  }

  private createSocket() {
    if (this.intentionalDisconnect || !this.token) return
    useWsStatusStore.getState().setConnecting(this.retryCount > 0)
    const base = import.meta.env.DEV
      ? 'ws://127.0.0.1:18099'
      : API_BASE_URL.replace(/^http/, 'ws')
    const url = `${base}/ws?token=${encodeURIComponent(this.token)}`

    try {
      const socket = new WebSocket(url)
      this.socket = socket
      socket.binaryType = 'arraybuffer'
      socket.onopen = () => {
        this.retryCount = 0
      }
      socket.onclose = () => {
        if (this.socket === socket) this.socket = null
        useWsStatusStore.getState().setDisconnected()
        this.rejectPending('Kết nối realtime bị gián đoạn.')
        if (!this.intentionalDisconnect) this.scheduleReconnect()
      }
      socket.onerror = () => {
        useWsStatusStore.getState().setError('Không kết nối được realtime.')
      }
      socket.onmessage = (event) => this.handleMessage(event)
    } catch {
      useWsStatusStore.getState().setError('Không thể khởi tạo realtime.')
      this.scheduleReconnect()
    }
  }

  private handleMessage(event: MessageEvent) {
    if (event.data instanceof ArrayBuffer) {
      this.emit({ type: 'binary', data: event.data })
      return
    }
    try {
      const message = JSON.parse(String(event.data)) as WsMessage
      if (!message || typeof message !== 'object' || typeof message.type !== 'string') return

      if (message.type === 'hello') {
        const data = message.data as { protocolVersion?: number } | undefined
        useWsStatusStore.getState().setConnected(data?.protocolVersion ?? 1)
        this.sendSubscription()
      } else if (message.type === 'subscribed') {
        const data = message.data as { domains?: string[] } | undefined
        useWsStatusStore.getState().setSubscribedDomains(data?.domains ?? [])
      }

      if (message.requestId) {
        const pending = this.pending.get(message.requestId)
        if (pending && pending.expectedType === message.type) {
          window.clearTimeout(pending.timer)
          this.pending.delete(message.requestId)
          const data = message.data as { status?: string; requiredRight?: number } | undefined
          if (data?.status && data.status !== 'ok') {
            pending.reject(new WsCommandError(data.status, data.requiredRight))
          } else {
            pending.resolve(message.data)
          }
        }
      }
      this.emit(message)
    } catch {
      useWsStatusStore.getState().setError('Realtime trả message không hợp lệ.')
    }
  }

  private emit(message: WsMessage) {
    this.subscribers.forEach((subscriber) => subscriber(message))
  }

  private sendSubscription() {
    if (!this.domains.length) return
    this.send({ type: 'subscribe', domains: this.domains })
  }

  private scheduleReconnect() {
    if (this.intentionalDisconnect || !this.token) return
    this.clearTimer()
    const delay = Math.min(1_000 * 2 ** Math.min(this.retryCount, 5), RECONNECT_MAX_MS)
    const jitter = Math.round(Math.random() * 500)
    this.retryCount += 1
    this.timer = window.setTimeout(() => this.createSocket(), delay + jitter)
  }

  private closeSocket(reason: string) {
    const socket = this.socket
    this.socket = null
    if (socket) socket.close()
    this.rejectPending(reason)
  }

  private rejectPending(reason: string) {
    this.pending.forEach((pending) => {
      window.clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    })
    this.pending.clear()
  }

  private clearTimer() {
    if (this.timer !== null) window.clearTimeout(this.timer)
    this.timer = null
  }
}

export const wsClient = new WsClient()
