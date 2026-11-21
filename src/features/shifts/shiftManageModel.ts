// task work-shift S3 (F2) — logic THUẦN của trang quản lý /shifts (không React, không fetch) để test bằng `node --test`
// (tests/shift-manage-model.test.ts). Chuẩn hoá response `/shift/list|payments|stock|reconcile` (đọc phòng thủ — hợp đồng
// S3 chưa có B2 thật), trạng thái hiển thị, chênh lệch tiền, tổng ngày, quyền, kiểm ghi chú đóng cưỡng bức.
import type {
  ShiftBucket,
  ShiftCloseResult,
  ShiftListItem,
  ShiftListResult,
  ShiftPaymentItem,
  ShiftPaymentsResult,
  ShiftReconcile,
  ShiftReconcileSummary,
  ShiftStockResult,
  ShiftStockRow,
  ShiftSummary,
} from '../../api/shift.ts'
import {
  MAX_SHIFT_NOTE,
  asRecord,
  sanitizeNoteInput,
  toNullableNumber,
  toNumber,
  toText,
} from './shiftModel.ts'

/** Số dòng mỗi trang của danh sách giao dịch (hợp đồng: limit ≤ 200). */
export const PAYMENTS_PAGE_SIZE = 50
/** Trang quản lý tự làm mới mỗi 30 giây — chỉ khi đang xem hôm nay. */
export const SHIFT_LIST_POLL_MS = 30_000

// ---------------------------------------------------------------------------------------------
// Quyền (server kiểm cứng; ở đây chỉ để ẩn/hiện cho đúng — UX)
// ---------------------------------------------------------------------------------------------

/**
 * Mã quyền do B2 chọn khi làm backend (handoff S3be: "chọn mã chưa dùng", seed theo mẫu OB 9416/9417). Chưa có B2 ⇒ `null`:
 *  - nhân viên KHÔNG phải admin sẽ không thấy mục menu (`rightAny` rỗng); admin dùng bình thường;
 *  - mở thẳng `/shifts` thì trang vẫn gọi API và để server quyết định (403 ⇒ "Bạn không có quyền xem danh sách ca").
 * ⚠️ Điền hai mã này NGAY khi B2 xong (grep `R_SHIFT` ở define.h / "Mã quyền đã chọn" trong handoff S3be).
 */
export const SHIFT_RIGHTS: { VIEW_ALL: number | null; FORCE_CLOSE: number | null } = {
  VIEW_ALL: null,
  FORCE_CLOSE: null,
}

export function shiftRightCodes(code: number | null): number[] {
  return code === null ? [] : [code]
}

/** `unknown` = chưa biết mã quyền ⇒ không tự chặn ở client, để server trả 403. */
export function viewAllGate(isAdmin: boolean, hasRight: (code: number) => boolean): 'allowed' | 'denied' | 'unknown' {
  if (isAdmin) return 'allowed'
  if (SHIFT_RIGHTS.VIEW_ALL === null) return 'unknown'
  return hasRight(SHIFT_RIGHTS.VIEW_ALL) ? 'allowed' : 'denied'
}

/** Nút Đóng cưỡng bức: chỉ ca ĐANG MỞ và người xem là admin hoặc có quyền tương ứng. */
export function canForceClose(status: number, isAdmin: boolean, hasRight: (code: number) => boolean): boolean {
  if (status !== 1) return false
  if (isAdmin) return true
  return SHIFT_RIGHTS.FORCE_CLOSE !== null && hasRight(SHIFT_RIGHTS.FORCE_CLOSE)
}

export type ShiftErrorKind = 'denied' | 'disabled' | 'other'

/** Phân loại lỗi để chọn câu hiển thị. `rbac` = RbacDeniedError (403 RBAC_DENIED), `httpStatus` = ApiError.httpStatus. */
export function classifyShiftError(info: { rbac: boolean; code?: string; httpStatus?: number }): ShiftErrorKind {
  if (info.code === 'SHIFT_DISABLED') return 'disabled'
  if (info.rbac || info.httpStatus === 403 || info.code === 'RBAC_DENIED') return 'denied'
  return 'other'
}

// ---------------------------------------------------------------------------------------------
// Chuẩn hoá response
// ---------------------------------------------------------------------------------------------

