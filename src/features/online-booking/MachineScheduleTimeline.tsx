import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Desktop, WarningOctagon } from '@phosphor-icons/react'
import { getBookingWorkstationsRuntime, type BoardResponse, type Booking, type PcState } from '../../api/onlineBooking'
import { PendingBookingActions } from './PendingBookingActions'
import { Button, Segmented, StateView } from '../../design-system/components'
import {
  describeChannel,
  describeBookingError,
  formatTimeRange,
  matchesScheduleFilter,
  SCHEDULE_STATUS_OPTIONS,
  SCHEDULE_STATUS_SHORT,
  STATUS_LABEL,
  toYMD,
  type ScheduleStatusFilter,
} from './onlineBookingModel'
import {
  BOOKING_TONE,
  bookingAttention,
  DEFAULT_LOCK_WINDOW_MIN,
  DETAIL_HINT,
  fetchScheduleBookings,
  groupMachines,
  liveUserOf,
  MAX_PAGES,
  PAGE_LIMIT,
  SCHEDULE_LEGEND,
  SCHEDULE_PC_STATE_SHORT,
  type LiveUser,
} from './scheduleData'

// Timeline: trục ngang = thời gian (3 ngày liền: hôm qua, hôm nay, ngày mai), vạch nhỏ nhất 30 phút.
// Trục dọc = nhóm máy; đơn là thẻ đặt đúng theo giờ, nhiều máy trùng giờ trong một nhóm thì xếp thành nhiều làn.
const DAYS = 3
const SLOTS_PER_DAY = 48
/** Độ rộng một ô 30 phút (px) — phải khớp `--ob-tl-col` trong CSS. */
const SLOT_PX = 56
const PX_PER_MIN = SLOT_PX / 30
const DAY_PX = SLOTS_PER_DAY * SLOT_PX
const TOTAL_PX = DAYS * DAY_PX
const LANE_HEIGHT = 44
const LANE_GAP = 4
/** Khi mở / bấm "Về hiện tại": giờ hiện tại nằm ở khoảng này của bề rộng vùng giờ nhìn thấy (tính từ trái). */
const NOW_ANCHOR = 0.35
const DAY_LABELS = ['Hôm qua', 'Hôm nay', 'Ngày mai']
/** Thẻ đơn chờ duyệt rộng dưới mức này (px) không đủ chỗ cho split button → nút chỉ hiện khi rê chuột / focus. */
const ACTIONS_INLINE_MIN_PX = 220

type Placed = { booking: Booking; lane: number; left: number; width: number }

