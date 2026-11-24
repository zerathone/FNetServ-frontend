// Drawer chi tiết thẻ combo — logic THUẦN (test: tests/combo-card-detail-model.test.ts).
// Dữ liệu từ GET /users/combo-card; quy ước loại combo / ngày áp dụng lấy từ server (DAOCombo::ComboType, WEEKDAY).
import type { ComboCardDetail } from '../../api/users'
import { formatDmy, normalizeHm } from './comboCardModel.ts' // đuôi .ts: để `node --test` chạy được file này

export type ComboKind = {
  kind: 'fixed-window' | 'duration' | 'unknown'
  /** Tên loại hiển thị. */
  label: string
}

/** Loại combo: 1 = khung giờ cố định trong ngày, 2 = theo thời lượng kể từ lần đăng nhập đầu. */
export function describeComboKind(detail: Pick<ComboCardDetail, 'comboType'>): ComboKind {
  if (detail.comboType === 1) return { kind: 'fixed-window', label: 'Khung giờ cố định' }
  if (detail.comboType === 2) return { kind: 'duration', label: 'Theo thời lượng' }
  return { kind: 'unknown', label: 'Không xác định' }
}

export type CardOrigin =
  | { kind: 'counter'; label: string }
  | { kind: 'member'; label: string; ownerName: string }

/** Thẻ của hội viên nào: `ownerId > 0` = hội viên mua từ máy trạm; 0 = thẻ bán tại quầy (không có chủ). */
export function describeOrigin(detail: Pick<ComboCardDetail, 'ownerId' | 'ownerName'>): CardOrigin {
  if (detail.ownerId > 0) {
    const ownerName = detail.ownerName.trim() || `#${detail.ownerId}`
    return { kind: 'member', label: 'Hội viên mua', ownerName }
  }
  return { kind: 'counter', label: 'Bán tại quầy' }
}

const WEEKDAY_BITS: ReadonlyArray<{ bit: number; label: string }> = [
  { bit: 2, label: 'T2' },
  { bit: 4, label: 'T3' },
  { bit: 8, label: 'T4' },
  { bit: 16, label: 'T5' },
  { bit: 32, label: 'T6' },
  { bit: 64, label: 'T7' },
  { bit: 1, label: 'CN' },
]

/** Bitmask → danh sách thứ. 127 (đủ 7 ngày) ⇒ `all`; 0 (không đặt) cũng coi là mọi ngày như server. */
export function describeWeekdays(mask: number): { all: boolean; days: string[]; text: string } {
  const value = Number.isFinite(mask) ? mask & 127 : 127
  if (value === 0 || value === 127) return { all: true, days: WEEKDAY_BITS.map((d) => d.label), text: 'Tất cả các ngày' }
  const days = WEEKDAY_BITS.filter((d) => (value & d.bit) !== 0).map((d) => d.label)
  return { all: false, days, text: days.join(', ') }
}

/** Phút → "3 giờ 05 phút" / "45 phút" / "0 phút". */
export function formatRemain(minutes: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(minutes) ? minutes : 0))
  const hours = Math.floor(total / 60)
  const rest = total % 60
  if (hours === 0) return `${rest} phút`
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${String(rest).padStart(2, '0')} phút`
}

export type CardStatus = {
  tone: 'success' | 'warning' | 'danger' | 'neutral'
  label: string
}

function edgeTime(date: string, time: string, fallbackTime: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim())
  if (!match) return null
  const hm = /^(\d{2}):(\d{2})$/.exec(normalizeHm(time)) ?? /^(\d{2}):(\d{2})$/.exec(fallbackTime)
  const hours = hm ? Number(hm[1]) : 0
  const minutes = hm ? Number(hm[2]) : 0
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), hours, minutes).getTime()
}

/** Đã quá mốc kết thúc (`toDate toTime`; thiếu giờ ⇒ hết ngày đó)? Thiếu ngày kết thúc ⇒ false. */
export function isPastExpiry(detail: Pick<ComboCardDetail, 'toDate' | 'toTime'>, now: Date = new Date()): boolean {
  const end = edgeTime(detail.toDate, detail.toTime, '23:59')
  return end !== null && now.getTime() > end
}

/**
 * Trạng thái thẻ tại thời điểm `now`:
 *  - tài khoản bị khóa ⇒ "Đã khóa";
 *  - quá hạn (`toDate toTime`) ⇒ "Hết hạn"; thẻ theo thời lượng đã dùng mà hết giờ ⇒ "Hết giờ";
 *  - thẻ theo thời lượng chưa đăng nhập lần nào ⇒ "Chưa sử dụng"; chưa đến ngày bắt đầu ⇒ "Chưa đến hạn";
 *  - còn lại ⇒ "Còn hiệu lực".
 */
export function describeCardStatus(detail: ComboCardDetail, now: Date = new Date()): CardStatus {
  if (!detail.active) return { tone: 'neutral', label: 'Đã khóa' }

  const nowMs = now.getTime()
  if (isPastExpiry(detail, now)) return { tone: 'danger', label: 'Hết hạn' }

  if (detail.comboType === 2) {
    if (!detail.firstLoginAt) return { tone: 'warning', label: 'Chưa sử dụng' }
    if (detail.remainMinutes <= 0) return { tone: 'danger', label: 'Hết giờ' }
    return { tone: 'success', label: 'Còn hiệu lực' }
  }

  const start = edgeTime(detail.fromDate, detail.fromTime, '00:00')
  if (start !== null && nowMs < start) return { tone: 'warning', label: 'Chưa đến hạn' }
  return { tone: 'success', label: 'Còn hiệu lực' }
}

/**
 * Số ngày (theo lịch, giờ địa phương) từ hôm nay đến `date` (YYYY-MM-DD): 0 = hôm nay, âm = đã qua.
 * Rỗng/không đúng dạng ⇒ null.
 */
export function daysUntil(date: string | undefined | null, now: Date = new Date()): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec((date ?? '').trim())
  if (!match || match[1] === '0000') return null
  const target = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.round((target - today) / 86_400_000)
}

/** Phần trăm thời lượng còn lại (0..100) của thẻ theo thời lượng; thiếu dữ liệu ⇒ null. */
export function remainingPercent(detail: Pick<ComboCardDetail, 'duration' | 'remainMinutes' | 'firstLoginAt'>): number | null {
  if (!detail.firstLoginAt || detail.duration <= 0) return null
  const total = detail.duration * 60
  return Math.max(0, Math.min(100, Math.round((detail.remainMinutes / total) * 100)))
}

/** "2026-11-24 09:30:15" → "24/11/2026 09:30"; rỗng/không đúng dạng ⇒ ''. */
export function formatTimestamp(value: string | undefined | null): string {
  const match = /^(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})/.exec((value ?? '').trim())
  return match ? formatDateTime(match[1], match[2]) : formatDateTime((value ?? '').trim().slice(0, 10), '')
}

/** "dd/MM/yyyy HH:mm" cho ngày + giờ; thiếu ngày ⇒ ''. */
export function formatDateTime(date: string, time: string): string {
  const day = formatDmy(date)
  if (!day) return ''
  const hm = normalizeHm(time)
  return hm ? `${day} ${hm}` : day
}
