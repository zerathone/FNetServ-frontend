import { useEffect, useState } from 'react'

// Đồng hồ ở đầu sidebar: chỉ hiện ngày + giờ:phút nên chỉ cần cập nhật mỗi phút. Tách riêng để state thời gian
// không làm `MainLayout` (topbar + menu) render lại — trước đây `setInterval(…, 1000)` ở layout khiến cả khung
// render lại mỗi giây ở mọi trang. Tạo bộ định dạng một lần ở mức module (không dựng lại mỗi lần render).
const DATE_FORMAT = new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' })
const TIME_FORMAT = new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', hour12: false })

const MS_PER_MINUTE = 60_000
/** Đệm nhỏ để timer không bắn trước mốc phút (setTimeout có thể sớm vài ms) rồi hiện lại phút cũ. */
const MINUTE_EDGE_PAD_MS = 50

export function SidebarClock() {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    let timer: number | undefined
    // setTimeout tới đầu phút kế tiếp rồi lặp lại (setInterval 60 s sẽ trôi lệch khỏi mốc đổi phút).
    const schedule = () => {
      const delay = MS_PER_MINUTE - (Date.now() % MS_PER_MINUTE) + MINUTE_EDGE_PAD_MS
      timer = window.setTimeout(() => {
        setNow(new Date())
        schedule()
      }, delay)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className="app-sidebar__clock">
      <span className="app-sidebar__clock-date">{DATE_FORMAT.format(now)}</span>
      <span className="app-sidebar__clock-time">{TIME_FORMAT.format(now)}</span>
    </div>
  )
}
