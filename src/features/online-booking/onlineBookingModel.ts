import { ApiError } from '../../api/client'
import type {
  Booking,
  BookingChannel,
  BookingStatus,
  ConfigFieldError,
  FailCode,
  PayMethod,
  PcState,
  SlotSource,
} from '../../api/onlineBooking'
import type { StatusTone } from '../../design-system/components'
import type { StepItem, StepStatus } from '../orders/OrderSteps'

/** Quyền mới của task OB (define.h, cạnh R_REMOTE_MACHINE 9415) — PLAN_ONLINE_BOOKING.md §3.0. */
export const OB_RIGHTS = {
  APPROVE: 9416,
  CANCEL: 9417,
} as const

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Đang xử lý',
  wait_approval: 'Chờ duyệt',
  confirmed: 'Đã duyệt',
  in_use: 'Khách đang dùng',
  done: 'Đã dùng xong',
  no_show: 'Khách không đến',
  cancelled: 'Đã huỷ',
  rejected: 'Bị từ chối / hết hạn duyệt',
}

/**
 * Tiến trình của đơn đặt máy (cột kiểu Steps trên thẻ): Đặt máy -> Duyệt -> Sử dụng. Chỉ theo `status` của ĐƠN,
 * không phụ thuộc máy đang bật hay tắt (`pcState`).
 * Giờ từng bước: tạo đơn = `createdAt`; duyệt = `confirmedAt` (cả duyệt tay lẫn tự duyệt); vào máy = `loginAt`;
 * huỷ = `cancelledAt`. Từ chối / hết hạn duyệt / khách không đến KHÔNG có cột riêng nên dùng `updatedAt` (lần ghi
 * cuối, chỉ gần đúng). Server cũ chưa trả các field mới => bước đó không hiện giờ.
 */
export function bookingSteps(booking: Booking): StepItem[] {
  const ms = (iso: string | null | undefined) => (iso ? Date.parse(iso) || undefined : undefined)
  // Người đặt: đơn đặt hộ = nhân viên đã đặt; đơn FZone = chính hội viên. Người duyệt: chỉ có khi đã có người duyệt.
  const booker = booking.channel === 'staff' && booking.createdBy ? describePerson(booking.createdBy) : booking.member.username
  const approver = booking.approvedBy ? describePerson(booking.approvedBy) : undefined
  const book: StepItem = { label: 'Đặt máy', status: 'done', time: ms(booking.createdAt), person: booker }
  const approve = (status: StepStatus, label = 'Duyệt', time?: number): StepItem => ({
    label,
    status,
    time,
    person: status === 'current' ? undefined : approver,
  })
  const usage = (status: StepStatus, label = 'Sử dụng', time?: number, person?: string): StepItem => ({
    label,
    status,
    time,
    person,
  })
  const confirmed = ms(booking.confirmedAt)
  const login = ms(booking.loginAt)
  switch (booking.status) {
    case 'pending':
    case 'wait_approval':
      return [book, approve('current'), usage('todo')]
    case 'confirmed':
    case 'in_use':
      return [book, approve('done', 'Duyệt', confirmed), usage('current', 'Sử dụng', login)]
    case 'done':
      return [book, approve('done', 'Duyệt', confirmed), usage('done', 'Sử dụng', login)]
    case 'no_show':
      return [book, approve('done', 'Duyệt', confirmed), usage('error', 'Không đến', ms(booking.updatedAt))]
    case 'cancelled':
      // Chỉ huỷ được khi đơn đã duyệt (Confirmed) nên bước Duyệt luôn đã xong.
      // 'none' (hoặc server cũ không trả cancelCredit) = huỷ không hoàn; credited / pending / failed = đã chọn huỷ có hoàn.
      return [
        book,
        approve('done', 'Duyệt', confirmed),
        usage(
          'error',
          booking.cancelCredit && booking.cancelCredit !== 'none' ? 'Huỷ có hoàn' : 'Huỷ không hoàn',
          ms(booking.cancelledAt),
          booking.cancelledBy ? describePerson(booking.cancelledBy) : undefined,
        ),
      ]
    case 'rejected':
      return [
        book,
        approve('error', booking.failCode === 'APPROVAL_TIMEOUT' ? 'Hết hạn' : 'Từ chối', ms(booking.updatedAt)),
        usage('todo'),
      ]
  }
}
export const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  pending: 'neutral',
  wait_approval: 'warning',
  confirmed: 'success',
  in_use: 'info',
  done: 'neutral',
  no_show: 'danger',
  cancelled: 'neutral',
  rejected: 'danger',
}

export const PC_STATE_LABEL: Record<PcState, string> = {
  off: 'Đang tắt',
  on_idle: 'Bật — chờ đăng nhập',
  in_use: 'Đang chơi',
  unknown: 'Không rõ',
}

