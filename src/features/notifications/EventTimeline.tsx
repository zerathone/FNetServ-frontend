import type { TimelineEvent } from './notificationModel'
import './notifications.css'

// Có giây: các sự kiện trạng thái máy có thể cách nhau vài giây (vd 15:38:12 → 15:38:16).
function clockTime(value: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(value)
}

// Timeline dọc: giờ · chấm màu theo mức · nội dung. Dùng chung card thông báo và hộp thoại
// "Hoạt động gần đây" của máy trạm.
export function EventTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <ol className="notification-timeline">
      {events.map((event) => (
        <li key={event.id} className={`notification-timeline__row notification-timeline__row--${event.tone}`}>
          <time dateTime={new Date(event.atMs).toISOString()}>{clockTime(event.atMs)}</time>
          <span className="notification-timeline__dot" aria-hidden="true" />
          <span className="notification-timeline__text">{event.label}</span>
        </li>
      ))}
    </ol>
  )
}
