// task work-shift S5-FE (F4) — logic THUẦN (không React, không fetch) cho 3 việc, test bằng `node --test`
// (tests/shift-scope-model.test.ts):
//   1. Khi nào gửi `scope=shift` cho các route thống kê (chỉ khi chế độ ca bật VÀ người dùng có ca đang mở).
//   2. Nhãn khung thời gian của ô thống kê, rẽ nhánh theo `windowSource` máy chủ trả về (KHÔNG theo `window`).
//   3. Map mã lỗi `SHIFT_REQUIRED` / `ORDER_PAUSED` thành thông báo có hướng dẫn (một chỗ dùng chung cho cả web).
// Hợp đồng backend: handoff/HANDOFF_work-shift-S5-be.md mục "Hợp đồng cho F4"; mã lỗi: handoff/HANDOFF_work-shift-S4.md (D29)
// và S4b (D47/D48).
import type { ShiftInfo } from '../../api/shift.ts'
import { formatShiftStart } from '../../lib/shiftTime.ts'

// ---------------------------------------------------------------------------------------------
// 1. scope=shift
// ---------------------------------------------------------------------------------------------

/** Nguồn khung thời gian máy chủ báo lại: `shift` = từ lúc mở ca, `rolling24h` = 24 giờ trượt, `date` = trọn ngày được hỏi. */
export type StatsWindowSource = 'shift' | 'rolling24h' | 'date'

export const SHIFT_SCOPE = 'shift' as const
export type ShiftScope = typeof SHIFT_SCOPE

/**
 * `scope=shift` chỉ gửi khi chế độ ca bật (`enabled`, tức INT_SHIFT_MODE >= 1) VÀ người dùng đang có ca mở.
 * Còn lại (chế độ 0, chưa tải xong, không có ca) ⇒ undefined ⇒ KHÔNG gửi tham số: lời gọi y hệt trước khi có tính năng ca.
 */
export function statsScopeFor(state: { enabled: boolean; shift: Pick<ShiftInfo, 'shiftId'> | null }): ShiftScope | undefined {
  return state.enabled && state.shift !== null ? SHIFT_SCOPE : undefined
}

/** Gắn `?scope=shift` vào path khi `scope` hợp lệ; mọi giá trị khác (kể cả context của React Query lọt vào) ⇒ path nguyên vẹn. */
export function withShiftScope(path: string, scope: unknown): string {
  if (scope !== SHIFT_SCOPE) return path
  return `${path}${path.includes('?') ? '&' : '?'}scope=${SHIFT_SCOPE}`
}

/** Key React Query của các ô thống kê: tách theo scope để số theo ca và số 24 giờ không lẫn cache của nhau. */
export function scopeKeyPart(scope: ShiftScope | undefined): string {
  return scope ?? 'rolling'
}

/**
 * Các query phải làm mới khi nhận `shift.changed` (mở / chốt / đóng cưỡng bức / đổi chế độ / ngừng / tiếp tục nhận đơn).
 * `['shift']` phủ `/shift/current`, `/shift/summary`, trang quản lý; ba key còn lại là các ô thống kê theo mốc mở ca.
 * `orders-completed` CHỈ lấy nhánh `stats`: danh sách (`['orders-completed','list']`) luôn là 24 giờ, không đổi theo ca nên
 * không cần tải lại mỗi khi có người mở / chốt ca / dừng nhận đơn.
 * KHÔNG lấy số tiền từ event — chỉ là tín hiệu, số thật luôn đọc lại qua REST.
 */
export const SHIFT_CHANGED_QUERY_KEYS: ReadonlyArray<readonly string[]> = [
  ['shift'],
  ['shift-income'],
  ['combo-sales-stats'],
  ['orders-completed', 'stats'],
]

// ---------------------------------------------------------------------------------------------
// 2. Nhãn khung thời gian của ô thống kê
// ---------------------------------------------------------------------------------------------

export function isShiftWindow(windowSource: unknown): boolean {
  return windowSource === 'shift'
}

export type StatsWindowLabel = { text: string; title: string }

/**
 * Dòng ghi chú khung thời gian dưới số tiền. Rẽ nhánh theo `windowSource`:
 *  - `shift` ⇒ "Toàn quán từ khi mở ca (HH:mm dd/MM)" — số là TOÀN QUÁN trong [giờ mở ca, hiện tại], chưa lọc theo nhân viên
 *    (hợp đồng B7), nên nhãn phải nói rõ để không bị hiểu là số riêng của người đang đăng nhập.
 *  - còn lại (`rolling24h`, `date`, máy chủ cũ không gửi) ⇒ giữ y hệt trước: "Ca từ HH:mm dd/MM".
 * Không có mốc bắt đầu hợp lệ ⇒ null (ẩn dòng, không vỡ).
 */
