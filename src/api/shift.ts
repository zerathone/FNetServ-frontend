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

/** Số đơn đang chờ lúc dừng nhận đơn (đơn món chính, combo, đơn QR đã trả chưa xác nhận). */
export type ShiftIntakePending = { service: number; combo: number; qrPaid: number }

/** Cờ dừng nhận đơn do nhân viên bấm (kiểm kho giao ca). Sống qua chốt ca (Q8). */
export type ShiftManualPause = {
  on: boolean
  /** "YYYY-MM-DD HH:MM:SS" giờ máy chủ; rỗng khi không ngừng. */
  since: string
  byStaffId: number
  byName: string
  /** Lý do người bấm gõ (≤ 40 ký tự), rỗng nếu không nhập. */
  reason: string
}

/**
 * Trạng thái dừng nhận đơn — hợp đồng đã chốt 2026-11-21 (`handoff/HANDOFF_work-shift-S3b-be.md` mục 3), tách nguồn khỏi lý do:
 *  - `on`: trạng thái CHẶN hiệu lực (S3b = `manual.on`; S4b = `manual.on || (noShift && chế độ 2)`). Nút Tạo đơn khoá theo cờ này.
 *  - `manual`: cờ do người bấm. Dialog Mở ca hỏi "Tiếp tục nhận đơn?" dựa vào `manual.on` (kể cả khi `noShift` cũng true).
 *  - `noShift`: không còn ca nào mở. Chế độ 1 thì `on = false` mà `noShift = true` ⇒ chỉ cảnh báo, không khoá nút.
 */
export type ShiftOrderPause = {
  on: boolean
  manual: ShiftManualPause
  noShift: boolean
  pendingOrders: ShiftIntakePending
}

export type ShiftCurrent = {
  /** false = `INT_SHIFT_MODE = 0` -> web phải y hệt trước khi có tính năng ca. */
  enabled: boolean
  mode: number
  serverTime: string
  /**
   * "YYYY-MM-DD 00:00:00" (giờ máy chủ) của NGÀY đăng nhập của chính phiên này — có ở MỌI chế độ, kể cả mode 0.
   * Mốc của widget Doanh thu khi không có ca mở (giống MFC "Doanh thu theo ca"). '' = máy chủ bản cũ chưa gửi.
   */
  loginDayStart: string
  shift: ShiftInfo | null
  /** Chỉ có khi `shift = null`: ca đã chốt gần nhất toàn quán có tiền thực đếm (gợi ý tiền đầu ca). */
  lastClosed: ShiftLastClosed | null
  /** null = máy chủ không gửi (bản cũ / mode 0). Có thể có với `on = false` (kèm số đơn chờ để hiện khi chuẩn bị ngừng). */
  orderPause: ShiftOrderPause | null
}

/**
 * Chế độ ca: 0 tắt · 1 ghi sổ (chưa chặn) · 2 bắt buộc mở ca. `effective` = chế độ máy chủ đang áp dụng thật.
 * `GET` trả thêm `enabled`; `PUT` trả thêm `changed` (false = đã đúng chế độ đó từ trước, không ghi nhật ký).
 */
export type ShiftModeSetting = { mode: number; effective: number; enabled?: boolean; changed?: boolean }

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

/**
 * Số liệu ca ĐÃ ĐÓNG đã thay đổi sau khi chốt (sửa / hủy phiếu): `drift = số chụp lúc chốt − số tính lại hiện tại`.
 * Khác 0 ⇒ phải cảnh báo "Số liệu đã thay đổi sau khi chốt ca" (design 14b D17). Ca đang mở không có drift.
 */
export type ShiftDrift = { total: number; cash: number }