export const PC_STATE_TONE: Record<PcState, StatusTone> = {
  off: 'neutral',
  on_idle: 'success',
  in_use: 'danger',
  unknown: 'neutral',
}

export const CHANNEL_LABEL: Record<BookingChannel, string> = {
  fzone: 'FZone',
  staff: 'Đặt hộ',
}

export const SLOT_SOURCE_LABEL: Record<SlotSource, string> = {
  online: 'FZone',
  counter: 'Đặt hộ',
  legacy: 'Dữ liệu cũ',
}

/** PLAN_ONLINE_BOOKING.md §3.0 — map `failCode` sang câu tiếng Việt dễ hiểu. */
const FAIL_CODE_LABEL: Record<FailCode, string> = {
  DISABLED: 'Tính năng đặt máy online đang tắt.',
  TOO_SOON: 'Giờ bắt đầu quá sát, chọn giờ muộn hơn.',
  TOO_FAR: 'Giờ bắt đầu quá xa so với hiện tại.',
  // task OB-R8: sàn dưới nay là tham số `min_hours` — câu chính xác do server trả kèm, đây chỉ là câu dự phòng.
  BAD_HOURS: 'Thời lượng đặt không hợp lệ (theo bước 30 phút, trong khoảng cho phép của quán).',
  OUTSIDE_WINDOW: 'Ngoài khung giờ cho phép đặt.',
  NOT_BOOKABLE: 'Máy này hiện không thể đặt online.',
  // task OB-R8: luật này nay có điều kiện (ngưỡng `require_off_within`) — đặt xa hơn ngưỡng thì máy bật vẫn chọn được.
  MACHINE_NOT_OFF: 'Máy đang bật — đặt sát giờ chỉ chọn được máy đang tắt.',
  MACHINE_BUSY: 'Máy đã được đặt trong khung giờ này.',
  BAD_MEMBER: 'Không tìm thấy hội viên phù hợp.',
  MEMBER_HAS_BOOKING: 'Hội viên đang có một đơn đặt máy khác chưa hoàn tất.',
  MEMBER_MISMATCH: 'Tên đăng nhập và số điện thoại không khớp.',
  MEMBER_NO_PHONE: 'Hội viên chưa có số điện thoại trong hồ sơ — cập nhật hồ sơ trước khi đặt hộ.',
  NO_BALANCE: 'Số dư ví của hội viên không đủ.',
  PRICE_CHANGED: 'Giá đã thay đổi so với lúc xem trước, vui lòng xem lại.',
  APPROVAL_TIMEOUT: 'Đơn đã hết hạn chờ duyệt.',
  REJECTED_BY_STAFF: 'Đơn đã bị từ chối.',
  ALREADY_USED: 'Đơn đã được sử dụng, không thể thao tác.',
  BAD_STATUS: 'Trạng thái đơn hiện tại không cho phép thao tác này.',
  BAD_REQUEST: 'Yêu cầu không hợp lệ.',
  INTERNAL: 'Lỗi hệ thống, vui lòng thử lại.',
  TID_USED: 'Giao dịch thanh toán QR này đã được ghi nhận cho việc khác.',
}

/** OB-R2: nhãn cách trả tiền (đơn cũ/đặt hộ không có field ⇒ ví, hiển thị "Cấn trừ" như trang Đơn dịch vụ). */
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  wallet: 'Cấn trừ',
  qr: 'QR',
}

export function payMethodOf(booking: Pick<Booking, 'payMethod'>): PayMethod {
  return booking.payMethod ?? 'wallet'
}

export function describeFailCode(failCode: FailCode | null | undefined): string | null {
  if (!failCode) return null
  return FAIL_CODE_LABEL[failCode] ?? `Lỗi không xác định (${failCode})`
}

type OnlineBookErrorDetails = { failCode?: FailCode; errors?: ConfigFieldError[] }

/** `error.code` chỉ có khi body có field `code` — contract đặt failCode trong `data.failCode`. */
export function getFailCode(error: unknown): FailCode | undefined {
  if (!(error instanceof ApiError)) return undefined
  const details = error.details as OnlineBookErrorDetails | undefined
  return details?.failCode
}

export function getConfigFieldErrors(error: unknown): ConfigFieldError[] | undefined {
  if (!(error instanceof ApiError)) return undefined
  const details = error.details as OnlineBookErrorDetails | undefined
  return details?.errors
}

/** Thông báo lỗi để hiện toast/alert khi thao tác đơn thất bại — ưu tiên failCode, fallback message chung. */
export function describeBookingError(error: unknown): string {
  const failCode = getFailCode(error)
  const byFailCode = describeFailCode(failCode)
  if (byFailCode) return byFailCode
  if (error instanceof ApiError) return error.message
  return 'Không thực hiện được thao tác, vui lòng thử lại.'
}

