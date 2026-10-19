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

/** Quyền mới của task OB (define.h, cạnh R_REMOTE_MACHINE 9415) — PLAN_ONLINE_BOOKING.md §3.0. */
export const OB_RIGHTS = {
  APPROVE: 9416,
  CANCEL: 9417,
} as const

export const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: 'Đang xử lý',
  wait_approval: 'Chờ duyệt',
  confirmed: 'Đã xác nhận — chờ khách đến',
  in_use: 'Khách đang dùng',
  done: 'Đã dùng xong',
  no_show: 'Khách không đến',
  cancelled: 'Đã huỷ',
  rejected: 'Bị từ chối / hết hạn duyệt',
}

export const STATUS_TONE: Record<BookingStatus, StatusTone> = {
  pending: 'neutral',
  wait_approval: 'warning',
  confirmed: 'info',
  in_use: 'success',
  done: 'neutral',
  no_show: 'danger',
  cancelled: 'neutral',
  rejected: 'danger',
}

export const PC_STATE_LABEL: Record<PcState, string> = {
  off: 'Tắt',
  on_idle: 'Bật — chờ đăng nhập',
  in_use: 'Đang chơi',
  unknown: 'Không rõ',
}

export const PC_STATE_TONE: Record<PcState, StatusTone> = {
  off: 'success',
  on_idle: 'warning',
  in_use: 'danger',
  unknown: 'neutral',
}

export const CHANNEL_LABEL: Record<BookingChannel, string> = {
  fzone: 'FZone (hội viên tự đặt)',
  staff: 'Thu ngân đặt hộ',
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
  BAD_HOURS: 'Số giờ đặt không hợp lệ.',
  OUTSIDE_WINDOW: 'Ngoài khung giờ cho phép đặt.',
  NOT_BOOKABLE: 'Máy này hiện không thể đặt online.',
  MACHINE_NOT_OFF: 'Máy đang bật — chỉ đặt được máy đang tắt.',
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

/** OB-R2: nhãn cách trả tiền (đơn cũ/đặt hộ không có field ⇒ Ví). */
export const PAY_METHOD_LABEL: Record<PayMethod, string> = {
  wallet: 'Ví',
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
  { value: '', label: 'Tất cả trạng thái' },
  { value: 'wait_approval', label: STATUS_LABEL.wait_approval },
  { value: 'confirmed', label: STATUS_LABEL.confirmed },
  { value: 'in_use', label: STATUS_LABEL.in_use },
  { value: 'done', label: STATUS_LABEL.done },
  { value: 'no_show', label: STATUS_LABEL.no_show },
  { value: 'cancelled', label: STATUS_LABEL.cancelled },
  { value: 'rejected', label: STATUS_LABEL.rejected },
]

export const CHANNEL_FILTER_OPTIONS: Array<{ value: BookingChannel | ''; label: string }> = [
  { value: '', label: 'Tất cả kênh' },
  { value: 'fzone', label: CHANNEL_LABEL.fzone },
  { value: 'staff', label: CHANNEL_LABEL.staff },
]
