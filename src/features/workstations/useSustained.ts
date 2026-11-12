import { useEffect, useState } from 'react'

/**
 * `true` chỉ khi `active` đã đứng LIÊN TỤC `delayMs` mili giây. `active` về false ⇒ tắt NGAY và đếm lại từ đầu lần sau.
 * Dùng để một tín hiệu thoáng qua (vd máy chớp trạng thái cảnh báo vài chục giây vì rớt mạng) không làm nhảy giao diện.
 * Mốc đếm sống theo vòng đời component: rời trang rồi quay lại thì đếm lại.
 */
export function useSustained(active: boolean, delayMs: number): boolean {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!active) {
      setReady(false)
      return
    }
    const timer = window.setTimeout(() => setReady(true), delayMs)
    return () => window.clearTimeout(timer)
  }, [active, delayMs])

  // `&& active`: tắt ngay trong lần vẽ này, không chờ effect đặt lại `ready`.
  return active && ready
}
