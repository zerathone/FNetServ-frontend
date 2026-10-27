import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { BoardResponse, Booking, BookingStatus } from '../../api/onlineBooking'
import { Segmented, StateView } from '../../design-system/components'
import { PendingBookingActions } from './PendingBookingActions'
import {
  describeBookingError,
  formatBookingRange,
  describeChannel,
  matchesScheduleFilter,
  SCHEDULE_RANGE_OPTIONS,
  SCHEDULE_STATUS_OPTIONS,
  SCHEDULE_STATUS_SHORT,
  scheduleRangeDates,
  STATUS_LABEL,
  type ScheduleRange,
  type ScheduleStatusFilter,
} from './onlineBookingModel'
import {
  BOOKING_TONE,
  DETAIL_HINT,
  fetchScheduleBookings,
  groupMachines,
  MAX_PAGES,
  PAGE_LIMIT,
  SCHEDULE_LEGEND,
  type MachineGroupRow,
  type ScheduleTone,
} from './scheduleData'

/** Màu thẻ máy theo đơn "nặng" nhất: chờ duyệt > đã duyệt/đang dùng > đã xong/không đến > huỷ/từ chối. */
function cardTone(bookings: Booking[]): ScheduleTone {
  if (bookings.length === 0) return 'free'
  const has = (...statuses: BookingStatus[]) => bookings.some((b) => statuses.includes(b.status))
  if (has('pending', 'wait_approval')) return 'pending'
  if (has('confirmed', 'in_use')) return 'active'
  if (has('done', 'no_show')) return 'past'
  return 'closed'
}

function formatSlotTime(booking: Booking, withDay: boolean): string {
  const parts = formatBookingRange(booking.from, booking.to)
  if (!parts) return '—'
  const day = withDay ? `${parts.fromDay} ` : ''
  return parts.toDay ? `${day}${parts.fromTime} → ${parts.toDay} ${parts.toTime}` : `${day}${parts.fromTime}–${parts.toTime}`
}

function formatRangeLabel(fromDate: string, toDate: string): string {
  const short = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
  return fromDate === toDate ? `${short(fromDate)}/${fromDate.slice(0, 4)}` : `${short(fromDate)} – ${short(toDate)}/${toDate.slice(0, 4)}`
}

