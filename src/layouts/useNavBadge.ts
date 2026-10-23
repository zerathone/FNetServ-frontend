import { useEffect, useRef, useState } from 'react'

/** Số ở menu trái chớp (sáng -> mờ -> sáng) trong bao lâu sau mỗi lần thay đổi. Đổi 30s -> 10s theo user 2026-10-23. */
export const NAV_PULSE_MS = 10_000
/** Riêng số vừa giảm về 0: chớp (và nán lại hiện số 0) chỉ 3 giây rồi biến mất (user 2026-10-23). */
export const NAV_PULSE_ZERO_MS = 3_000

export type NavBadgeState = {
  /** Số đang hiển thị (0 khi chỉ đang "nán lại" sau khi về 0). */
  value: number
  /** false = không render chấm. Chỉ hiện khi số > 0, trừ 3 giây nán lại sau khi vừa về 0. */
  visible: boolean
  /** true trong NAV_PULSE_MS (10 giây) sau khi số tăng / giảm / về 0 -> thêm class chớp. */
  pulsing: boolean
}

/**
 * Trạng thái hiển thị của 1 số ở menu trái.
 *  - `raw` null/undefined = chưa có dữ liệu: không hiện và KHÔNG tính là thay đổi (lần tải đầu không nháy).
 *  - Số đổi (tăng, giảm, hoặc về 0) so với lần trước đó đã biết -> `pulsing` 10 giây; đổi tiếp trong lúc đó thì
 *    tính lại đủ 10 giây từ lần đổi mới nhất.
 *  - Về 0 thì chấm vẫn hiện số 0 và chớp trong NAV_PULSE_ZERO_MS (3 giây) rồi mới biến mất ("chuẩn bị biến
 *    mất"); còn số > 0 mà đứng yên thì hiện bình thường, không chớp.
 */
export function useNavBadge(raw: number | null | undefined): NavBadgeState {
  const prevRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pulsing, setPulsing] = useState(false)
  const [lingerZero, setLingerZero] = useState(false)

  useEffect(() => {
    if (raw === null || raw === undefined) return
    const prev = prevRef.current
    prevRef.current = raw
    if (prev === null || prev === raw) return

    setPulsing(true)
    setLingerZero(raw === 0)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setPulsing(false)
      setLingerZero(false)
    }, raw === 0 ? NAV_PULSE_ZERO_MS : NAV_PULSE_MS)
  }, [raw])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  const value = raw ?? 0
  return { value, visible: value > 0 || lingerZero, pulsing }
}
