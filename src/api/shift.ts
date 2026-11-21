// task work-shift S2 (F1) — API "Ca làm việc". Hợp đồng: handoff/HANDOFF_work-shift-S1.md mục 4.3–4.5.
// Server trả dữ liệu thô -> chuẩn hoá ở `features/shifts/shiftModel.ts` (số có thể về dạng chuỗi, thiếu trường...).
// Mock dev: `VITE_SHIFT_MOCK` (xem features/shifts/shiftMock.ts). Bản build luôn là undefined nên nhánh mock bị loại.
import { apiGet, apiPost, apiPut } from './client'
import {
  normalizeCloseResult,
  normalizeCurrent,
  normalizeOrderPauseResponse,
  normalizeShiftInfo,
  normalizeShiftModeSetting,
  normalizeSummaryResponse,
} from '../features/shifts/shiftModel'
import {
  normalizeReconcile,
  normalizeShiftList,
  normalizeShiftPayments,
  normalizeShiftStock,
} from '../features/shifts/shiftManageModel'

export type ShiftInfo = {
  shiftId: number
  staffId: number
  staffName: string
  /** 1 đang mở, 2 đã chốt, 3 đóng cưỡng bức. */
  status: number
  /** "YYYY-MM-DD HH:MM:SS" giờ máy chủ. */
  openTime: string
  openingCash: number
}

export type ShiftLastClosed = {
  shiftId: number
  staffName: string
  closeTime: string
  countedCash: number
}

/** Số đơn đang chờ lúc ngừng nhận đơn (đơn món chính, combo, đơn QR đã trả chưa xác nhận). */
export type ShiftIntakePending = { service: number; combo: number; qrPaid: number }

/**
 * Trạng thái ngừng nhận đơn (task S3b-FE; hợp đồng `handoff/HANDOFF_work-shift-S3b-be.md` mục 3).
 * `source`: `manual` = nhân viên bấm Ngừng (kiểm kho); `no_shift` = tự động vì không còn ca nào mở (S4b — web đã nhận sẵn).
 */
export type ShiftOrderPause = {
  on: boolean
  source: 'manual' | 'no_shift'
  /** "YYYY-MM-DD HH:MM:SS" giờ máy chủ; rỗng khi không ngừng / nguồn tự động. */
  since: string
  byStaffId: number
  byName: string
  /** Lý do người bấm gõ (≤ 40 ký tự), rỗng nếu không nhập. */
  reason: string
  pendingOrders: ShiftIntakePending
}

export type ShiftCurrent = {
  /** false = `INT_SHIFT_MODE = 0` -> web phải y hệt trước khi có tính năng ca. */
  enabled: boolean
  mode: number
  serverTime: string
  shift: ShiftInfo | null
  /** Chỉ có khi `shift = null`: ca đã chốt gần nhất toàn quán có tiền thực đếm (gợi ý tiền đầu ca). */
  lastClosed: ShiftLastClosed | null
  /** null = máy chủ không gửi (bản cũ / mode 0). Có thể có với `on = false` (kèm số đơn chờ để hiện khi chuẩn bị ngừng). */
  orderPause: ShiftOrderPause | null
}

/** Chế độ ca: 0 tắt · 1 ghi sổ (chưa chặn) · 2 bắt buộc mở ca. `effective` = chế độ máy chủ đang áp dụng thật. */
export type ShiftModeSetting = { mode: number; effective: number }

export type ShiftSource = {
  key: string
  name: string
  count: number
  cash: number
  /** Chuyển khoản. */
  online: number
  qr: number
  /** Cấn trừ — CHỈ hiển thị, KHÔNG cộng vào `total` (Q16b). */
  deduct: number
  /** = cash + online + qr (không gồm cấn trừ). */
  total: number
}

export type ShiftRefund = { count: number; cash: number; online: number; qr: number }

export type ShiftTotals = {
  count: number
  cash: number
  online: number
  qr: number
  deduct: number
  total: number
}

export type ShiftSummary = {
  sources: ShiftSource[]
  refund: ShiftRefund
  totals: ShiftTotals
  expectedCash: number
  /**
   * S3 (Q15): đơn QR ĐÃ THU TIỀN rồi bị hủy — tiền đã ở ngân hàng, cần hoàn khách ngoài hệ thống. `null` = máy chủ không
   * có dữ liệu (không biết ai hủy / lúc nào) ⇒ không hiện dòng nhắc.
   */
  refundsQrCanceled?: { count: number; total: number } | null
  /** S3 (OB4): đặt máy do chủ ca duyệt / đặt hộ — CHỈ tham khảo, không cộng vào doanh thu ca. */
  onlineBook?: { count: number; walletTotal: number } | null
}