/** Dòng mờ dưới nút: một ngày = dd/mm/yyyy; một tuần = dd/mm - dd/mm (đầu tuần - cuối tuần). */
function rangeSublabel(range: ScheduleRange): string {
  const { fromDate, toDate } = scheduleRangeDates(range)
  const dm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`
  return fromDate === toDate ? `${dm(fromDate)}/${fromDate.slice(0, 4)}` : `${dm(fromDate)} - ${dm(toDate)}`
}

type BookingActionProps = {
  canApprove: boolean
  onApprove: (booking: Booking) => void
  onReject: (booking: Booking) => void
  onDetail: (booking: Booking) => void
}

function MapGroups({
  groups,
  emptyLabel,
  multiDay,
  canApprove,
  onApprove,
  onReject,
  onDetail,
}: { groups: MachineGroupRow[]; emptyLabel: string; multiDay: boolean } & BookingActionProps) {
  return (
    <>
      {groups.map((group) => (
        <div key={group.name} className="ob-map__row">
          <div className="ob-map__group">{group.name}</div>
          <div className="ob-map__cards">
            {group.machines.map((machine) => {
              const tone = cardTone(machine.bookings)
              return (
                <div key={machine.pc} className={`ob-map__card ob-map__card--${tone}`}>
                  <strong className="ob-map__pc">{machine.pc}</strong>
                  {machine.bookings.length === 0 ? (
                    <span className="ob-map__empty">{emptyLabel}</span>
                  ) : (
                    machine.bookings.map((booking) => {
                      const bookingTone = BOOKING_TONE[booking.status]
                      return (
                        <div
                          key={booking.bookId}
                          className={`ob-map__booking ob-map__booking--${bookingTone}`}
                          title={describeChannel(booking)}
                        >
                          <div className="ob-map__booking-head">
                            <span className="ob-map__booking-time">{formatSlotTime(booking, multiDay)}</span>
                            <span className="ob-map__booking-code">#{booking.bookCode}</span>
                          </div>
                          <div className="ob-map__booking-foot">
                            <span className="ob-map__booking-user">{booking.member.username}</span>
                            <span className="ob-map__booking-status" title={STATUS_LABEL[booking.status]}>
                              <i className="ob-map__dot" aria-hidden="true" />
                              {SCHEDULE_STATUS_SHORT[booking.status]}
                            </span>
                          </div>
                          {booking.status === 'wait_approval' || booking.status === 'confirmed' ? (
                            <div className="ob-map__booking-actions">
                              <PendingBookingActions
                                canApprove={canApprove}
                                onDetail={() => onDetail(booking)}
                                onApprove={() => onApprove(booking)}
                                onReject={() => onReject(booking)}
                                showMenu={booking.status === 'wait_approval'}
                                detailTitle={
                                  booking.status === 'wait_approval' ? DETAIL_HINT.wait_approval : DETAIL_HINT.confirmed
                                }
                              />
                            </div>
                          ) : null}
                        </div>
                      )
                    })
                  )}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </>
  )
}

type Props = {
  board: BoardResponse | undefined
  boardLoading: boolean
  /** Chu kỳ tự tải lại danh sách đơn (ms) — cùng nhịp với /board của trang. */
  refetchMs: number
  statusFilter: ScheduleStatusFilter
  onStatusFilterChange: (value: ScheduleStatusFilter) => void
} & BookingActionProps

export function MachineScheduleMap({
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
  const [range, setRange] = useState<ScheduleRange>('today')
  // Tính lại mỗi lần render: qua nửa đêm, "Hôm nay" tự trượt sang ngày mới (khoá query đổi theo).
  const { fromDate, toDate } = scheduleRangeDates(range)
  const multiDay = fromDate !== toDate
  const rangeOptions = SCHEDULE_RANGE_OPTIONS.map((option) => ({ ...option, sublabel: rangeSublabel(option.value) }))

  const scheduleQuery = useQuery({
    queryKey: ['onlinebook-schedule', fromDate, toDate],
    queryFn: () => fetchScheduleBookings(fromDate, toDate),
    refetchInterval: refetchMs,
  })

  const visible = useMemo(
    () => (scheduleQuery.data?.items ?? []).filter((b) => matchesScheduleFilter(b.status, statusFilter)),
    [scheduleQuery.data, statusFilter],
  )
  const groups = useMemo(() => groupMachines(board, visible), [board, visible])
  // Bản "Tất cả" (mọi trạng thái) = tập con lớn nhất → chiều cao khung lấy theo bản này.
  const allGroups = useMemo(() => groupMachines(board, scheduleQuery.data?.items ?? []), [board, scheduleQuery.data])
  const emptyLabel = statusFilter === 'closed' ? 'Không có đơn' : 'Trống'

  return (
    <div className="ob-map">
      <div className="ob-map__controls">
        <Segmented value={range} options={rangeOptions} onChange={setRange} ariaLabel="Khoảng thời gian xem lịch hẹn theo máy" />
        <Segmented
          value={statusFilter}
          options={SCHEDULE_STATUS_OPTIONS}
          onChange={onStatusFilterChange}
          ariaLabel="Lọc đơn theo trạng thái"
        />
      </div>

      <div className="ob-map__summary">
        <strong>{formatRangeLabel(fromDate, toDate)}</strong>
        <span>{scheduleQuery.isSuccess ? `${visible.length} đơn` : ''}</span>
        <ul className="ob-map__legend" aria-label="Chú giải màu">
          {SCHEDULE_LEGEND.map((item) => (
            <li key={item.tone}>
              <i className={`ob-map__dot ob-map__dot--${item.tone}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
      </div>

      {scheduleQuery.isError ? (
        <StateView title="Không tải được đơn đặt máy" description={describeBookingError(scheduleQuery.error)} />
      ) : scheduleQuery.isLoading || boardLoading ? (
        <StateView title="Đang tải lịch hẹn theo máy…" />
      ) : allGroups.length === 0 ? (
        <p className="order-empty-compact">Chưa có máy nào để hiển thị.</p>
      ) : (
        <>
          {scheduleQuery.data?.truncated ? (
            <p className="ob-table__sub">Có quá nhiều đơn trong khoảng này — chỉ hiện {MAX_PAGES * PAGE_LIMIT} đơn đầu tiên.</p>
          ) : null}
          {/* Khung cố định: lớp ẩn dựng sẵn bản "Tất cả" (nhiều nhất) cùng ô lưới với lớp hiện, nên chiều cao luôn bằng bản cao nhất — đổi bộ lọc không làm trang giật. */}
          <div className="ob-map__stack">
            {statusFilter !== 'all' ? (
              <div className="ob-map__layer ob-map__layer--ghost" aria-hidden="true">
                <MapGroups
                  groups={allGroups}
                  emptyLabel="Trống"
                  multiDay={multiDay}
                  canApprove={canApprove}
                  onApprove={onApprove}
                  onReject={onReject}
                  onDetail={onDetail}
                />
              </div>
            ) : null}
            <div className="ob-map__layer">
              <MapGroups
                groups={groups}
                emptyLabel={emptyLabel}
                multiDay={multiDay}
                canApprove={canApprove}
                onApprove={onApprove}
                onReject={onReject}
                onDetail={onDetail}
              />
            </div>
          </div>
        </>
      )}
    </div>
  )
}
