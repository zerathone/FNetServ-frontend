// Tặng thời gian miễn phí cho NHÂN VIÊN (POST /user/give-free-time) — logic THUẦN cho dialog
// (test: tests/staff-free-time-model.test.ts). Giới hạn trùng server (MAX_MINUTEPLUS_ALLOW của dialog MFC).

/** 500 * 1000 * 60 phút — trần của dialog MFC và của REST (server vẫn chặn ở mức này). */
export const FREE_TIME_MAX_MINUTES = 500 * 1000 * 60

/**
 * Trần NHẬP trên web thấp hơn nhiều (100 ngày): web không có thao tác thu hồi, gõ nhầm thêm một số 0 sẽ phải quay lại
 * MFC để trừ. Cần tặng nhiều hơn thì tặng nhiều lần.
 */
export const FREE_TIME_UI_MAX_MINUTES = 100 * 24 * 60

export type FreeTimePreset = { minutes: number; label: string }

/** Mốc bấm nhanh: ca làm thường gặp. Giá trị luôn là số phút. */
export const FREE_TIME_PRESETS: readonly FreeTimePreset[] = [
  { minutes: 30, label: '30 phút' },
  { minutes: 60, label: '1 giờ' },
  { minutes: 120, label: '2 giờ' },
  { minutes: 300, label: '5 giờ' },
  { minutes: 480, label: '8 giờ' },
]

export type ParsedMinutes =
  | { ok: true; minutes: number }
  | { ok: false; reason: 'empty' | 'invalid' | 'too-large' }

/** Chỉ nhận số nguyên dương (phút). Server cũng chỉ nhận ≥ 1 (không thu hồi như MFC). */
export function parseMinutes(input: string): ParsedMinutes {
  const text = input.trim()
  if (!text) return { ok: false, reason: 'empty' }
  if (!/^\d+$/.test(text)) return { ok: false, reason: 'invalid' }
  const minutes = Number(text)
  if (!Number.isSafeInteger(minutes) || minutes < 1) return { ok: false, reason: 'invalid' }
  if (minutes > FREE_TIME_UI_MAX_MINUTES) return { ok: false, reason: 'too-large' }
  return { ok: true, minutes }
}

/** 150 → "2 giờ 30 phút"; 45 → "45 phút"; 120 → "2 giờ". */
export function formatMinutes(total: number): string {
  if (!Number.isFinite(total) || total <= 0) return '0 phút'
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  const parts = [hours ? `${new Intl.NumberFormat('vi-VN').format(hours)} giờ` : '', minutes ? `${minutes} phút` : '']
  return parts.filter(Boolean).join(' ')
}

/** Câu báo dưới ô nhập; rỗng khi chưa nhập (không báo lỗi khi người dùng chưa gõ gì). */
export function describeParsedMinutes(parsed: ParsedMinutes): string {
  if (parsed.ok) return `= ${formatMinutes(parsed.minutes)}`
  if (parsed.reason === 'too-large') {
    return `Tối đa ${new Intl.NumberFormat('vi-VN').format(FREE_TIME_UI_MAX_MINUTES)} phút (100 ngày) mỗi lần.`
  }
  if (parsed.reason === 'invalid') return 'Chỉ nhập số nguyên dương (đơn vị phút).'
  return ''
}

/** Thông báo khi POST /user/give-free-time thất bại (server trả message tiếng Anh ngắn). */
export function describeGiveFreeTimeError(error: { message?: string; httpStatus?: number }): string {
  const message = error.message ?? ''
  if (error.httpStatus === 404 || error.httpStatus === 501) {
    return 'Máy chủ chưa hỗ trợ tặng thời gian miễn phí (cần cập nhật Server).'
  }
  if (message === 'admin required') return 'Chỉ quản trị viên được tặng thời gian miễn phí.'
  if (message === 'cannot give time to self') return 'Không thể tự tặng thời gian cho chính mình.'
  if (message === 'staff not found') return 'Không tìm thấy nhân viên này (có thể đã bị xóa). Hãy tải lại danh sách.'
  if (message === 'idem already used by another transaction') {
    return 'Yêu cầu trùng mã với một giao dịch khác, hãy đóng hộp thoại rồi thử lại.'
  }
  if (message === 'db error') return 'Máy chủ không ghi được dữ liệu. Thử lại, nếu vẫn lỗi hãy xem nhật ký máy chủ.'
  if (message === 'user is not a staff') return 'Tài khoản này không phải nhân viên.'
  if (message === 'minutes too large') return 'Số phút vượt giới hạn cho phép.'
  if (message === 'invalid note') return 'Ghi chú không hợp lệ (tối đa 200 ký tự).'
  if (message === 'idem is required' || message.startsWith('invalid characters in idem')) {
    return 'Yêu cầu không hợp lệ, hãy đóng hộp thoại rồi thử lại.'
  }
  if (message.startsWith('missing/invalid')) return 'Thiếu hoặc sai thông tin. Kiểm tra số phút rồi thử lại.'
  return message || 'Không tặng được thời gian miễn phí. Thử lại.'
}