/** Đặt máy online do chủ ca duyệt / đặt hộ (OB4, design 14b D20). Chỉ tham khảo, KHÔNG cộng vào doanh thu ca. */
export type ShiftOnlineBook = {
  /** Số phiếu trừ ví (phiếu 39). */
  count: number
  /** Tổng tiền đã trừ ví (số dương). */
  walletTotal: number
  /** Số phiếu hoàn lại ví vì đơn bị hủy (phiếu 40) của chủ ca trong khung ca. */
  creditCount: number
  creditTotal: number
  /** `walletTotal − creditTotal`: số thực sự đã trừ ví. */
  netTotal: number
}

export type ShiftSummary = {
  sources: ShiftSource[]
  refund: ShiftRefund
  totals: ShiftTotals
  expectedCash: number
  /**
   * S3 (Q15): đơn QR ĐÃ THU TIỀN rồi bị hủy — tiền đã ở ngân hàng, cần hoàn khách ngoài hệ thống. Từ cancel-qr-audit
   * (2026-11-23) máy chủ trả `{count, total}` = phiếu QR do người của ca này hủy (bảng `workshiftqrcanceltb`; phiếu hủy
   * trước bản này không có). `null` = máy chủ cũ hoặc lỗi đọc ⇒ "chưa thống kê được".
   */
  refundsQrCanceled?: { count: number; total: number } | null
  onlineBook?: ShiftOnlineBook | null
  /** Chỉ có ở ca đã đóng. `null`/thiếu = không có dữ liệu so sánh. */
  drift?: ShiftDrift | null
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
  /** Doanh thu CẢ ca (kể cả phần sang ngày khác). */
  revenue: number
  /** Doanh thu phần thuộc NGÀY đang xem — cộng các dòng + Thu ngoài ca = báo cáo ngày (D16). */
  revenueOnDate: number
  /** Ca qua đêm hiện ở mọi ngày ca chạm tới: ngày mở và ngày chốt (`closeDate` null = chưa chốt). */
  crossDay: { openDate: string; closeDate: string | null }
  expectedCash: number | null
  countedCash: number | null
  cashDiff: number | null
  /** Lý do / ghi chú lúc chốt (ca đóng cưỡng bức: lý do quản lý nhập). */
  note: string
  /** Chỉ ca đã đóng; xem `ShiftDrift`. */
  drift: ShiftDrift | null
  /** Ca mở quá 16 giờ (do máy chủ quyết định) — hiển thị "Treo". */
  hung: boolean
}

export type ShiftBucket = { count: number; total: number }

export type ShiftReconcileSummary = {
  reportTotal: number
  bucketTotal: number
  diff: number
  /** Phiếu không gắn với tài khoản người dùng nào: báo cáo doanh thu bỏ qua, tách riêng khi đối soát. */
  excludedNoUser: ShiftBucket
}

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
  excludedNoUser: ShiftBucket
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
  /** 'cash' | 'online' | 'qr' | 'deduct' (máy chủ trả khoá). */
  method: string
  amount: number
  member: string
  staff: string
}

/** `total` = SỐ PHIẾU của ô (không phải số dòng trang); `sumAmount` = tổng tiền các phiếu đó. */
export type ShiftPaymentsResult = { total: number; sumAmount: number; items: ShiftPaymentItem[] }

export type ShiftStockRow = {
  materialId: number
  name: string
  unit: string
  /** null = không có ảnh chụp đầu ca cho nguyên liệu này. */
  open: number | null
  /** Cuối ca (ca đã đóng: `close`) hoặc tồn hiện tại (ca còn mở: `current`). */
  close: number
  /** null khi thiếu số đầu ca. */
  delta: number | null
  imported: number
  exported: number
  adjusted: number
}

export type ShiftStockResult = {
  available: boolean
  /** Có ảnh chụp tồn kho lúc mở ca / lúc chốt ca không (ca cũ trước khi có tính năng kho thì không có). */
  openSnapshot: boolean
  closeSnapshot: boolean
  rows: ShiftStockRow[]
}

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
 * Dừng nhận đơn (kiểm kho giao ca). Idempotent ở máy chủ: đang ngừng mà gọi lại ⇒ `changed:false`, không ghi nhật ký.
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