export function describeStatsWindow(windowSource: unknown, shiftStart: string | null | undefined): StatsWindowLabel | null {
  const start = formatShiftStart(shiftStart)
  if (!start) return null
  if (isShiftWindow(windowSource)) {
    return {
      text: `Toàn quán từ khi mở ca (${start})`,
      title:
        'Số của cả quán từ lúc bạn mở ca đến bây giờ (giờ máy chủ), không riêng một nhân viên nào. Có thể khác số ở màn Ca làm việc vì màn đó chỉ tính phiếu của chủ ca.',
    }
  }
  return { text: `Ca từ ${start}`, title: 'Thời điểm bắt đầu tính thống kê này (giờ máy chủ).' }
}

// ---------------------------------------------------------------------------------------------
// 3. Lỗi chặn SHIFT_REQUIRED / ORDER_PAUSED
// ---------------------------------------------------------------------------------------------

export const SHIFT_REQUIRED_CODE = 'SHIFT_REQUIRED'
export const ORDER_PAUSED_CODE = 'ORDER_PAUSED'

/** Câu cố định theo handoff F4; máy chủ trả câu khác nhau theo `reason` nên web không dùng `message` của SHIFT_REQUIRED. */
export const SHIFT_REQUIRED_MESSAGE = 'Bạn chưa mở ca. Hãy mở ca rồi thử lại.'
const ORDER_PAUSED_FALLBACK = 'Quán đang tạm dừng nhận đơn, vui lòng thử lại sau.'

export type ShiftBlockAction = 'open-shift' | 'resume-intake'

export type ShiftBlock = {
  code: typeof SHIFT_REQUIRED_CODE | typeof ORDER_PAUSED_CODE
  /** Tiêu đề ngắn của thẻ thông báo. */
  title: string
  /** Câu hướng dẫn — cũng là `message` của `ApiError` ném ra, để màn nào đang hiện `error.message` cũng nói đúng câu. */
  message: string
  /** Nút lối tắt đi kèm (thứ tự hiển thị). */
  actions: ShiftBlockAction[]
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Nhận `code` (đã lấy ở `client.ts`), `message` máy chủ và `details` (= `data` của phản hồi, có `source` với ORDER_PAUSED).
 * Không phải hai mã trên ⇒ null (lỗi thường, nơi gọi xử lý như cũ).
 *  - SHIFT_REQUIRED ⇒ câu cố định + nút "Mở ca" (Q-S4-1: mở ca xong bấm lại, idem giữ nguyên nên không ghi đôi).
 *  - ORDER_PAUSED ⇒ dùng `message` máy chủ (đã là tiếng Việt). `source = manual` ⇒ kèm nút "Tiếp tục nhận đơn";
 *    `source = no_shift` ⇒ kèm nút "Mở ca" (hết chặn ngay khi có ca); nguồn lạ/thiếu ⇒ không nút (không đoán).
 */
export function classifyShiftBlock(code: unknown, message: unknown, details?: unknown): ShiftBlock | null {
  if (code === SHIFT_REQUIRED_CODE) {
    return { code: SHIFT_REQUIRED_CODE, title: 'Chưa mở ca', message: SHIFT_REQUIRED_MESSAGE, actions: ['open-shift'] }
  }
  if (code === ORDER_PAUSED_CODE) {
    const source = cleanText(asRecord(details).source)
    return {
      code: ORDER_PAUSED_CODE,
      title: 'Dừng nhận đơn',
      message: cleanText(message) || ORDER_PAUSED_FALLBACK,
      actions: source === 'manual' ? ['resume-intake'] : source === 'no_shift' ? ['open-shift'] : [],
    }
  }
  return null
}

/**
 * Lý do chặn đã hết chưa (để thẻ thông báo đổi sang "đã xong, hãy thử lại"):
 *  - SHIFT_REQUIRED hết khi người dùng đã có ca (hoặc chế độ ca đã tắt);
 *  - ORDER_PAUSED hết khi máy chủ không còn chặn nhận đơn.
 * `fresh` = trạng thái ca đã được tải SAU lúc báo lỗi; chưa tải lại thì cache có thể còn cũ ⇒ coi như CHƯA hết (không báo
 * "đã xong" sai làm người dùng bấm lại rồi bị chặn tiếp).
 */
export function isShiftBlockResolved(
  code: ShiftBlock['code'],
  state: { fresh: boolean; enabled: boolean; hasShift: boolean; intakePaused: boolean },
): boolean {
  if (!state.fresh) return false
  return code === SHIFT_REQUIRED_CODE ? !state.enabled || state.hasShift : !state.intakePaused
}

/**
 * Lấy `code` của phản hồi lỗi: `data.code` trước (mẫu D29/D48), rồi `code` ở cấp ngoài (S4 ghi cả hai). Không phải chuỗi ⇒ undefined.
 * `details` là `data` đã tách khỏi vỏ; `topLevelCode` là `code` ở cấp ngoài của vỏ.
 */
export function pickErrorCode(details: unknown, topLevelCode: unknown): string | undefined {
  const inner = asRecord(details).code
  if (typeof inner === 'string' && inner !== '') return inner
  if (typeof inner === 'number') return String(inner)
  return typeof topLevelCode === 'string' && topLevelCode !== '' ? topLevelCode : undefined
}
