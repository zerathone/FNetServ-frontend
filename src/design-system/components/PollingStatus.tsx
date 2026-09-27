import { useEffect, useRef, useState } from 'react'
import { StatusBadge, type StatusTone } from './StatusBadge'

export type PollingStatusProps = {
  /** true = có kênh WS đẩy sự kiện (useWsStatusStore().connected), false = đang tự polling REST. */
  connected: boolean
  /** Lần fetch gần nhất của query đang thất bại. */
  isError: boolean
  isFetching: boolean
  /** query.dataUpdatedAt — mốc để tính đếm lùi tới lần polling kế tiếp. */
  dataUpdatedAt: number
  /** refetchInterval đang áp dụng cho query (ms). */
  intervalMs: number
  onRefresh: () => void
  /** Dòng mô tả lỗi (status code) — chỉ hiện sau khi bấm cụm lúc đang lỗi. */
  errorDetail?: string
  className?: string
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1_000))
  if (totalSec < 60) return `${totalSec} giây`
  const totalMin = Math.floor(totalSec / 60)
  if (totalMin < 60) return `${totalMin} phút`
  return `${Math.floor(totalMin / 60)} giờ`
}

/**
 * Cụm "Làm mới" dùng chung cho các trang có refetchInterval đổi theo useWsStatusStore (Máy trạm,
 * Đơn dịch vụ): khung outline luôn bấm được để làm mới thủ công, badge bên dưới báo cách dữ liệu
 * đang được cập nhật (tự động qua WS / đang polling / polling đang lỗi).
 */
export function PollingStatus({
  connected,
  isError,
  isFetching,
  dataUpdatedAt,
  intervalMs,
  onRefresh,
  errorDetail,
  className = '',
}: PollingStatusProps) {
  const [now, setNow] = useState(() => Date.now())
  const [revealError, setRevealError] = useState(false)
  const errorSinceRef = useRef<number | null>(null)

  useEffect(() => {
    if (isError) errorSinceRef.current ??= Date.now()
    else {
      errorSinceRef.current = null
      setRevealError(false)
    }
  }, [isError])

  useEffect(() => {
    if (connected && !isError) return
    const id = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(id)
  }, [connected, isError])

  const tone: StatusTone = isError ? 'danger' : connected ? 'success' : 'warning'
  const label = isError
    ? `${formatElapsed(now - (errorSinceRef.current ?? now))} trước`
    : connected
      ? 'Tự động'
      : `Sau ${Math.max(0, Math.ceil((intervalMs - (now - dataUpdatedAt)) / 1_000))} giây`

  return (
    <button
      type="button"
      className={`ds-polling-status ${className}`.trim()}
      onClick={() => {
        if (isError) setRevealError(true)
        onRefresh()
      }}
      disabled={isFetching}
      title="Làm mới"
      aria-label={`Làm mới. Trạng thái: ${label}`}
    >
      <span className="ds-polling-status__label">Làm mới</span>
      <StatusBadge tone={tone}>{label}</StatusBadge>
      {isError && revealError && errorDetail ? (
        <span className="ds-polling-status__error">{errorDetail}</span>
      ) : null}
    </button>
  )
}
