import { useEffect, useRef, useState } from 'react'
import { CursorClick, Eye, Plugs } from '@phosphor-icons/react'
import type RFB from '@novnc/novnc'
import { realtimeWsBase, wsClient } from '../../ws/wsClient'
import { useAuthStore } from '../../store/auth'
import { Button, Segmented } from '../../design-system/components'
import type { RemoteMode } from '../../api/workstationRealtime'

// task 2.22r-D: xem/điều khiển máy trạm NGAY TRONG TRÌNH DUYỆT qua cầu nối /ws/vnc của server
// (server tự nối TCP tới <IP máy>:5996 theo hostName của vé — trình duyệt KHÔNG bao giờ gửi IP).
// noVNC được import LAZY khi mở (trang chính không nặng thêm). Đóng / bấm "Ngắt kết nối" =>
// đóng WS => server đóng TCP. Việc tắt winshower là của client (tự tắt sau 5 phút không ai nối).
//
// User chốt 2026-10-16: thanh trạng thái KHÔNG được lộ công nghệ (không chữ noVNC/VNC, không
// "dùng lại/khởi động VNC"); có công tắc Chỉ xem ⇄ Điều khiển ngay trên thanh + tốc độ + ping.
// Công tắc chỉ đổi `rfb.viewOnly` (chặn input phía trình duyệt) — cùng quyền R_REMOTE_MACHINE
// cho cả 2 chế độ nên không cần xin vé mới.

type Props = {
  hostName: string
  ticket: string
  password: string
  mode: RemoteMode
  /** performance.now() lúc người dùng bấm "Kết nối" — để đo thời gian tới khi sẵn sàng. */
  startedAt: number
  onClose: () => void
}

type Phase = 'loading' | 'connecting' | 'connected' | 'disconnected' | 'error'

const PHASE_LABEL: Record<Phase, string> = {
  loading: 'Đang tải trình xem…',
  connecting: 'Đang kết nối…',
  connected: 'Đã kết nối',
  disconnected: 'Đã ngắt kết nối',
  error: 'Lỗi kết nối',
}

const BAR_ICON = { size: 16, weight: 'bold' as const, 'aria-hidden': true }

const RATE_TICK_MS = 1_000
const PING_INTERVAL_MS = 3_000
const PING_TIMEOUT_MS = 2_500

