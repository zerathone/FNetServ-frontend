// task work-shift S3 (F2) — logic THUẦN của trang quản lý /shifts (không React, không fetch) để test bằng `node --test`
// (tests/shift-manage-model.test.ts). Chuẩn hoá response `/shift/list|payments|stock|reconcile` (đã đối chiếu backend thật
// 2026-11-21 + design 14b D16/D17/D20; vẫn đọc phòng thủ vì số có thể về dạng chuỗi), trạng thái hiển thị, chênh lệch tiền,
// tổng ngày (phần doanh thu thuộc ngày), ca qua đêm, quyền, kiểm ghi chú đóng cưỡng bức.
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
  hasDrift,
  normalizeDrift,
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
 * Mã quyền thật (`R_SHIFT_VIEW_ALL` / `R_SHIFT_FORCE_CLOSE` ở `ServerSide_ai/define.h`, seed `functiontb` nhóm 900001;
 * chốt 2026-11-21 ở `handoff/HANDOFF_work-shift-S3be.md`). Server kiểm CỨNG "admin hoặc có mã" (kể cả khi `INT_RBAC_ENFORCE` tắt);
 * web chỉ dùng để ẩn/hiện menu và nút cho đúng.
 */
export const SHIFT_RIGHTS = {
  /** 9418 — Xem mọi ca làm việc. */
  VIEW_ALL: 9418,
  /** 9419 — Đóng cưỡng bức ca làm việc. */
  FORCE_CLOSE: 9419,
} as const

/** Trang quản lý ca: admin hoặc có quyền "Xem mọi ca làm việc". */
export function canViewAllShifts(isAdmin: boolean, hasRight: (code: number) => boolean): boolean {
  return isAdmin || hasRight(SHIFT_RIGHTS.VIEW_ALL)
}

/** Nút Đóng cưỡng bức: chỉ ca ĐANG MỞ và người xem là admin hoặc có quyền "Đóng cưỡng bức ca làm việc". */
export function canForceClose(status: number, isAdmin: boolean, hasRight: (code: number) => boolean): boolean {
  if (status !== 1) return false
  return isAdmin || hasRight(SHIFT_RIGHTS.FORCE_CLOSE)
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
  const openTime = toText(r.openTime)
  const revenue = toNumber(r.revenue)
  return {
    shiftId: toNumber(r.shiftId),
    staffId: toNumber(r.staffId),
    staffName: toText(r.staffName),
    status,
    openTime,
    closeTime: status === 1 || closeTime === '' ? null : closeTime,
    openingCash: toNumber(r.openingCash),
    revenue,
    // Máy chủ cũ (trước S3-fix) không có `revenueOnDate` ⇒ lấy doanh thu cả ca, đúng khi ca không qua đêm.
    revenueOnDate: toNumber(r.revenueOnDate, revenue),
    crossDay: normalizeCrossDay(r.crossDay, openTime, status === 1 || closeTime === '' ? null : closeTime),
    expectedCash: toNullableNumber(r.expectedCash),
    countedCash: toNullableNumber(r.countedCash),
    cashDiff: toNullableNumber(r.cashDiff),
    note: toText(r.note),
    drift: status === 1 ? null : normalizeDrift(r.drift),
    hung: r.hung === true || r.hung === 1 || r.hung === '1',
  }
}

const dayOf = (time: string) => /^(\d{4}-\d{2}-\d{2})/.exec(time.trim())?.[1] ?? ''

