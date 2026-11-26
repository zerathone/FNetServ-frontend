// task settings-opts — luật thuần (không React) cho 7 khối thiết lập bổ sung: miền giá trị + kiểm tra phía trình duyệt.
// Máy chủ vẫn kiểm cứng lại mọi thứ; ở đây chỉ để báo lỗi sớm, cùng luật với `FNetHttp/SettingsOpsHandlers.cpp`.

import type { BackupScheduleType } from '../../api/settings'

/** Hoàn tiền: số phút nguyên 5..1440 (máy chủ từ chối ngoài miền; giá trị cũ ngoài miền chỉ được cảnh báo, không tự kẹp). */
export const REFUND_MIN_MINUTES = 5
export const REFUND_MAX_MINUTES = 1440

/** Ngưỡng treo máy trạm: 0 (tắt) hoặc 3..60 phút. Mặc định máy chủ là 3. */
export const PAUSED_RESET_MIN_MINUTES = 3
export const PAUSED_RESET_MAX_MINUTES = 60

/**
 * Bản máy trạm hiện tại khóa cứng hub web (`kAllowHubWeb = false` ở ClientSide/MainDlg.cpp) ⇒ bật cờ `hubWeb` chưa có
 * tác dụng. Lật về `false` khi bản máy trạm mở khóa để cảnh báo biến mất.
 */
export const HUB_WEB_CLIENT_LOCKED = true

/** Dòng nhắc cố định dưới mỗi điều khiển ảnh hưởng máy trạm: không có đẩy realtime, máy trạm tự nhận lại cấu hình. */
export const CLIENT_APPLY_NOTE = 'Áp dụng khi máy trạm nhận lại cấu hình (khi kết nối lại hoặc khi máy về trạng thái chờ).'

export const BACKUP_TYPE_OPTIONS: ReadonlyArray<{ value: `${BackupScheduleType}`; label: string; title: string }> = [
  { value: '0', label: 'Tắt', title: 'Không sao lưu tự động' },
  { value: '1', label: 'Mỗi giờ', title: 'Sao lưu vào một phút cố định của mỗi giờ' },
  { value: '2', label: 'Mỗi ngày', title: 'Sao lưu vào một giờ cố định mỗi ngày' },
  { value: '3', label: 'Mỗi tuần', title: 'Sao lưu vào một thứ và giờ cố định mỗi tuần' },
]

/** Thứ thật 0..6 = Chủ nhật..Thứ bảy (đúng chỉ số `day` của REST). */
export const WEEKDAY_LABELS: readonly string[] = [
  'Chủ nhật',
  'Thứ hai',
  'Thứ ba',
  'Thứ tư',
  'Thứ năm',
  'Thứ sáu',
  'Thứ bảy',
]

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/

export function isValidBackupTime(value: string): boolean {
  return TIME_PATTERN.test(value)
}

/** Phút (0..59) của chuỗi "HH:MM"; không hợp lệ ⇒ 0. */
export function minuteOfTime(value: string): number {
  return isValidBackupTime(value) ? Number(value.slice(3, 5)) : 0
}

/** Mỗi giờ: máy chủ bỏ qua giờ, chỉ so phút ⇒ luôn gửi "00:MM". */
export function hourlyTime(minute: number): string {
  const clamped = Math.min(59, Math.max(0, Math.trunc(minute)))
  return `00:${String(clamped).padStart(2, '0')}`
}

export type BackupDraft = {
  type: BackupScheduleType
  time: string
  day: number | null
  compress: boolean
  backupPath: string
}

/** Kiểm tra phía trình duyệt cho lịch sao lưu đang bật (type ≠ 0). Trả câu lỗi hoặc `null`. */
export function validateBackupDraft(draft: BackupDraft): string | null {
  if (draft.type === 0) return null
  if (!isValidBackupTime(draft.time)) return 'Hãy nhập giờ sao lưu hợp lệ (giờ:phút).'
  if (draft.type === 3 && (draft.day === null || draft.day < 0 || draft.day > 6)) {
    return 'Hãy chọn thứ trong tuần để sao lưu.'
  }
  const path = draft.backupPath.trim()
  if (!path) return 'Hãy nhập thư mục lưu bản sao.'
  if (path.length > 250) return 'Thư mục lưu bản sao không được vượt quá 250 ký tự.'
  if (!/^[A-Za-z]:\\/.test(path)) return 'Thư mục lưu phải là đường dẫn trên ổ đĩa của máy chủ, ví dụ D:\\SaoLuu.'
  if (path.includes('..')) return 'Thư mục lưu không được chứa “..”.'
  if (/^[A-Za-z]:\\?$/.test(path)) return 'Không dùng thư mục gốc của ổ đĩa; hãy chọn một thư mục con, ví dụ D:\\SaoLuu.'
  return null
}

/** Thời hạn hoàn tiền nằm trong miền máy chủ chấp nhận. */
export function isRefundInDomain(minutes: number): boolean {
  return Number.isInteger(minutes) && minutes >= REFUND_MIN_MINUTES && minutes <= REFUND_MAX_MINUTES
}

export function validateRefundMinutes(minutes: number): string | null {
  return isRefundInDomain(minutes)
    ? null
    : `Thời hạn hoàn tiền phải là số phút nguyên từ ${REFUND_MIN_MINUTES} đến ${REFUND_MAX_MINUTES}.`
}

/** 0 (tắt) hoặc 3..60 — giá trị đang lưu ngoài miền (1, 2, trên 60) vẫn hiển thị nhưng bị cảnh báo. */
export function isPausedResetInDomain(minutes: number): boolean {
  return (
    Number.isInteger(minutes) &&
    (minutes === 0 || (minutes >= PAUSED_RESET_MIN_MINUTES && minutes <= PAUSED_RESET_MAX_MINUTES))
  )
}

export function validatePausedResetMinutes(minutes: number): string | null {
  return isPausedResetInDomain(minutes)
    ? null
    : `Số phút phải là 0 (tắt) hoặc số nguyên từ ${PAUSED_RESET_MIN_MINUTES} đến ${PAUSED_RESET_MAX_MINUTES}.`
}

export const CHARGE_KEYWORD_MAX_COUNT = 30
export const CHARGE_KEYWORD_MAX_LENGTH = 20
export const CHARGE_KEYWORDS_MAX_TOTAL = 255

/** Tách theo dấu phẩy, cắt khoảng trắng, bỏ phần rỗng, nối lại bằng "," (chuỗi rỗng ⇒ máy chủ đặt về mặc định). */
export function normalizeChargeKeywords(text: string): string {
  return text
    .split(',')
    .map((word) => word.trim())
    .filter((word) => word.length > 0)
    .join(',')
}

export function validateChargeKeywords(text: string): string | null {
  const normalized = normalizeChargeKeywords(text)
  if (!normalized) return null
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(normalized)) return 'Từ khóa không được chứa ký tự điều khiển.'
  const words = normalized.split(',')
  if (words.length > CHARGE_KEYWORD_MAX_COUNT) return `Tối đa ${CHARGE_KEYWORD_MAX_COUNT} từ khóa.`
  if (words.some((word) => word.length > CHARGE_KEYWORD_MAX_LENGTH)) {
    return `Mỗi từ khóa tối đa ${CHARGE_KEYWORD_MAX_LENGTH} ký tự.`
  }
  if (normalized.length > CHARGE_KEYWORDS_MAX_TOTAL) {
    return `Tổng độ dài các từ khóa không được vượt quá ${CHARGE_KEYWORDS_MAX_TOTAL} ký tự.`
  }
  return null
}
