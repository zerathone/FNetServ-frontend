import { useEffect, useRef, useState } from 'react'
import type RFB from '@novnc/novnc'
import { realtimeWsBase } from '../../ws/wsClient'
import { useAuthStore } from '../../store/auth'
import { Button } from '../../design-system/components'
import type { RemoteMode } from '../../api/workstationRealtime'

// task 2.22r-D: xem/điều khiển máy trạm NGAY TRONG TRÌNH DUYỆT qua cầu nối /ws/vnc của server
// (server tự nối TCP tới <IP máy>:5996 theo hostName của vé — trình duyệt KHÔNG bao giờ gửi IP).
// noVNC được import LAZY khi mở (trang chính không nặng thêm). Đóng / bấm "Ngắt kết nối" =>
// đóng WS => server đóng TCP. Việc tắt winshower là của client (tự tắt sau 5 phút không ai nối).

type Props = {
  hostName: string
  ticket: string
  password: string
  mode: RemoteMode
  /** performance.now() lúc người dùng bấm "Kết nối" — để đo thời gian tới khi sẵn sàng. */
  startedAt: number
  vncReused: boolean
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

export function NoVncViewer({ hostName, ticket, password, mode, startedAt, vncReused, onClose }: Props) {
  const screenRef = useRef<HTMLDivElement>(null)
  const rfbRef = useRef<RFB | null>(null)
  const [phase, setPhase] = useState<Phase>('loading')
  const [detail, setDetail] = useState('')
  const [readyMs, setReadyMs] = useState<number | null>(null)
  const token = useAuthStore((state) => state.token)

  useEffect(() => {
    let cancelled = false
    let rfb: RFB | null = null

    void import('@novnc/novnc')
      .then(({ default: RFBClass }) => {
        if (cancelled || !screenRef.current) return
        setPhase('connecting')
        const url =
          `${realtimeWsBase()}/ws/vnc?ticket=${encodeURIComponent(ticket)}` +
          (token ? `&token=${encodeURIComponent(token)}` : '')
        rfb = new RFBClass(screenRef.current, url, { credentials: { password } })
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
          if (!clean) setDetail('Kết nối bị đóng bất thường (vé hết hạn, máy trạm tắt VNC hoặc vượt giới hạn kết nối).')
          rfbRef.current = null
        })
        rfb.addEventListener('securityfailure', (event) => {
          const reason = (event as CustomEvent<{ reason?: string }>).detail?.reason
          setPhase('error')
          setDetail(reason ? `Xác thực VNC thất bại: ${reason}` : 'Xác thực VNC thất bại.')
        })
        rfb.addEventListener('credentialsrequired', () => {
          // Server đã đưa mật khẩu trong vé; bị hỏi lại nghĩa là mật khẩu sai.
          setPhase('error')
          setDetail('Máy trạm yêu cầu mật khẩu VNC khác với cấu hình chuẩn.')
          rfb?.disconnect()
        })
      })
      .catch(() => {
        if (cancelled) return
        setPhase('error')
        setDetail('Không tải được trình xem noVNC.')
      })

    return () => {
      cancelled = true
      try {
        rfb?.disconnect()
      } catch {
        // đã đóng
      }
      rfbRef.current = null
    }
    // Vé dùng 1 lần: chỉ kết nối đúng 1 lần cho mỗi lần mount (đổi vé = parent mount lại).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="ws-novnc" role="dialog" aria-modal="true" aria-label={`Điều khiển từ xa ${hostName}`}>
      <div className="ws-novnc__bar">
        <strong>{hostName}</strong>
        <span className={`ws-novnc__phase ws-novnc__phase--${phase}`}>{PHASE_LABEL[phase]}</span>
        <span className="ws-novnc__info">
          noVNC · {mode === 'view' ? 'Chỉ xem' : 'Điều khiển'}
          {readyMs !== null ? ` · sẵn sàng sau ${readyMs} ms` : ''}
          {vncReused ? ' · dùng lại VNC đang chạy' : ' · đã khởi động VNC'}
        </span>
        <Button type="button" variant="danger" onClick={onClose}>
          Ngắt kết nối
        </Button>
      </div>
      {detail ? <div className="ws-novnc__detail">{detail}</div> : null}
      <div className="ws-novnc__screen" ref={screenRef} />
    </div>
  )
}