/** Xếp đơn của một nhóm vào các làn: đơn vào làn đầu tiên đã trống tại giờ bắt đầu của nó. */
function layoutGroup(bookings: Booking[], startMs: number, endMs: number): { placed: Placed[]; lanes: number } {
  const items = bookings
    .map((booking) => ({ booking, from: Date.parse(booking.from), to: Date.parse(booking.to) }))
    .filter((item) => Number.isFinite(item.from) && Number.isFinite(item.to) && item.to > startMs && item.from < endMs)
    .sort((a, b) => a.from - b.from)

  const laneEnds: number[] = []
  const placed = items.map((item) => {
    let lane = laneEnds.findIndex((end) => end <= item.from)
    if (lane < 0) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = item.to
    const left = ((Math.max(item.from, startMs) - startMs) / 60_000) * PX_PER_MIN
    const right = ((Math.min(item.to, endMs) - startMs) / 60_000) * PX_PER_MIN
    return { booking: item.booking, lane, left, width: Math.max(right - left, 8) }
  })
  return { placed, lanes: Math.max(1, laneEnds.length) }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/** Trạng thái máy TẠI THỜI ĐIỂM XEM, chỉ gắn cho đơn đang diễn ra hoặc sắp tới trong hôm nay. */
type CardLive = { pcState: PcState; user: LiveUser | null; warning: string | null }

function bookingTooltip(booking: Booking, live: CardLive | null): string {
  const lines = [
    `${booking.pc} · #${booking.bookCode}`,
    booking.member.username,
    formatTimeRange(booking.from, booking.to),
    `${STATUS_LABEL[booking.status]} · ${describeChannel(booking)}`,
  ]
  if (live) {
    lines.push(`Máy: ${SCHEDULE_PC_STATE_SHORT[live.pcState]}${live.user ? ` — ${live.user.label}` : ''}`)
    if (live.warning) lines.push(`⚠ ${live.warning}`)
  }
  return lines.join('\n')
}

type Props = {
  board: BoardResponse | undefined
  boardLoading: boolean
  /** Chu kỳ tự tải lại danh sách đơn (ms) — cùng nhịp với /board của trang. */
  refetchMs: number
  statusFilter: ScheduleStatusFilter
  onStatusFilterChange: (value: ScheduleStatusFilter) => void
  /** Thao tác trên đơn chờ duyệt — workspace mở hộp xác nhận / nhảy tới dòng đơn trong danh sách. */
  canApprove: boolean
  onApprove: (booking: Booking) => void
  onReject: (booking: Booking) => void
  onDetail: (booking: Booking) => void
}

export function MachineScheduleTimeline({
  board,
  boardLoading,
  refetchMs,
  statusFilter,
  onStatusFilterChange,
  canApprove,
  onApprove,
  onReject,
  onDetail,
}: Props) {
  const [now, setNow] = useState(() => Date.now())
  const [dragging, setDragging] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null)
  const didInitialScroll = useRef(false)

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  // Dải 3 ngày dựng lại theo "hôm nay": qua nửa đêm tự trượt sang ngày mới.
  const today = new Date(now)
  const y = today.getFullYear()
  const m = today.getMonth()
  const d = today.getDate()
  const stripStart = new Date(y, m, d - 1).getTime()
  const stripEnd = new Date(y, m, d + 2).getTime()
  const days = Array.from({ length: DAYS }, (_, i) => new Date(y, m, d - 1 + i))
  // Lấy thêm 1 ngày trước dải: đơn qua đêm bắt đầu từ trước 00:00 hôm qua vẫn phải hiện phần đuôi.
  const fromDate = toYMD(new Date(y, m, d - 2))
  const toDate = toYMD(new Date(y, m, d + 1))
  const nowPx = ((now - stripStart) / 60_000) * PX_PER_MIN

  const scheduleQuery = useQuery({
    queryKey: ['onlinebook-schedule', fromDate, toDate],
    queryFn: () => fetchScheduleBookings(fromDate, toDate),
    refetchInterval: refetchMs,
  })

  // Ai đang dùng máy: route riêng /workstations/runtime. Không có quyền / lỗi thì bỏ qua (thẻ chỉ không hiện tên người dùng).
  const runtimeQuery = useQuery({
    queryKey: ['onlinebook-ws-runtime'],
    queryFn: getBookingWorkstationsRuntime,
    refetchInterval: refetchMs,
    retry: false,
  })
  const runtimeByPc = useMemo(
    () => new Map((runtimeQuery.data?.items ?? []).map((workstation) => [workstation.hostName.toLowerCase(), workstation])),
    [runtimeQuery.data],
  )
  const pcStateByPc = useMemo(
    () => new Map((board?.machines ?? []).map((machine) => [machine.pc.toLowerCase(), machine.pcState])),
    [board],
  )
  const lockWindowMin = board?.lockWindowMin ?? DEFAULT_LOCK_WINDOW_MIN
  const endOfToday = new Date(y, m, d + 1).getTime()

  const cardLive = (booking: Booking): CardLive | null => {
    const tone = BOOKING_TONE[booking.status]
    if (tone !== 'pending' && tone !== 'active') return null
    if (!(Date.parse(booking.to) > now && Date.parse(booking.from) < endOfToday)) return null
    const key = booking.pc.toLowerCase()
    const pcState = pcStateByPc.get(key) ?? booking.pcState
    const user =
      pcState === 'in_use' ? liveUserOf(runtimeByPc.get(key), runtimeQuery.data?.serverTimeMs ?? now) : null
    return { pcState, user, warning: bookingAttention(booking, pcState, user, lockWindowMin, now) }
  }

  const visible = useMemo(
    () => (scheduleQuery.data?.items ?? []).filter((b) => matchesScheduleFilter(b.status, statusFilter)),
    [scheduleQuery.data, statusFilter],
  )
  // Hàng và chiều cao hàng tính theo MỌI đơn (bản "Tất cả" = nhiều làn nhất); thẻ chỉ vẽ phần đơn đang lọc.
  // Nhờ vậy đổi bộ lọc không làm khung timeline co giãn / giật.
  const rows = useMemo(
    () =>
      groupMachines(board, scheduleQuery.data?.items ?? []).map((group) => {
        const all = group.machines.flatMap((machine) => machine.bookings)
        const frame = layoutGroup(all, stripStart, stripEnd)
        const { placed } = layoutGroup(
          all.filter((booking) => matchesScheduleFilter(booking.status, statusFilter)),
          stripStart,
          stripEnd,
        )
        return { name: group.name, placed, height: LANE_GAP + frame.lanes * (LANE_HEIGHT + LANE_GAP) }
      }),
    [board, scheduleQuery.data, statusFilter, stripStart, stripEnd],
  )

  const scrollToNow = useCallback(
    (smooth: boolean) => {
      const el = scrollRef.current
      if (!el) return
      const labelWidth = el.querySelector<HTMLElement>('.ob-tl__corner')?.offsetWidth ?? 0
      const visibleWidth = el.clientWidth - labelWidth
      el.scrollTo({ left: Math.max(0, nowPx - visibleWidth * NOW_ANCHOR), behavior: smooth ? 'smooth' : 'auto' })
    },
    [nowPx],
  )

  const ready = scheduleQuery.isSuccess && !boardLoading
  // Mở view lần đầu: cuộn tới giờ hiện tại một lần (các lần cập nhật sau không giật vị trí người dùng đang xem).
  useLayoutEffect(() => {
    if (!ready || didInitialScroll.current) return
    didInitialScroll.current = true
    scrollToNow(false)
  }, [ready, scrollToNow])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    if (!el || event.pointerType !== 'mouse' || event.button !== 0) return
    // Bấm nút trên thẻ (duyệt / từ chối / chi tiết) không được biến thành kéo cuộn — capture sẽ nuốt sự kiện click.
    if ((event.target as HTMLElement).closest('button')) return
    dragRef.current = { x: event.clientX, y: event.clientY, left: el.scrollLeft, top: el.scrollTop }
    el.setPointerCapture(event.pointerId)
    setDragging(true)
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const el = scrollRef.current
    const start = dragRef.current
    if (!el || !start) return
    el.scrollLeft = start.left - (event.clientX - start.x)
    el.scrollTop = start.top - (event.clientY - start.y)
  }
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return
    dragRef.current = null
    setDragging(false)
    scrollRef.current?.releasePointerCapture(event.pointerId)
  }

  const nowDate = new Date(now)

  return (
    <div className="ob-map">
      <div className="ob-map__controls">
        <Segmented
          value={statusFilter}
          options={SCHEDULE_STATUS_OPTIONS}
          onChange={onStatusFilterChange}
          ariaLabel="Lọc đơn theo trạng thái"
        />
        <Button type="button" onClick={() => scrollToNow(true)} disabled={!ready}>
          Về hiện tại
        </Button>
      </div>

      <div className="ob-map__summary">
        <span>Kéo ngang để xem ngày trước hoặc ngày sau</span>
        <span>{scheduleQuery.isSuccess ? `${visible.length} đơn` : ''}</span>
        <ul className="ob-map__legend" aria-label="Chú giải màu">
          {SCHEDULE_LEGEND.filter((item) => item.tone !== 'free').map((item) => (
            <li key={item.tone}>
              <i className={`ob-map__dot ob-map__dot--${item.tone}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      {scheduleQuery.isError ? (
        <StateView title="Không tải được đơn đặt máy" description={describeBookingError(scheduleQuery.error)} />
      ) : !ready ? (
        <StateView title="Đang tải lịch hẹn theo thời gian…" />
      ) : rows.length === 0 ? (
        <p className="order-empty-compact">Chưa có máy nào để hiển thị.</p>
      ) : (
        <>
          {scheduleQuery.data?.truncated ? (
            <p className="ob-table__sub">Có quá nhiều đơn trong khoảng này — chỉ hiện {MAX_PAGES * PAGE_LIMIT} đơn đầu tiên.</p>
          ) : null}
          <div
            ref={scrollRef}
            className={`ob-tl${dragging ? ' is-dragging' : ''}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <div className="ob-tl__inner" style={{ width: `calc(var(--ob-tl-label) + ${TOTAL_PX}px)` }}>
              <div className="ob-tl__head">
                <div className="ob-tl__corner">Nhóm máy</div>
                <div className="ob-tl__axis" style={{ width: TOTAL_PX }}>
                  <div className="ob-tl__days">
                    {days.map((day, index) => (
                      <div key={day.getTime()} className="ob-tl__day" style={{ width: DAY_PX }}>
                        <span className="ob-tl__day-label">
                          {DAY_LABELS[index]} · {day.toLocaleDateString('vi-VN', { weekday: 'long' })}{' '}
                          {pad2(day.getDate())}/{pad2(day.getMonth() + 1)}/{day.getFullYear()}
                        </span>
                      </div>
                    ))}
                  </div>
                  <div className="ob-tl__hours">
                    {Array.from({ length: DAYS * 24 }, (_, hour) => (
                      <div key={hour} className="ob-tl__hour" style={{ width: SLOT_PX * 2 }}>
                        {pad2(hour % 24)}:00
                      </div>
                    ))}
                  </div>
                  <span className="ob-tl__now-label" style={{ left: nowPx }}>
                    {pad2(nowDate.getHours())}:{pad2(nowDate.getMinutes())}
                  </span>
                </div>
              </div>

              {rows.map((row) => (
                <div key={row.name} className="ob-tl__row">
                  <div className="ob-tl__group">{row.name}</div>
                  <div className="ob-tl__area" style={{ width: TOTAL_PX, height: row.height }}>
                    {row.placed.map(({ booking, lane, left, width }) => {
                      const live = cardLive(booking)
                      const waiting = booking.status === 'wait_approval'
                      // Đã duyệt mà khách chưa vào máy: chỉ nút "Chi tiết" để nhảy tới đơn rồi đổi máy / huỷ.
                      const hasActions = waiting || booking.status === 'confirmed'
                      return (
                        <div
                          key={booking.bookId}
                          className={`ob-tl__card ob-tl__card--${BOOKING_TONE[booking.status]}${
                            hasActions ? ' ob-tl__card--actions' : ''
                          }${hasActions && width < ACTIONS_INLINE_MIN_PX ? ' is-compact' : ''}`}
                          style={{
                            left: left + 1,
                            top: LANE_GAP + lane * (LANE_HEIGHT + LANE_GAP),
                            width: width - 2,
                            height: LANE_HEIGHT,
                          }}
                          title={bookingTooltip(booking, live)}
                        >
                          {hasActions ? (
                            <div className="ob-tl__acts">
                              <PendingBookingActions
                                canApprove={canApprove}
                                onDetail={() => onDetail(booking)}
                                onApprove={() => onApprove(booking)}
                                onReject={() => onReject(booking)}
                                showMenu={waiting}
                                detailTitle={waiting ? DETAIL_HINT.wait_approval : DETAIL_HINT.confirmed}
                              />
                            </div>
                          ) : null}
                          <div className="ob-tl__card-main">
                            {live?.warning ? (
                              <WarningOctagon className="ob-tl__card-warn" size={14} weight="fill" aria-label="Cảnh báo" />
                            ) : null}
                            <strong className="ob-tl__card-pc">{booking.pc}</strong>
                            {live ? (
                              <span className={`ob-tl__card-live ob-tl__card-live--${live.pcState}`}>
                                <Desktop size={12} weight="fill" aria-hidden="true" />
                                <span className="ob-tl__card-live-text">
                                  {live.user ? live.user.label : SCHEDULE_PC_STATE_SHORT[live.pcState]}
                                </span>
                              </span>
                            ) : null}
                          </div>
                          <div className="ob-tl__card-sub">
                            <span className="ob-tl__card-code">#{booking.bookCode}</span>
                            <span className="ob-tl__card-user">{booking.member.username}</span>
                            <span className="ob-tl__card-status">
                              <i className="ob-map__dot" aria-hidden="true" />
                              {SCHEDULE_STATUS_SHORT[booking.status]}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}

              <div className="ob-tl__now" style={{ left: `calc(var(--ob-tl-label) + ${nowPx}px)` }} aria-hidden="true" />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