function formatRate(bytesPerSec: number) {
  if (bytesPerSec >= 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`
  return `${Math.round(bytesPerSec / 1024)} KB/s`
}

function pingTone(ms: number) {
  return ms < 60 ? 'good' : ms < 150 ? 'warn' : 'bad'
}

/** Đo khứ hồi trình duyệt ⇄ máy chủ bằng lệnh `ping` sẵn có của /ws (server trả `pong`). */
function measurePing(): Promise<number | null> {
  return new Promise((resolve) => {
    const sentAt = performance.now()
    let done = false
    const finish = (value: number | null) => {
      if (done) return
      done = true
      window.clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    const unsubscribe = wsClient.subscribe((msg) => {
      if (msg.type === 'pong') finish(Math.round(performance.now() - sentAt))
    })
    const timer = window.setTimeout(() => finish(null), PING_TIMEOUT_MS)
    if (!wsClient.send({ type: 'ping' })) finish(null)
  })
}

export function NoVncViewer({ hostName, ticket, password, mode, startedAt, onClose }: Props) {
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const bytesRef = useRef(0)
  const [phase, setPhase] = useState<Phase>('loading')
  const [detail, setDetail] = useState('')
  const [readyMs, setReadyMs] = useState<number | null>(null)
  const [currentMode, setCurrentMode] = useState<RemoteMode>(mode)
  const [rate, setRate] = useState<number | null>(null)
  const [pingMs, setPingMs] = useState<number | null>(null)
  const token = useAuthStore((state) => state.token)

  useEffect(() => {
    let cancelled = false
    let rfb: RFB | null = null
    let socket: WebSocket | null = null

    void import('@novnc/novnc')
      .then(({ default: RFBClass }) => {
        if (cancelled || !screenRef.current) return
        setPhase('connecting')
        const url =
          `${realtimeWsBase()}/ws/vnc?ticket=${encodeURIComponent(ticket)}` +
          (token ? `&token=${encodeURIComponent(token)}` : '')
        // Tự tạo WebSocket rồi giao cho RFB (rfb.js nhận cả URL lẫn channel) để đếm byte nhận về
        // => tốc độ. RFB gán `onmessage`, listener riêng qua addEventListener không đụng nó.
        socket = new WebSocket(url)
        socket.binaryType = 'arraybuffer'
        socket.addEventListener('message', (event: MessageEvent) => {
          if (event.data instanceof ArrayBuffer) bytesRef.current += event.data.byteLength
        })
        rfb = new RFBClass(screenRef.current, socket, { credentials: { password } })
        rfbRef.current = rfb
        rfb.viewOnly = mode === 'view'
        rfb.scaleViewport = true
        rfb.resizeSession = false
        rfb.addEventListener('connect', () => {
          setPhase('connected')
          setReadyMs(Math.round(performance.now() - startedAt))
        })
        rfb.addEventListener('disconnect', (event) => {
          const clean = (event as CustomEvent<{ clean?: boolean }>).detail?.clean
          setPhase(clean ? 'disconnected' : 'error')
          if (!clean) setDetail('Kết nối bị đóng bất thường (phiên hết hạn, máy trạm ngắt phiên hoặc vượt giới hạn kết nối).')
          rfbRef.current = null
        })
        rfb.addEventListener('securityfailure', () => {
          setPhase('error')
          setDetail('Máy trạm từ chối kết nối.')
        })
        rfb.addEventListener('credentialsrequired', () => {
          // Server đã đưa mật khẩu trong vé; bị hỏi lại nghĩa là cấu hình máy trạm khác chuẩn.
          setPhase('error')
          setDetail('Máy trạm từ chối kết nối (cấu hình máy trạm khác chuẩn).')
          rfb?.disconnect()
        })
      })
      .catch(() => {
        if (cancelled) return
        setPhase('error')
        setDetail('Không tải được trình xem.')
      })

    return () => {
      cancelled = true
      try {
        rfb?.disconnect()
      } catch {
        // đã đóng
      }
      if (socket && socket.readyState !== WebSocket.CLOSED) socket.close()
      rfbRef.current = null
    }
    // Vé dùng 1 lần: chỉ kết nối đúng 1 lần cho mỗi lần mount (đổi vé = parent mount lại).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Tốc độ nhận (máy trạm -> trình duyệt) + ping, chỉ chạy khi đã kết nối.
  useEffect(() => {
    if (phase !== 'connected') return
    bytesRef.current = 0
    let last = performance.now()
    const rateTimer = window.setInterval(() => {
      const now = performance.now()
      setRate((bytesRef.current * 1000) / Math.max(1, now - last))
      bytesRef.current = 0
      last = now
    }, RATE_TICK_MS)

    let alive = true
    const doPing = () => {
      void measurePing().then((ms) => {
        if (alive) setPingMs(ms)
      })
    }
    doPing()
    const pingTimer = window.setInterval(doPing, PING_INTERVAL_MS)

    return () => {
      alive = false
      window.clearInterval(rateTimer)
      window.clearInterval(pingTimer)
      setRate(null)
      setPingMs(null)
    }
  }, [phase])

  const changeMode = (next: RemoteMode) => {
    setCurrentMode(next)
    const rfb = rfbRef.current
    if (!rfb) return
    rfb.viewOnly = next === 'view'
    if (next === 'control') rfb.focus()
  }

  const connected = phase === 'connected'

  return (
    <div className="ws-novnc" role="dialog" aria-modal="true" aria-label={`Điều khiển từ xa ${hostName}`}>
      <div className="ws-novnc__bar">
        <strong>{hostName}</strong>
        <span
          className={`ws-novnc__phase ws-novnc__phase--${phase}`}
          title={readyMs !== null ? `Sẵn sàng sau ${readyMs} ms` : undefined}
        >
          {PHASE_LABEL[phase]}
        </span>
        {connected ? (
          <span className="ws-novnc__stats">
            <span title="Tốc độ dữ liệu màn hình nhận về">Tốc độ {rate === null ? '—' : formatRate(rate)}</span>
            <span
              className={pingMs === null ? undefined : `ws-novnc__ping--${pingTone(pingMs)}`}
              title="Thời gian khứ hồi từ thiết bị này tới máy chủ quản lý"
            >
              Ping {pingMs === null ? '—' : `${pingMs} ms`}
            </span>
          </span>
        ) : null}
        <div className="ws-novnc__actions">
          <Segmented<RemoteMode>
            ariaLabel="Chế độ xem hoặc điều khiển"
            value={currentMode}
            onChange={changeMode}
            disabled={!connected}
            options={[
              { value: 'view', label: 'Chỉ xem', icon: <Eye {...BAR_ICON} /> },
              { value: 'control', label: 'Điều khiển', icon: <CursorClick {...BAR_ICON} /> },
            ]}
          />
          <Button type="button" variant="danger" icon={<Plugs {...BAR_ICON} />} onClick={onClose}>
            Ngắt kết nối
          </Button>
        </div>
      </div>
      {detail ? <div className="ws-novnc__detail">{detail}</div> : null}
      <div className="ws-novnc__screen" ref={screenRef} />
    </div>
  )
}
