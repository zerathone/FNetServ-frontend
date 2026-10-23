import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getSystemLogs } from '../../api/logs'
import { DateRangePicker, Dialog, InlineAlert, StateView } from '../../design-system/components'
import { EventTimeline } from '../notifications/EventTimeline'
import {
  chainEvents,
  logEventsForHost,
  toLocalDate,
  type TimelineEvent,
  type TimelineTone,
} from '../notifications/notificationModel'
import './machine-activity.css'

// Server cắt theo LIMIT; một máy hiếm khi quá số này trong 1 ngày. Quá thì báo rõ để không ai
// tưởng đó là toàn bộ nhật ký.
const LIMIT = 500

type ActivityCard = {
  key: string
  events: TimelineEvent[]
  startMs: number
  endMs: number
  tone: TimelineTone
}

// Màu vạch card theo sự kiện nặng nhất trong chuỗi: mất kết nối > cảnh báo > còn lại.
function worstTone(events: TimelineEvent[]): TimelineTone {
  if (events.some((event) => event.tone === 'urgent')) return 'urgent'
  if (events.some((event) => event.tone === 'attention')) return 'attention'
  if (events.some((event) => event.tone === 'info')) return 'info'
  return 'ok'
}

function clock(atMs: number) {
  return new Intl.DateTimeFormat('vi-VN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(atMs)
}

function dayTitle(atMs: number) {
  return new Intl.DateTimeFormat('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }).format(atMs)
}

// Tóm tắt nhật ký hệ thống của ĐÚNG máy này (cùng nguồn trang Nhật ký hệ thống), mỗi lần máy đổi
// trạng thái một dòng, kèm tên tài khoản đang đăng nhập nếu có. Chỉ gọi khi hộp thoại mở.
export function MachineActivityDialog({
  hostName,
  open,
  onClose,
}: {
  hostName: string
  open: boolean
  onClose: () => void
}) {
  const [fromDate, setFromDate] = useState(() => toLocalDate(Date.now()))
  const [toDate, setToDate] = useState(() => toLocalDate(Date.now()))

  const query = useQuery({
    queryKey: ['machine-activity', hostName, fromDate, toDate],
    queryFn: () => getSystemLogs(fromDate, toDate, LIMIT, 0, 0, hostName),
    enabled: open && Boolean(hostName),
    staleTime: 10_000,
  })

  // Sự kiện gần nhau (≤ 5 phút) gom thành 1 card; card mới → cũ, chia theo ngày (khoảng ngày có
  // thể nhiều hơn 1). Trong card các dòng xếp cũ → mới như một chuỗi diễn biến.
  const days = useMemo(() => {
    const events = logEventsForHost(hostName, query.data?.items ?? [])
    const cards: ActivityCard[] = chainEvents(events)
      .map((chain) => ({
        key: chain[0].id,
        events: chain,
        startMs: chain[0].atMs,
        endMs: chain[chain.length - 1].atMs,
        tone: worstTone(chain),
      }))
      .reverse()
    const result: { key: string; title: string; cards: ActivityCard[] }[] = []
    for (const card of cards) {
      const key = toLocalDate(card.endMs)
      const last = result[result.length - 1]
      if (last && last.key === key) last.cards.push(card)
      else result.push({ key, title: dayTitle(card.endMs), cards: [card] })
    }
    return result
  }, [hostName, query.data?.items])

  const truncated = (query.data?.total ?? 0) > (query.data?.items.length ?? 0)

  return (
    <Dialog
      open={open}
      title="Hoạt động gần đây"
      description={`${hostName} · nhật ký hệ thống của máy này`}
      onClose={onClose}
    >
      <div className="machine-activity">
        <DateRangePicker
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
        />
        {query.isLoading ? <StateView title="Đang tải nhật ký…" /> : null}
        {query.isError ? (
          <InlineAlert tone="warning">
            Không tải được nhật ký: {(query.error as Error).message}
          </InlineAlert>
        ) : null}
        {!query.isLoading && !query.isError && days.length === 0 ? (
          <StateView title="Không có hoạt động" description="Máy này không có sự kiện trong khoảng ngày đã chọn." />
        ) : null}
        {days.map((day) => (
          <section key={day.key} className="machine-activity__day">
            <h3>{day.title}</h3>
            {day.cards.map((card) => (
              <article key={card.key} className={`machine-activity__card machine-activity__card--${card.tone}`}>
                <header>
                  <strong>
                    {card.events.length > 1
                      ? `${clock(card.startMs)} – ${clock(card.endMs)}`
                      : clock(card.startMs)}
                  </strong>
                  <small>{card.events.length} sự kiện</small>
                </header>
                <EventTimeline events={card.events} />
              </article>
            ))}
          </section>
        ))}
        {truncated ? (
          <small className="machine-activity__note">
            Chỉ hiển thị {query.data?.items.length} sự kiện mới nhất — thu hẹp khoảng ngày để xem đủ.
          </small>
        ) : null}
      </div>
    </Dialog>
  )
}
