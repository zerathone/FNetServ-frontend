// task work-shift S3b-FE (D2) — logic THUẦN cho công tắc chế độ ca trong Cài đặt (test: tests/shift-intake-model.test.ts).

export type ShiftModeOption = { mode: 0 | 1 | 2; label: string; summary: string }

/** Ba chế độ của `INT_SHIFT_MODE` (design mục 2). Nhãn đúng chữ user chốt 2026-11-21. */
export const SHIFT_MODE_OPTIONS: readonly ShiftModeOption[] = [
  {
    mode: 0,
    label: 'Tắt',
    summary: 'Không có ca làm việc: giao diện giữ nguyên như trước, thu ngân không phải mở hay chốt ca.',
  },
  {
    mode: 1,
    label: 'Ghi sổ (chưa chặn)',
    summary: 'Thu ngân mở ca và chốt ca, hệ thống ghi doanh thu từng ca nhưng vẫn cho thu tiền khi chưa mở ca.',
  },
  {
    mode: 2,
    label: 'Bắt buộc mở ca',
    summary: 'Thu ngân phải mở ca mới thu được tiền; không có ca đang mở thì quán tạm ngừng nhận đơn và thanh toán QR.',
  },
]

/** Segmented chỉ nhận chuỗi. */
export const shiftModeToValue = (mode: number): string => String(mode)

/** Giá trị ngoài 0/1/2 (không xảy ra) ⇒ 0 = Tắt, hướng an toàn. */
export function shiftModeFromValue(value: string): number {
  const mode = Number(value)
  return mode === 1 || mode === 2 ? mode : 0
}

/** Câu lỗi hiển thị khi PUT /settings/shift-mode thất bại. */
export function describeShiftModeError(error: { code?: string; httpStatus?: number; message?: string }): string {
  if (error.httpStatus === 403 || error.message === 'forbidden') return 'Chỉ quản trị viên được đổi chế độ ca.'
  if (error.code === 'INVALID_INPUT') return 'Chế độ ca không hợp lệ (chỉ nhận Tắt, Ghi sổ hoặc Bắt buộc mở ca).'
  if (error.httpStatus === 404 || error.httpStatus === 501) return 'Máy chủ chưa hỗ trợ đổi chế độ ca (cần cập nhật Server).'
  return error.message || 'Không đổi được chế độ ca. Thử lại.'
}