function normalizeListItem(raw: unknown): ShiftListItem {
  const r = asRecord(raw)
  const closeTime = toText(r.closeTime)
  // Thiếu / sai `status` ⇒ coi như đã chốt (không hiện nút Đóng cưỡng bức nhầm lên dòng dữ liệu hỏng).
  const status = toNumber(r.status, 2)
  return {
    shiftId: toNumber(r.shiftId),
    staffId: toNumber(r.staffId),
    staffName: toText(r.staffName),
    status,
    openTime: toText(r.openTime),
    closeTime: status === 1 || closeTime === '' ? null : closeTime,
    openingCash: toNumber(r.openingCash),
    revenue: toNumber(r.revenue),
    expectedCash: toNullableNumber(r.expectedCash),
    countedCash: toNullableNumber(r.countedCash),
    cashDiff: toNullableNumber(r.cashDiff),
    hung: r.hung === true || r.hung === 1 || r.hung === '1',
  }
}

function normalizeBucket(raw: unknown): ShiftBucket {
  const r = asRecord(raw)
  return { count: toNumber(r.count), total: toNumber(r.total) }
}

function normalizeReconcileSummary(raw: unknown): ShiftReconcileSummary | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = asRecord(raw)
  const reportTotal = toNumber(r.reportTotal)
  const bucketTotal = toNumber(r.bucketTotal)
  return { reportTotal, bucketTotal, diff: toNumber(r.diff, reportTotal - bucketTotal) }
}

/** Ca đang mở lên đầu (cần chú ý nhất), còn lại mới mở sau cùng trước. Ca không có giờ hợp lệ xếp cuối. */
export function sortShifts(shifts: readonly ShiftListItem[]): ShiftListItem[] {
  return [...shifts].sort((a, b) => {
    const openA = a.status === 1 ? 0 : 1
    const openB = b.status === 1 ? 0 : 1
    if (openA !== openB) return openA - openB
    return b.openTime.localeCompare(a.openTime) || b.shiftId - a.shiftId
  })
}

export function normalizeShiftList(raw: unknown): ShiftListResult {
  const r = asRecord(raw)
  const outside = asRecord(r.outside)
  return {
    shifts: sortShifts((Array.isArray(r.shifts) ? r.shifts : []).map(normalizeListItem).filter((s) => s.shiftId > 0)),
    outside: { system: normalizeBucket(outside.system), other: normalizeBucket(outside.other) },
    reconcile: normalizeReconcileSummary(r.reconcile),
  }
}

function toVoucherList(value: unknown): string[] {
  return (Array.isArray(value) ? value : []).map((v) => toText(v)).filter((v) => v !== '')
}

export function normalizeReconcile(raw: unknown): ShiftReconcile {
  const r = asRecord(raw)
  const shiftsTotal = toNumber(r.shiftsTotal)
  const systemTotal = toNumber(r.systemTotal)
  const otherTotal = toNumber(r.otherTotal)
  const reportTotal = toNumber(r.reportTotal)
  return {
    reportTotal,
    shiftsTotal,
    systemTotal,
    otherTotal,
    diff: toNumber(r.diff, reportTotal - (shiftsTotal + systemTotal + otherTotal)),
    orphans: toVoucherList(r.orphans),
    duplicates: toVoucherList(r.duplicates),
  }
}

function normalizePaymentItem(raw: unknown): ShiftPaymentItem {
  const r = asRecord(raw)
  return {
    voucherId: toText(r.voucherId),
    date: toText(r.date),
    time: toText(r.time),
    paymentType: toNumber(r.paymentType),
    typeName: toText(r.typeName),
    source: toText(r.source),
    method: toText(r.method),
    amount: toNumber(r.amount),
    member: toText(r.member),
    staff: toText(r.staff),
  }
}

export function normalizeShiftPayments(raw: unknown): ShiftPaymentsResult {
  const r = asRecord(raw)
  const items = (Array.isArray(r.items) ? r.items : []).map(normalizePaymentItem)
  return { total: toNumber(r.total, items.length), items }
}

