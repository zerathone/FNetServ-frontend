import { useWsStatusStore } from '../../store/wsStatus'

type DotTone = 'success' | 'danger' | 'neutral'

const LABEL_UNKNOWN = 'Chưa có trạng thái'
const LABEL_FIREBASE_ON = 'Firebase: đang kết nối'
const LABEL_FIREBASE_OFF = 'Firebase: mất kết nối'
const LABEL_SSE_ON = 'Cổng thanh toán: đang kết nối'
const LABEL_SSE_OFF = 'Cổng thanh toán: mất kết nối'
const LABEL_SSE_DISABLED = 'Cổng thanh toán: chưa kích hoạt'

function Dot({ tone, text, label }: { tone: DotTone; text: string; label: string }) {
  return (
    <span className={`listener-status-dot listener-status-dot--${tone}`} title={label} aria-label={label}>
      <span className="listener-status-dot__marker" role="img" aria-hidden="true" />
      {text}
    </span>
  )
}

// task system-listener-status: 2 cham trang thai song (Firebase Realtime DB + SSE cloud) canh
// StatusBadge cua nut "Giao dich online". Doc store bang selector rieng de PaymentOnlineButton
// (infoQuery 5 phut/lan) khong bi re-render moi lan WS doi trang thai listener.
// Nhan ngan "FB"/"SSE" (user chot 2026-09-28) -- ten goi ky thuat pho thong, khac case can viet
// day du chu tieng Viet; nghia day du van co trong tooltip (title/aria-label).
export function ListenerStatusDots() {
  const status = useWsStatusStore((state) => state.listenerStatus)

  if (!status) {
    return (
      <span className="listener-status-dots">
        <Dot tone="neutral" text="FB" label={LABEL_UNKNOWN} />
        <Dot tone="neutral" text="SSE" label={LABEL_UNKNOWN} />
      </span>
    )
  }

  const sseTone: DotTone =
    status.sse === 'connected' ? 'success' : status.sse === 'disabled' ? 'neutral' : 'danger'
  const sseLabel =
    status.sse === 'connected' ? LABEL_SSE_ON : status.sse === 'disabled' ? LABEL_SSE_DISABLED : LABEL_SSE_OFF

  return (
    <span className="listener-status-dots">
      <Dot
        tone={status.firebase ? 'success' : 'danger'}
        text="FB"
        label={status.firebase ? LABEL_FIREBASE_ON : LABEL_FIREBASE_OFF}
      />
      <Dot tone={sseTone} text="SSE" label={sseLabel} />
    </span>
  )
}
