import { useEffect, useState } from 'react'
import { StatusBadge } from '../../design-system/components'
import { formatCountdown } from './onlineBookingModel'

// Nhãn đếm ngược hạn duyệt của đơn "chờ duyệt". Timer 1 giây nằm ở ĐÂY (component lá) thay vì ở gốc trang
// Đặt máy online: trước đây `setNow` mỗi giây ở gốc kéo cả trang (gồm lịch theo máy từng máy một dòng) render lại.
export function ApprovalCountdownBadge({ deadline }: { deadline: string | null }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  const countdown = formatCountdown(deadline, now)
  return (
    <StatusBadge tone={countdown.expired ? 'danger' : 'warning'}>
      {countdown.expired ? 'Đã hết hạn duyệt' : `Hết hạn sau ${countdown.label}`}
    </StatusBadge>
  )
}