function normalizeStockRow(raw: unknown): ShiftStockRow {
  const r = asRecord(raw)
  const open = toNumber(r.open)
  // Hợp đồng: `close` (ca đã đóng) hoặc `current` (ca còn mở) — cùng một vai trò "cuối kỳ".
  const close = toNumber(r.close !== undefined ? r.close : r.current)
  return {
    materialId: toNumber(r.materialId),
    name: toText(r.name),
    unit: toText(r.unit),
    open,
    close,
    delta: toNumber(r.delta, close - open),
    imported: toNumber(r.imported),
    exported: toNumber(r.exported),
    adjusted: toNumber(r.adjusted),
  }
}

export function normalizeShiftStock(raw: unknown): ShiftStockResult {
  const r = asRecord(raw)
  return {
    // Thiếu `available` ⇒ coi như có kho nếu có dòng; `false` rõ ràng ⇒ ẩn tab.
    available: r.available === false || r.available === 0 ? false : true,
    rows: (Array.isArray(r.rows) ? r.rows : []).map(normalizeStockRow),
  }
}

// ---------------------------------------------------------------------------------------------
// Hiển thị
// ---------------------------------------------------------------------------------------------

export type ShiftTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info'

/** Trạng thái hiển thị: "Treo" thắng "Đang mở" (ca mở quá 16 giờ — cần quản lý xử lý). */
export function shiftStatusView(item: Pick<ShiftListItem, 'status' | 'hung'>): { label: string; tone: ShiftTone; hint?: string } {
  if (item.status === 1) {
    return item.hung
      ? { label: 'Treo', tone: 'danger', hint: 'Ca mở quá 16 giờ — có thể bị quên chốt. Quản lý có thể đóng cưỡng bức.' }
      : { label: 'Đang mở', tone: 'success' }
  }
  if (item.status === 3) return { label: 'Đóng cưỡng bức', tone: 'warning', hint: 'Quản lý đóng thay nhân viên.' }
  return { label: 'Đã chốt', tone: 'neutral' }
}

export type CashDiffKind = 'none' | 'ok' | 'short' | 'over'

const nf = new Intl.NumberFormat('vi-VN')

/** Chênh lệch tiền mặt (thực đếm − dự kiến). Luôn kèm chữ, không chỉ màu. `null` = ca chưa đếm. */
export function cashDiffView(diff: number | null, status?: number): { kind: CashDiffKind; text: string } {
  // Ca đóng cưỡng bức không có tiền thực đếm vì quản lý đóng thay — "Không đếm" chứ không phải "chưa đếm".
  if (diff === null) return { kind: 'none', text: status === 3 ? 'Không đếm' : 'Chưa đếm' }
  if (diff === 0) return { kind: 'ok', text: 'Khớp' }
  const body = `${nf.format(Math.abs(diff))} đ`
  return diff < 0 ? { kind: 'short', text: `Thiếu ${body}` } : { kind: 'over', text: `Thừa ${body}` }
}

/** Số lượng kho có dấu (không có đơn vị tiền): "+12", "−3,5", "0". */
export function formatSignedQty(value: number): string {
  const body = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(Math.abs(value))
  if (value > 0) return `+${body}`
  if (value < 0) return `−${body}`
  return '0'
}

export function formatQty(value: number): string {
  return new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 }).format(value)
}

export const PAYMENT_METHODS = [
  { key: 'cash', label: 'Tiền mặt' },
  { key: 'online', label: 'Chuyển khoản' },
  { key: 'qr', label: 'QR' },
  { key: 'deduct', label: 'Cấn trừ' },
] as const

export type PaymentMethodKey = (typeof PAYMENT_METHODS)[number]['key']

export function methodLabel(key: string): string {
  return PAYMENT_METHODS.find((m) => m.key === key)?.label ?? key
}

// ---------------------------------------------------------------------------------------------
// Tổng ngày + đối soát
// ---------------------------------------------------------------------------------------------

export type DayTotals = {
  shiftCount: number
  openCount: number
  hungCount: number
  /** Số ca mở từ ngày trước (vẫn còn mở) được kéo vào danh sách. */
  carriedOver: number
  /** Tổng doanh thu các ca trong danh sách (không gồm Thu ngoài ca). */
  revenueTotal: number
}

const dayOf = (time: string) => /^(\d{4}-\d{2}-\d{2})/.exec(time.trim())?.[1] ?? ''

