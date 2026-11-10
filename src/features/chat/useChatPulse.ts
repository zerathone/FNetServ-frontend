import { useEffect, useRef, useState } from 'react'
import { NAV_PULSE_MS } from '../../layouts/useNavBadge'

/**
 * `true` trong NAV_PULSE_MS (10 giây, cùng thời lượng chớp của chấm số menu trái) sau mỗi lần số tin chưa đọc
 * TĂNG — tức là có tin mới tới. Chỉ tăng mới chớp: đọc bớt / về 0 thì không (khác `useNavBadge`, vốn chớp cả khi giảm).
 *  - `unread` null = chưa có dữ liệu / kênh chat tắt: không chớp và KHÔNG tính là thay đổi (lần tải đầu không nháy).
 *  - Tin mới tới liên tiếp trong lúc đang chớp ⇒ tính lại đủ 10 giây từ tin mới nhất.
 */
export function useChatPulse(unread: number | null): boolean {
  const prevRef = useRef<number | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pulsing, setPulsing] = useState(false)

  useEffect(() => {
    if (unread === null) return
    const prev = prevRef.current
    prevRef.current = unread
    if (prev === null || unread <= prev) return

    setPulsing(true)
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      setPulsing(false)
    }, NAV_PULSE_MS)
  }, [unread])

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    },
    [],
  )

  return pulsing
}