export type ShiftPendingCounts = {
  pendingService: number
  pendingCombo: number
  /** Số đơn món QR đã trả tiền chưa xác nhận. */
  qrPaidUnconfirmed: number
  /** Tổng tiền các đơn QR đó (`qrPaidAmount` — S1 design mục 14 D7). */
  qrPaidAmount: number
}

export type ShiftCloseResult = {
  alreadyClosed: boolean
  shift: ShiftInfo & {
    closeTime: string
    countedCash: number | null
    expectedCash: number | null
    cashDiff: number | null
    note: string
  }
  summary: ShiftSummary | null
  /** Còn ca khác đang mở -> đơn chờ sẽ do ca đó xử lý; chỉ cảnh báo. */
  warnings: ShiftPendingCounts | null
}

// ---- S3 (F2): trang quản lý /shifts — hợp đồng handoff/HANDOFF_work-shift-S3be.md mục 3 ----

/** 1 đang mở, 2 đã chốt, 3 đóng cưỡng bức (Status của workshifttb). */
export type ShiftListItem = {
  shiftId: number
  staffId: number
  staffName: string
  status: number
  openTime: string
  /** null khi ca còn mở. */
  closeTime: string | null
  openingCash: number
  revenue: number
  expectedCash: number | null
  countedCash: number | null
  cashDiff: number | null
  /** Ca mở quá 16 giờ (do máy chủ quyết định) — hiển thị "Treo". */
  hung: boolean
}

export type ShiftBucket = { count: number; total: number }

export type ShiftReconcileSummary = { reportTotal: number; bucketTotal: number; diff: number }

export type ShiftListResult = {
  shifts: ShiftListItem[]
  /** Thu ngoài ca: Hệ thống (tự động) / Khác. */
  outside: { system: ShiftBucket; other: ShiftBucket }
  /** Bản rút gọn đối soát đi kèm danh sách (null nếu máy chủ không gửi). */
  reconcile: ShiftReconcileSummary | null
}

export type ShiftReconcile = {
  reportTotal: number
  shiftsTotal: number
  systemTotal: number
  otherTotal: number
  /** reportTotal − (shiftsTotal + systemTotal + otherTotal). 0 = khớp. */
  diff: number
  /** Phiếu có trong báo cáo nhưng không thuộc ô nào. */
  orphans: string[]
  /** Phiếu bị xếp vào hơn một ô. */
  duplicates: string[]
}

export type ShiftPaymentItem = {
  voucherId: string
  date: string
  time: string
  paymentType: number
  typeName: string
  /** key nguồn thu (trùng `ShiftSource.key`). */
  source: string
  /** 'cash' | 'online' | 'qr' | 'deduct' (giả định — xem handoff F2). */
  method: string
  amount: number
  member: string
  staff: string
}

export type ShiftPaymentsResult = { total: number; items: ShiftPaymentItem[] }

export type ShiftStockRow = {
  materialId: number
  name: string
  unit: string
  open: number
  /** Cuối ca (ca đã đóng) hoặc tồn hiện tại (ca còn mở). */
  close: number
  delta: number
  imported: number
  exported: number
  adjusted: number
}

export type ShiftStockResult = { available: boolean; rows: ShiftStockRow[] }

const SHIFT_MOCK = (() => {
  const raw = import.meta.env.DEV ? (import.meta.env.VITE_SHIFT_MOCK as string | undefined) : undefined
  return raw && raw !== '0' ? raw : undefined
})()

async function viaMock(path: string, body?: unknown): Promise<{ hit: true; data: unknown } | { hit: false }> {
  if (!SHIFT_MOCK) return { hit: false }
  const { mockShiftRequest } = await import('../features/shifts/shiftMock')
  return { hit: true, data: await mockShiftRequest(SHIFT_MOCK, path, body) }
}

async function call(path: string, body: unknown): Promise<unknown> {
  const mocked = await viaMock(path, body)
  if (mocked.hit) return mocked.data
  return apiPost<unknown, unknown>(path, body)
}

export async function getShiftCurrent(): Promise<ShiftCurrent> {
  const mocked = await viaMock('/shift/current')
  const raw = mocked.hit ? mocked.data : await apiGet<unknown>('/shift/current')
  return normalizeCurrent(raw)
}