/** `crossDay = {openDate, closeDate|null}`; thiếu ⇒ suy từ giờ mở / giờ chốt của dòng. */
function normalizeCrossDay(raw: unknown, openTime: string, closeTime: string | null): ShiftListItem['crossDay'] {
  const r = asRecord(raw)
  const openDate = toText(r.openDate) || dayOf(openTime)
  const closeDateRaw = toText(r.closeDate)
  const closeDate = r.closeDate !== undefined ? (closeDateRaw === '' ? null : closeDateRaw) : closeTime ? dayOf(closeTime) || null : null
  return { openDate, closeDate }
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
  return {
    reportTotal,
    bucketTotal,
    diff: toNumber(r.diff, reportTotal - bucketTotal),
    excludedNoUser: normalizeBucket(r.excludedNoUser),
  }
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

/**
 * `/shift/reconcile` trả phiếu không gắn tài khoản người dùng. Design 14b D15 ghi `excludedNoUser {count,total}`, còn bảng hình
 * dạng ở handoff S3be ghi hai trường phẳng `excludedNoUser` (số phiếu) + `excludedNoUserTotal` ⇒ đọc được cả hai.
 */
function normalizeExcludedNoUser(r: Record<string, unknown>): ShiftBucket {
  if (r.excludedNoUser && typeof r.excludedNoUser === 'object') return normalizeBucket(r.excludedNoUser)
  return { count: toNumber(r.excludedNoUser), total: toNumber(r.excludedNoUserTotal) }
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
    excludedNoUser: normalizeExcludedNoUser(r),
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
  // `total` = số PHIẾU của ô; `sumAmount` = tổng tiền (thiếu ⇒ cộng các dòng đang có, chỉ đúng khi chưa phân trang).
  return {
    total: toNumber(r.total, items.length),
    sumAmount: toNumber(r.sumAmount, items.reduce((sum, item) => sum + item.amount, 0)),
    items,
  }
}

function normalizeStockRow(raw: unknown): ShiftStockRow {
  const r = asRecord(raw)
  // `open` = null khi nguyên liệu không có ảnh chụp đầu ca (ca cũ / nguyên liệu mới) — không đổi thành 0 vì sẽ tính sai chênh lệch.
  const open = toNullableNumber(r.open)
  // Ca đã đóng ⇒ `close`; ca còn mở ⇒ `current` (máy chủ chỉ trả MỘT trong hai) — cùng một vai trò "cuối kỳ".
  const close = toNumber(r.close !== undefined ? r.close : r.current)
  return {
    materialId: toNumber(r.materialId),
    name: toText(r.name),
    unit: toText(r.unit),
    open,
    close,
    delta: open === null ? toNullableNumber(r.delta) : toNumber(r.delta, close - open),
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
    openSnapshot: r.openSnapshot !== false && r.openSnapshot !== 0,
    closeSnapshot: r.closeSnapshot !== false && r.closeSnapshot !== 0,
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
  /** Số ca qua đêm (mở từ ngày trước ngày đang xem — còn mở hoặc đã chốt) có mặt trong danh sách. */
  carriedOver: number
  /** Tổng doanh thu PHẦN THUỘC NGÀY của các ca trong danh sách (không gồm Thu ngoài ca). */
  revenueTotal: number
  /** Số ca đã đóng mà số liệu đã đổi sau khi chốt (`drift` khác 0). */
  driftCount: number
}

export function summarizeDay(shifts: readonly ShiftListItem[], date: string): DayTotals {
  return {
    shiftCount: shifts.length,
    openCount: shifts.filter((s) => s.status === 1).length,
    hungCount: shifts.filter((s) => s.status === 1 && s.hung).length,
    carriedOver: shifts.filter((s) => s.crossDay.openDate !== '' && s.crossDay.openDate < date).length,
    // Chỉ phần doanh thu thuộc ngày đang xem (ca qua đêm hiện ở cả ngày mở và ngày chốt, mỗi ngày một phần) ⇒ cộng các dòng
    // + Thu ngoài ca = báo cáo doanh thu ngày.
    revenueTotal: shifts.reduce((sum, s) => sum + s.revenueOnDate, 0),
    driftCount: shifts.filter((s) => hasDrift(s.drift)).length,
  }
}

/** "2026-11-21" -> "21/11"; không khớp thì giữ nguyên. */
export function formatDayMonth(ymd: string): string {
  const m = /^\d{4}-(\d{2})-(\d{2})$/.exec(ymd)
  return m ? `${m[2]}/${m[1]}` : ymd
}

export type ShiftDayView = {
  /** Ca chạm tới nhiều hơn một ngày (qua đêm). */
  crossesDays: boolean
  /** Ca còn kéo sang sau ngày đang xem ⇒ tiền đầu ca / đếm / chênh lệch CHƯA chốt ở dòng này (chỉ hiện đủ ở dòng ngày chốt). */
  continuesAfter: boolean
  /** Ghi chú dưới tên ca; rỗng nếu ca nằm gọn trong ngày. */
  note: string
}

/**
 * Cách một ca hiện trong danh sách của ngày `date` (design 14b D16: ca qua đêm hiện ở MỌI ngày chạm tới).
 * Ca đang mở mà ngày xem là hôm nay thì tiền mặt dự kiến hiện tại có nghĩa ⇒ không coi là "còn kéo sang sau".
 */
export function shiftDayView(item: Pick<ShiftListItem, 'crossDay'>, date: string, today: string = todayYmd()): ShiftDayView {
  const { openDate, closeDate } = item.crossDay
  const continuesAfter = closeDate !== null ? closeDate > date : date < today
  const startedBefore = openDate !== '' && openDate < date
  const crossesDays = closeDate !== null ? openDate !== closeDate : startedBefore || continuesAfter
  let note = ''
  if (continuesAfter) {
    note = closeDate !== null ? `Ca qua đêm, chốt ngày ${formatDayMonth(closeDate)}` : 'Ca qua đêm, chưa chốt'
  } else if (startedBefore) {
    note = `Ca qua đêm, mở từ ngày ${formatDayMonth(openDate)}`
  }
  return { crossesDays, continuesAfter, note }
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
    excludedNoUser: list.reconcile.excludedNoUser,
    orphans: [],
    duplicates: [],
  }
}

/**
 * Dựng `ShiftCloseResult` từ một dòng danh sách + tóm tắt để tái dùng `buildCloseTicketHtml` (phiếu của F1) cho ca ĐÃ ĐÓNG
 * ở trang quản lý. Ghi chú lấy từ `note` của dòng danh sách (ca đóng cưỡng bức: lý do quản lý nhập).
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
      // Ca đóng cưỡng bức vẫn phải ghi rõ trên phiếu in dù máy chủ không có ghi chú.
      note: item.note || (item.status === 3 ? 'Đóng cưỡng bức bởi quản lý' : ''),
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