export function summarizeDay(shifts: readonly ShiftListItem[], date: string): DayTotals {
  return {
    shiftCount: shifts.length,
    openCount: shifts.filter((s) => s.status === 1).length,
    hungCount: shifts.filter((s) => s.status === 1 && s.hung).length,
    carriedOver: shifts.filter((s) => {
      const d = dayOf(s.openTime)
      return d !== '' && d < date
    }).length,
    revenueTotal: shifts.reduce((sum, s) => sum + s.revenue, 0),
  }
}

export type ReconcileVerdict = { matched: boolean; diff: number; badCount: number }

/** diff = 0 ⇒ "Khớp"; khác 0 ⇒ lệch. `badCount` = số phiếu gây lệch đã biết (orphans + duplicates). */
export function reconcileVerdict(rec: Pick<ShiftReconcile, 'diff' | 'orphans' | 'duplicates'>): ReconcileVerdict {
  return { matched: rec.diff === 0, diff: rec.diff, badCount: rec.orphans.length + rec.duplicates.length }
}

/** Dựng bản đối soát rút gọn từ `/shift/list` khi `/shift/reconcile` lỗi (không có danh sách phiếu). */
export function reconcileFromList(list: ShiftListResult): ShiftReconcile | null {
  if (!list.reconcile) return null
  return {
    reportTotal: list.reconcile.reportTotal,
    // Đối soát tính theo PHIẾU (ngày của phiếu), còn doanh thu ca tính theo khung ca (có ca qua đêm / mở từ trước) ⇒ KHÔNG cộng
    // revenue các dòng danh sách ở đây; suy ra từ tổng các ô máy chủ đã chia để dòng "báo cáo = ca + hệ thống + khác" luôn cộng ra.
    shiftsTotal: list.reconcile.bucketTotal - list.outside.system.total - list.outside.other.total,
    systemTotal: list.outside.system.total,
    otherTotal: list.outside.other.total,
    diff: list.reconcile.diff,
    orphans: [],
    duplicates: [],
  }
}

/**
 * Dựng `ShiftCloseResult` từ một dòng danh sách + tóm tắt để tái dùng `buildCloseTicketHtml` (phiếu của F1) cho ca ĐÃ ĐÓNG
 * ở trang quản lý. Danh sách không trả ghi chú (lý do đóng cưỡng bức nằm ở nhật ký máy chủ).
 */
export function listItemToCloseResult(item: ShiftListItem, summary: ShiftSummary | null): ShiftCloseResult {
  return {
    alreadyClosed: true,
    shift: {
      shiftId: item.shiftId,
      staffId: item.staffId,
      staffName: item.staffName,
      status: item.status,
      openTime: item.openTime,
      openingCash: item.openingCash,
      closeTime: item.closeTime ?? '',
      countedCash: item.countedCash,
      expectedCash: item.expectedCash ?? summary?.expectedCash ?? null,
      cashDiff: item.cashDiff,
      // Danh sách không trả lý do; ca đóng cưỡng bức vẫn phải ghi rõ trên phiếu in.
      note: item.status === 3 ? 'Đóng cưỡng bức bởi quản lý' : '',
    },
    summary,
    warnings: null,
  }
}

// ---------------------------------------------------------------------------------------------
// Ngày
// ---------------------------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, '0')

/** Ngày địa phương dạng YYYY-MM-DD (không dùng toISOString: lệch múi giờ làm "hôm nay" sai sau nửa đêm). */
export function todayYmd(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function isTodayYmd(date: string, now: Date = new Date()): boolean {
  return date === todayYmd(now)
}

// ---------------------------------------------------------------------------------------------
// Đóng cưỡng bức: ghi chú bắt buộc 1–500 ký tự, server dùng isSqlSafeText (từ chối ' \ và ký tự điều khiển)
// ---------------------------------------------------------------------------------------------

export function validateForceCloseNote(value: string): string | undefined {
  const text = sanitizeNoteInput(value).trim()
  if (text === '') return 'Cần nhập lý do đóng cưỡng bức.'
  if (text.length > MAX_SHIFT_NOTE) return `Ghi chú tối đa ${MAX_SHIFT_NOTE} ký tự.`
  if (/['\\]/.test(text)) return "Ghi chú không dùng dấu nháy đơn (') hoặc gạch chéo ngược (\\)."
  return undefined
}