export async function openShift(payload: { idem: string; openingCash?: number }) {
  // S1 thật: `{resumed, shift}`. Replay RAM (idem trùng trong 10 phút) trả ẢNH CHỤP lúc mở — status có thể đã cũ (D6) ⇒ nơi gọi
  // KHÔNG tin `shift` này làm trạng thái, phải đọc lại /shift/current (xem `useShift().applyOpened`).
  const raw = (await call('/shift/open', payload)) as { shift?: unknown; resumed?: unknown } | undefined
  return { shift: normalizeShiftInfo(raw?.shift), resumed: raw?.resumed === true }
}

/**
 * `shiftId` bỏ trống = ca đang mở của chính mình. Xem ca người khác cần quyền "Xem mọi ca" (server kiểm).
 * Response thật là `{live, shift, summary}`; ca đã đóng mà không có bản chụp tóm tắt ⇒ ném lỗi (UI hiện "Thử lại").
 */
export async function getShiftSummary(shiftId?: number): Promise<ShiftSummary> {
  const summary = normalizeSummaryResponse(await call('/shift/summary', shiftId ? { shiftId } : {}))
  if (!summary) throw new Error('Ca này chưa lưu được tóm tắt doanh thu.')
  return summary
}

/** Danh sách ca của một ngày (`date` = YYYY-MM-DD) + mọi ca còn mở từ trước + Thu ngoài ca. */
export async function listShifts(payload: { date: string; staffId?: number }): Promise<ShiftListResult> {
  return normalizeShiftList(await call('/shift/list', payload))
}

/** Giao dịch tạo nên một ô nguồn × hình thức của ca; phân trang phía máy chủ (limit ≤ 200). */
export async function getShiftPayments(payload: {
  shiftId: number
  source?: string
  method?: string
  limit: number
  offset: number
}): Promise<ShiftPaymentsResult> {
  return normalizeShiftPayments(await call('/shift/payments', payload))
}

export async function getShiftStock(shiftId: number): Promise<ShiftStockResult> {
  return normalizeShiftStock(await call('/shift/stock', { shiftId }))
}

/** Đóng cưỡng bức ca đang mở (lối thoát cho ca bị kẹt). `note` bắt buộc 1–500 ký tự. */
export async function forceCloseShift(payload: { shiftId: number; note: string }): Promise<ShiftCloseResult> {
  return normalizeCloseResult(await call('/shift/force-close', payload))
}

/** Đối soát: Σ ca + Thu ngoài ca so với báo cáo doanh thu tổng cùng ngày. */
export async function reconcileShifts(date: string): Promise<ShiftReconcile> {
  return normalizeReconcile(await call('/shift/reconcile', { date }))
}

/**
 * Ngừng nhận đơn (kiểm kho giao ca). Idempotent ở máy chủ: đang ngừng mà gọi lại ⇒ `changed:false`, không ghi nhật ký.
 * Trả trạng thái mới nhất (`orderPause`) nếu máy chủ gửi kèm, không thì null (nơi gọi đọc lại /shift/current).
 */
export async function pauseOrderIntake(reason?: string): Promise<{ changed: boolean; orderPause: ShiftOrderPause | null }> {
  return normalizeOrderPauseResponse(await call('/orders/intake/pause', reason ? { reason } : {}))
}

export async function resumeOrderIntake(): Promise<{ changed: boolean; orderPause: ShiftOrderPause | null }> {
  return normalizeOrderPauseResponse(await call('/orders/intake/resume', {}))
}

/** Chế độ ca hiện tại (mọi nhân viên đọc được; route không bị `SHIFT_DISABLED` chặn). */
export async function getShiftMode(): Promise<ShiftModeSetting> {
  const mocked = await viaMock('/settings/shift-mode')
  const raw = mocked.hit ? mocked.data : await apiGet<unknown>('/settings/shift-mode')
  return normalizeShiftModeSetting(raw)
}

/** Đổi chế độ ca (CHỈ admin — máy chủ kiểm cứng). `mode` 0 | 1 | 2. */
export async function setShiftMode(mode: number): Promise<ShiftModeSetting> {
  const mocked = await viaMock('/settings/shift-mode', { mode })
  const raw = mocked.hit ? mocked.data : await apiPut<unknown, { mode: number }>('/settings/shift-mode', { mode })
  return normalizeShiftModeSetting(raw)
}

export async function closeShift(payload: {
  idem: string
  shiftId: number
  countedCash?: number
  note?: string
}): Promise<ShiftCloseResult> {
  return normalizeCloseResult(await call('/shift/close', payload))
}