export function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTimeRange(fromIso: string, toIso: string): string {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return '—'
  const sameDay = from.toDateString() === to.toDateString()
  const timeFmt = (d: Date) => d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
  const dateFmt = (d: Date) => d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  return sameDay
    ? `${timeFmt(from)}–${timeFmt(to)} ${dateFmt(from)}`
    : `${timeFmt(from)} ${dateFmt(from)} → ${timeFmt(to)} ${dateFmt(to)}`
}

/**
 * Thời gian đặt trên thẻ đơn: cùng ngày `dd-mm hh:mm → hh:mm`, qua ngày `dd-mm hh:mm → dd-mm hh:mm`.
 * (Bảng "Lịch theo máy" vẫn dùng formatTimeRange.)
 */
export type BookingRangeParts = {
  fromDay: string
  fromTime: string
  /** null = cùng ngày với `fromDay` (không in lại ngày ở đầu kết thúc) */
  toDay: string | null
  toTime: string
}

/** Tách riêng phần ngày (dd-mm, UI hiển thị mờ) và phần giờ để định dạng từng phần. Null khi thời gian không hợp lệ. */
export function formatBookingRange(fromIso: string, toIso: string): BookingRangeParts | null {
  const from = new Date(fromIso)
  const to = new Date(toIso)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return null
  const pad = (n: number) => String(n).padStart(2, '0')
  const dayOf = (d: Date) => `${pad(d.getDate())}-${pad(d.getMonth() + 1)}`
  const timeOf = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
  return {
    fromDay: dayOf(from),
    fromTime: timeOf(from),
    toDay: from.toDateString() === to.toDateString() ? null : dayOf(to),
    toTime: timeOf(to),
  }
}

/** Đếm ngược tới `approvalDeadline` — `null` khi đã hết hạn (hiển thị "Đã hết hạn"). */
export function formatCountdown(deadlineIso: string | null, nowMs: number): { label: string; expired: boolean } {
  if (!deadlineIso) return { label: '—', expired: false }
  const deadline = new Date(deadlineIso).getTime()
  const remainMs = deadline - nowMs
  if (remainMs <= 0) return { label: 'Đã hết hạn', expired: true }
  const totalSec = Math.floor(remainMs / 1000)
  const min = Math.floor(totalSec / 60)
  const sec = totalSec % 60
  return { label: `${min}:${String(sec).padStart(2, '0')}`, expired: false }
}

export function describePerson(person: Booking['createdBy']): string {
  if (!person) return '—'
  return person.name || `NV #${person.staffId}`
}

export const STATUS_FILTER_OPTIONS: Array<{ value: BookingStatus | ''; label: string }> = [
  { value: '', label: 'Tất cả' },
  { value: 'wait_approval', label: STATUS_LABEL.wait_approval },
  { value: 'confirmed', label: STATUS_LABEL.confirmed },
  { value: 'in_use', label: STATUS_LABEL.in_use },
  { value: 'done', label: STATUS_LABEL.done },
  { value: 'no_show', label: STATUS_LABEL.no_show },
  { value: 'cancelled', label: STATUS_LABEL.cancelled },
  { value: 'rejected', label: STATUS_LABEL.rejected },
]

export const CHANNEL_FILTER_OPTIONS: Array<{ value: BookingChannel | ''; label: string }> = [
  { value: '', label: 'Tất cả' },
  { value: 'fzone', label: CHANNEL_LABEL.fzone },
  { value: 'staff', label: CHANNEL_LABEL.staff },
]

/** Nhãn thời lượng (user chốt): chẵn giờ ghi "giờ", có phút lẻ thì viết tắt g/ph — 30 → "30ph", 60 → "1 giờ", 90 → "1g 30ph". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m}ph`
  return m === 0 ? `${h} giờ` : `${h}g ${m}ph`
}

/**
 * Các mức thời lượng chọn nhanh: từ `minMinutes` đến `maxMinutes`, mỗi bước `stepMin` (vd 60, 90 … 360).
 * task OB-R8: `minMinutes` = `min_hours * 60` của quán; bỏ trống thì bắt đầu từ `stepMin` như trước.
 */
export function durationOptions(maxMinutes: number, stepMin: number, minMinutes = stepMin): number[] {
  const options: number[] = []
  // Mốc đầu phải là bội của `stepMin` để mọi lựa chọn đều hợp luật bước 30 phút.
  const first = Math.max(stepMin, Math.ceil(minMinutes / stepMin) * stepMin)
  for (let minutes = first; minutes <= maxMinutes; minutes += stepMin) options.push(minutes)
  return options
}

// ===== Sơ đồ lịch theo máy (view "Sơ đồ" của mục Lịch theo máy) =====

/** Khoảng thời gian xem trên sơ đồ. Tuần tính Thứ Hai → Chủ Nhật. */
export type ScheduleRange = 'today' | 'yesterday' | 'tomorrow' | 'thisWeek' | 'nextWeek' | 'lastWeek'

/** Thứ tự hiện: ngày (hôm qua → ngày mai) | tuần (trước → sau). dividerBefore = vạch ngăn giữa nhóm ngày và nhóm tuần. */
export const SCHEDULE_RANGE_OPTIONS: Array<{ value: ScheduleRange; label: string; dividerBefore?: boolean }> = [
  { value: 'yesterday', label: 'Hôm qua' },
  { value: 'today', label: 'Hôm nay' },
  { value: 'tomorrow', label: 'Ngày mai' },
  { value: 'lastWeek', label: 'Tuần trước', dividerBefore: true },
  { value: 'thisWeek', label: 'Tuần này' },
  { value: 'nextWeek', label: 'Tuần sau' },
]

/** Bộ lọc trạng thái đơn trên sơ đồ: đã duyệt (đơn còn hiệu lực + đã xong/không đến), huỷ/từ chối, tất cả. */
export type ScheduleStatusFilter = 'approved' | 'closed' | 'all'

export const SCHEDULE_STATUS_OPTIONS: Array<{ value: ScheduleStatusFilter; label: string; title: string }> = [
  {
    value: 'approved',
    label: 'Đã duyệt',
    title: 'Đơn chờ duyệt, đã duyệt, khách đang dùng, đã dùng xong và khách không đến',
  },
  { value: 'closed', label: 'Huỷ / từ chối', title: 'Đơn đã huỷ, bị từ chối hoặc hết hạn duyệt' },
  { value: 'all', label: 'Tất cả', title: 'Mọi đơn trong khoảng thời gian đang xem' },
]

const CLOSED_STATUSES: ReadonlySet<BookingStatus> = new Set<BookingStatus>(['cancelled', 'rejected'])

export function matchesScheduleFilter(status: BookingStatus, filter: ScheduleStatusFilter): boolean {
  if (filter === 'all') return true
  return filter === 'closed' ? CLOSED_STATUSES.has(status) : !CLOSED_STATUSES.has(status)
}

/** YYYY-MM-DD theo giờ máy (cùng định dạng `fromDate/toDate` của /onlinebook/list). */
export function toYMD(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Đổi khoảng đang chọn thành [fromDate, toDate] (gồm cả hai đầu). */
export function scheduleRangeDates(range: ScheduleRange, now: Date = new Date()): { fromDate: string; toDate: string } {
  // Dựng Date từ (năm, tháng, ngày + n) để cộng ngày đúng cả khi qua tháng / đổi giờ.
  const day = (offset: number) => toYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset))
  const sinceMonday = (now.getDay() + 6) % 7
  switch (range) {
    case 'today':
      return { fromDate: day(0), toDate: day(0) }
    case 'yesterday':
      return { fromDate: day(-1), toDate: day(-1) }
    case 'tomorrow':
      return { fromDate: day(1), toDate: day(1) }
    case 'thisWeek':
      return { fromDate: day(-sinceMonday), toDate: day(-sinceMonday + 6) }
    case 'nextWeek':
      return { fromDate: day(-sinceMonday + 7), toDate: day(-sinceMonday + 13) }
    case 'lastWeek':
      return { fromDate: day(-sinceMonday - 7), toDate: day(-sinceMonday - 1) }
  }
}

/** Nhãn ngắn cho badge trên thẻ máy (thẻ hẹp); nhãn đầy đủ vẫn là STATUS_LABEL, hiện ở tooltip. */
export const SCHEDULE_STATUS_SHORT: Record<BookingStatus, string> = {
  pending: 'Đang xử lý',
  wait_approval: 'Chờ duyệt',
  confirmed: 'Đã duyệt',
  in_use: 'Đang dùng',
  done: 'Đã xong',
  no_show: 'Không đến',
  cancelled: 'Đã huỷ',
  rejected: 'Từ chối',
}
/** Kênh của đơn kèm người đặt: đơn đặt hộ → "Đặt hộ → <nhân viên>", đơn khách tự đặt → "FZone". */
export function describeChannel(booking: Pick<Booking, 'channel' | 'createdBy'>): string {
  return booking.channel === 'staff' && booking.createdBy
    ? `${CHANNEL_LABEL.staff} → ${describePerson(booking.createdBy)}`
    : CHANNEL_LABEL[booking.channel]
}