// task work-shift S2 (F1) — logic THUẦN của giao diện ca (không React, không fetch) để test bằng `node --test`
// (tests/shift-model.test.ts). Chuẩn hoá dữ liệu server, định dạng, kiểm số tiền, dựng HTML phiếu chốt ca.
import type {
  ShiftCloseResult,
  ShiftCurrent,
  ShiftInfo,
  ShiftIntakePending,
  ShiftLastClosed,
  ShiftDrift,
  ShiftModeSetting,
  ShiftOnlineBook,
  ShiftOrderPause,
  ShiftPendingCounts,
  ShiftSource,
  ShiftSummary,
  ShiftTotals,
} from '../../api/shift.ts'
import type { PendingOrder } from '../../api/orders.ts'
import {
  RECEIPT_STYLE,
  escapeReceiptHtml,
  formatReceiptDateTime,
  formatReceiptNumber,
  receiptDivider,
  receiptRow,
  receiptTitle,
} from '../printers/posPrintModel.ts'

/** Khớp validate server (S1 §4.2): số nguyên 0 … 10.000.000.000. */
export const MAX_SHIFT_CASH = 10_000_000_000
/** Ghi chú chốt ca tối đa 500 ký tự (S1 §4.2). */
export const MAX_SHIFT_NOTE = 500

// ---------------------------------------------------------------------------------------------
// Chuẩn hoá dữ liệu server (hợp đồng S1 — có thể lệch nhẹ nên đọc phòng thủ, không ném)
// ---------------------------------------------------------------------------------------------

export function toNumber(value: unknown, fallback = 0): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : fallback
  }
  return fallback
}

export function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null
  const parsed = toNumber(value, Number.NaN)
  return Number.isNaN(parsed) ? null : parsed
}

export function toText(value: unknown): string {
  return typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value)
}

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function normalizeShiftInfo(raw: unknown): ShiftInfo {
  const r = asRecord(raw)
  return {
    shiftId: toNumber(r.shiftId),
    staffId: toNumber(r.staffId),
    staffName: toText(r.staffName),
    status: toNumber(r.status, 1),
    openTime: toText(r.openTime),
    openingCash: toNumber(r.openingCash),
  }
}

function normalizeLastClosed(raw: unknown): ShiftLastClosed | null {
  if (!raw || typeof raw !== 'object') return null
  const r = asRecord(raw)
  const counted = toNullableNumber(r.countedCash)
  if (counted === null) return null // chỉ ca có tiền thực đếm mới là "tiền bàn giao"
  return {
    shiftId: toNumber(r.shiftId),
    staffName: toText(r.staffName),
    closeTime: toText(r.closeTime),
    countedCash: counted,
  }
}

export function normalizeCurrent(raw: unknown): ShiftCurrent {
  const r = asRecord(raw)
  const mode = toNumber(r.mode, 0)
  const enabled = r.enabled === true && mode >= 1
  if (!enabled) {
    // mode 0 ⇒ không có khái niệm ngừng nhận đơn (máy chủ trả SHIFT_DISABLED cho pause/resume): bỏ qua orderPause.
    return { enabled: false, mode: 0, serverTime: toText(r.serverTime), shift: null, lastClosed: null, orderPause: null }
  }
  const parsedShift = r.shift && typeof r.shift === 'object' ? normalizeShiftInfo(r.shift) : null
  // Ca không có shiftId hợp lệ (dữ liệu hỏng) coi như chưa có ca — không dựng "Ca #0".
  const shift = parsedShift && parsedShift.shiftId > 0 ? parsedShift : null
  return {
    enabled: true,
    mode,
    serverTime: toText(r.serverTime),
    shift,
    lastClosed: shift ? null : normalizeLastClosed(r.lastClosed),
    orderPause: normalizeOrderPause(r.orderPause),
  }
}

// ---------------------------------------------------------------------------------------------
// Ngừng / Tiếp tục nhận đơn (task S3b-FE) — design mục 8b. Trạng thái toàn hệ thống, sống qua chốt ca (Q8).
// ---------------------------------------------------------------------------------------------

/** Lý do tối đa 40 ký tự (khớp server `INT_ORDER_PAUSE.r`). */
export const MAX_PAUSE_REASON = 40
/** Q10: ngừng quá 30 phút thì banner nhấn mạnh + nhắc một lần (chỉ nhắc, không tự tiếp tục). */
export const PAUSE_REMIND_MINUTES = 30

const NO_PENDING: ShiftIntakePending = { service: 0, combo: 0, qrPaid: 0 }

function normalizeIntakePending(raw: unknown): ShiftIntakePending {
  const r = asRecord(raw)
  return {
    service: Math.max(0, toNumber(r.service)),
    combo: Math.max(0, toNumber(r.combo)),
    qrPaid: Math.max(0, toNumber(r.qrPaid)),
  }
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/**
 * `orderPause` của `/shift/current` — hợp đồng đã chốt 2026-11-21:
 * `{on, manual:{on, since, byStaffId, byName, reason}, noShift, pendingOrders:{service, combo, qrPaid}}`.
 * Thiếu / sai kiểu ⇒ null (máy chủ cũ hoặc chế độ ca tắt: coi như không có tính năng).
 */
export function normalizeOrderPause(raw: unknown): ShiftOrderPause | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = asRecord(raw)
  const manual = asRecord(r.manual)
  const manualOn = isTruthyFlag(manual.on)
  return {
    on: isTruthyFlag(r.on),
    manual: {
      on: manualOn,
      since: manualOn ? toText(manual.since) : '',
      byStaffId: toNumber(manual.byStaffId),
      byName: toText(manual.byName),
      reason: toText(manual.reason).trim(),
    },
    noShift: isTruthyFlag(r.noShift),
    pendingOrders: normalizeIntakePending(r.pendingOrders ?? NO_PENDING),
  }
}

/** Phản hồi `/orders/intake/pause|resume`: `{changed, orderPause}` (cùng hình dạng `/shift/current.orderPause`). */
export function normalizeOrderPauseResponse(raw: unknown): { changed: boolean; orderPause: ShiftOrderPause | null } {
  const r = asRecord(raw)
  return { changed: isTruthyFlag(r.changed), orderPause: normalizeOrderPause(r.orderPause) }
}

/** Chế độ ca hợp lệ 0 | 1 | 2; ngoài khoảng ⇒ 0 (tắt — hướng an toàn). `changed` chỉ có ở phản hồi PUT. */
export function normalizeShiftModeSetting(raw: unknown): ShiftModeSetting {
  const r = asRecord(raw)
  const clamp = (value: number) => (Number.isInteger(value) && value >= 0 && value <= 2 ? value : 0)
  const mode = clamp(toNumber(r.mode))
  return {
    mode,
    effective: clamp(toNumber(r.effective, mode)),
    ...(r.enabled !== undefined ? { enabled: isTruthyFlag(r.enabled) } : {}),
    ...(r.changed !== undefined ? { changed: isTruthyFlag(r.changed) } : {}),
  }
}

/** Trạng thái CHẶN hiệu lực (`on` do máy chủ quyết, đã tính cả chế độ ca) — nút Tạo đơn khoá theo cờ này. */
export function isIntakePaused(orderPause: ShiftOrderPause | null | undefined): boolean {
  return orderPause?.on === true
}

/** Cờ do người bấm Ngừng (kiểm kho) còn bật — chỉ cờ này mới có nút "Tiếp tục nhận đơn" và câu hỏi ở Dialog Mở ca. */
export function isManualPaused(orderPause: ShiftOrderPause | null | undefined): boolean {
  return orderPause?.manual.on === true
}

/** Không còn ca nào mở nhưng KHÔNG chặn (chế độ 1 — ghi sổ): chỉ cảnh báo, không khoá nút. */
export function isNoShiftWarningOnly(orderPause: ShiftOrderPause | null | undefined): boolean {
  return Boolean(orderPause && orderPause.noShift && !orderPause.on)
}

/** "YYYY-MM-DD HH:MM:SS" -> mili-giây (coi như UTC — chỉ để TRỪ hai mốc cùng múi giờ máy chủ). Sai định dạng ⇒ null. */
export function parseServerStamp(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value.trim())
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6] ?? 0))
}

/**
 * Số phút đã ngừng. Dùng GIỜ MÁY CHỦ (`serverTime` lúc tải /shift/current + thời gian đã trôi từ lúc tải) để không phụ thuộc
 * đồng hồ trình duyệt lệch. Không tính được ⇒ null.
 */
export function pauseElapsedMinutes(since: string, serverTime: string, fetchedAtMs: number, nowMs: number): number | null {
  const sinceMs = parseServerStamp(since)
  const serverMs = parseServerStamp(serverTime)
  if (sinceMs === null || serverMs === null || fetchedAtMs <= 0) return null
  const elapsedMs = serverMs - sinceMs + Math.max(0, nowMs - fetchedAtMs)
  return Math.max(0, Math.floor(elapsedMs / 60_000))
}

export function isPauseOverdue(minutes: number | null): boolean {
  return minutes !== null && minutes >= PAUSE_REMIND_MINUTES
}

/** 45 -> "45 phút"; 65 -> "1 giờ 05 phút"; 120 -> "2 giờ". */
export function formatElapsed(minutes: number): string {
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} giờ` : `${hours} giờ ${String(rest).padStart(2, '0')} phút`
}

/** "YYYY-MM-DD HH:MM:SS" -> "HH:mm"; không khớp thì giữ nguyên. */
export function formatClock(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
  return match ? `${match[4]}:${match[5]}` : value
}

/**
 * Dòng chính của banner. Cờ thủ công thắng (người ca sau cần thấy ai ngừng): "Đang ngừng nhận đơn từ 10:02 · A · Lý do: …".
 * Không có cờ thủ công mà vẫn chặn (`noShift` + chế độ 2): "Chưa có ca nào mở — đang ngừng nhận đơn". Chế độ 1: chỉ nhắc.
 */
export function pauseHeadline(pause: ShiftOrderPause): string {
  const { manual } = pause
  if (manual.on) {
    const parts = [`Đang ngừng nhận đơn${manual.since ? ` từ ${formatClock(manual.since)}` : ''}`]
    if (manual.byName) parts.push(manual.byName)
    if (manual.reason) parts.push(`Lý do: ${manual.reason}`)
    return parts.join(' · ')
  }
  return pause.on ? 'Chưa có ca nào mở — đang ngừng nhận đơn' : 'Chưa có ca nào đang mở'
}

export type PauseChipText = {
  /** Chữ gọn cho màn hẹp — luôn giữ ý chính, không cắt cụt. */
  short: string
  /** Chữ đầy đủ cho màn rộng (kèm giờ ngừng + tên người ngừng). */
  long: string
  /** Giải thích đầy đủ (title): lý do, thời gian đã ngừng, việc vẫn dùng được. */
  tooltip: string
}

/**
 * Chữ của khối cảnh báo ở thanh trên cùng (topbar). Ba trường hợp khớp `pauseHeadline`: cờ thủ công, "không có ca" bị chặn
 * (chế độ Bắt buộc), "không có ca" chỉ nhắc (chế độ Ghi sổ). `minutes` = số phút đã ngừng (null nếu không tính được).
 */
export function pauseChipText(pause: ShiftOrderPause, minutes: number | null): PauseChipText {
  const { manual } = pause
  if (manual.on) {
    const long = `Đang ngừng nhận đơn${manual.since ? ` từ ${formatClock(manual.since)}` : ''}${manual.byName ? ` · ${manual.byName}` : ''}`
    const lines = [pauseHeadline(pause)]
    if (minutes !== null) lines.push(`Đã ngừng ${formatElapsed(minutes)}.`)
    lines.push('Duyệt, hủy và thu đơn đã có vẫn dùng được.')
    if (isPauseOverdue(minutes)) lines.push('Kiểm kho xong thì bấm Tiếp tục nhận đơn để khách gọi món lại.')
    return { short: 'Đang ngừng nhận đơn', long, tooltip: lines.join(' ') }
  }
  if (pause.on) {
    return {
      short: 'Đang ngừng nhận đơn',
      long: 'Chưa có ca nào mở — đang ngừng nhận đơn',
      tooltip: 'Chưa có ca nào mở nên quán đang ngừng nhận đơn. Ca đầu tiên được mở thì quán nhận đơn trở lại.',
    }
  }
  return {
    short: 'Chưa có ca nào mở',
    long: 'Chưa có ca nào đang mở',
    tooltip: 'Quán vẫn nhận đơn, nhưng khoản thu lúc này chưa thuộc ca nào. Hãy mở ca để ghi doanh thu đúng ca.',
  }
}

/** Câu hỏi ở Dialog Mở ca (Q8): "Đang ngừng nhận đơn từ 10:02 (bởi A). Tiếp tục nhận đơn?" — dựa vào `manual`. */
export function pauseResumeQuestion(pause: ShiftOrderPause): string {
  const from = pause.manual.since ? ` từ ${formatClock(pause.manual.since)}` : ''
  const by = pause.manual.byName ? ` (bởi ${pause.manual.byName})` : ''
  return `Đang ngừng nhận đơn${from}${by}. Tiếp tục nhận đơn?`
}

/** Số đơn đang chờ dạng chữ để nhắc trước khi ngừng; không có đơn nào ⇒ chuỗi rỗng. */
export function describeIntakePending(pending: ShiftIntakePending): string {
  const parts: string[] = []
  if (pending.service > 0) parts.push(`${pending.service} món chờ duyệt`)
  if (pending.combo > 0) parts.push(`${pending.combo} combo chờ xác nhận`)
  if (pending.qrPaid > 0) parts.push(`${pending.qrPaid} đơn QR đã trả chưa xác nhận`)
  return parts.join(', ')
}

/** Lý do ngừng nhận đơn: ≤ 40 ký tự, không `'` `\` (server `isSqlSafeText`); ký tự điều khiển đã bị `sanitizeNoteInput` đổi thành khoảng trắng. */
export function validatePauseReason(value: string): string | undefined {
  if (value.length > MAX_PAUSE_REASON) return `Lý do tối đa ${MAX_PAUSE_REASON} ký tự.`
  if (/['\\]/.test(value)) return "Lý do không dùng dấu nháy đơn (') hoặc gạch chéo ngược (\\)."
  return undefined
}

/** Tổng các nguồn: `total` = tiền mặt + chuyển khoản + QR, KHÔNG cộng cấn trừ (Q16b). */
export function sumSources(sources: readonly ShiftSource[]): ShiftTotals {
  const totals: ShiftTotals = { count: 0, cash: 0, online: 0, qr: 0, deduct: 0, total: 0 }
  for (const source of sources) {
    totals.count += source.count
    totals.cash += source.cash
    totals.online += source.online
    totals.qr += source.qr
    totals.deduct += source.deduct
  }
  totals.total = totals.cash + totals.online + totals.qr
  return totals
}

function normalizeSource(raw: unknown, index: number): ShiftSource {
  const r = asRecord(raw)
  const cash = toNumber(r.cash)
  const online = toNumber(r.online)
  const qr = toNumber(r.qr)
  return {
    key: toText(r.key) || String(index),
    name: toText(r.name) || `Nguồn ${index + 1}`,
    count: toNumber(r.count),
    cash,
    online,
    qr,
    deduct: toNumber(r.deduct),
    // Số server tính là số chốt; chỉ tự cộng khi server không gửi (không bao giờ gồm cấn trừ).
    total: toNumber(r.total, cash + online + qr),
  }
}

export function normalizeSummary(raw: unknown): ShiftSummary {
  const r = asRecord(raw)
  const sources = (Array.isArray(r.sources) ? r.sources : []).map(normalizeSource)
  const refund = asRecord(r.refund)
  const totalsRaw = asRecord(r.totals)
  const fallback = sumSources(sources)
  const totals: ShiftTotals =
    Object.keys(totalsRaw).length > 0
      ? {
          count: toNumber(totalsRaw.count, fallback.count),
          cash: toNumber(totalsRaw.cash, fallback.cash),
          online: toNumber(totalsRaw.online, fallback.online),
          qr: toNumber(totalsRaw.qr, fallback.qr),
          deduct: toNumber(totalsRaw.deduct, fallback.deduct),
          total: toNumber(totalsRaw.total, fallback.total),
        }
      : fallback
  return {
    sources,
    refund: {
      count: toNumber(refund.count),
      cash: toNumber(refund.cash),
      online: toNumber(refund.online),
      qr: toNumber(refund.qr),
    },
    totals,
    expectedCash: toNumber(r.expectedCash),
    refundsQrCanceled: normalizeCountTotal(r.refundsQrCanceled, 'total'),
    onlineBook: normalizeOnlineBook(r.onlineBook),
    drift: normalizeDrift(r.drift),
  }
}

/**
 * `onlineBook = {count, walletTotal, creditCount, creditTotal, netTotal}` (design 14b D20). Thiếu trường hoàn ví (máy chủ cũ)
 * ⇒ 0; thiếu `netTotal` ⇒ `walletTotal − creditTotal`. Không phải đối tượng ⇒ null (máy chủ không có số liệu).
 */
export function normalizeOnlineBook(raw: unknown): ShiftOnlineBook | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = asRecord(raw)
  const walletTotal = toNumber(r.walletTotal)
  const creditTotal = toNumber(r.creditTotal)
  return {
    count: toNumber(r.count),
    walletTotal,
    creditCount: toNumber(r.creditCount),
    creditTotal,
    netTotal: toNumber(r.netTotal, walletTotal - creditTotal),
  }
}

/** `drift = {total, cash}` của ca đã đóng. Không phải đối tượng ⇒ null. */
export function normalizeDrift(raw: unknown): ShiftDrift | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = asRecord(raw)
  return { total: toNumber(r.total), cash: toNumber(r.cash) }
}

/** Có lệch thật (khác 0 ở tổng hoặc tiền mặt) ⇒ phải cảnh báo "Số liệu đã thay đổi sau khi chốt ca". */
export function hasDrift(drift: ShiftDrift | null | undefined): drift is ShiftDrift {
  return Boolean(drift && (drift.total !== 0 || drift.cash !== 0))
}

/**
 * Câu mô tả drift. `drift = số chụp lúc chốt − số tính lại hiện tại`: dương ⇒ số hiện tại THẤP hơn số lúc chốt
 * (phiếu bị hủy/sửa giảm sau chốt), âm ⇒ cao hơn.
 */
export function describeDrift(drift: ShiftDrift): string[] {
  const line = (label: string, value: number) =>
    value === 0 ? '' : `${label} tính lại hiện ${value > 0 ? 'thấp' : 'cao'} hơn số lúc chốt ${formatMoney(Math.abs(value))}.`
  return [line('Doanh thu', drift.total), line('Tiền mặt', drift.cash)].filter(Boolean)
}

/**
 * `/shift/summary` thật trả LỒNG `{live, shift, summary, refundsQrCanceled, onlineBook, drift?}` — các trường thêm nằm CÙNG CẤP
 * với `summary` (xác nhận ở "Kết quả thực hiện" của S3be; riêng `drift` design 14b D17 chỉ ghi "ở /shift/summary" nên vẫn đọc
 * dự phòng cả trong `summary`). `summary` = null khi ca đã đóng mà bản chụp hỏng/thiếu ⇒ trả null để nơi gọi báo lỗi thay vì
 * hiện "chưa có khoản thu" sai.
 */
export function normalizeSummaryResponse(raw: unknown): ShiftSummary | null {
  const r = asRecord(raw)
  if (!r.summary || typeof r.summary !== 'object') return null
  const inner = asRecord(r.summary)
  return normalizeSummary({
    ...inner,
    refundsQrCanceled: r.refundsQrCanceled,
    onlineBook: r.onlineBook,
    drift: r.drift !== undefined ? r.drift : inner.drift,
  })
}

/** `{count, <totalKey>}` hoặc null (máy chủ chưa có dữ liệu / không gửi). Chỉ ép số khi là đối tượng. */
function normalizeCountTotal<K extends string>(raw: unknown, totalKey: K): ({ count: number } & Record<K, number>) | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  return { count: toNumber(r.count), [totalKey]: toNumber(r[totalKey]) } as { count: number } & Record<K, number>
}

/**
 * Số đơn chờ của `SHIFT_PENDING_ORDERS` (đọc từ `ApiError.details` = `data` cùng cấp `code`) và của `warnings` (S1, D7):
 * `{pendingService, pendingCombo, qrPaidUnconfirmed (số đơn), qrPaidAmount (tổng tiền)}`. Không có trường nào ⇒ null.
 */
export function normalizePendingCounts(raw: unknown): ShiftPendingCounts | null {
  const r = asRecord(raw)
  if (r.pendingService === undefined && r.pendingCombo === undefined && r.qrPaidUnconfirmed === undefined) return null
  return {
    pendingService: toNumber(r.pendingService),
    pendingCombo: toNumber(r.pendingCombo),
    qrPaidUnconfirmed: toNumber(r.qrPaidUnconfirmed),
    qrPaidAmount: toNumber(r.qrPaidAmount),
  }
}

export function hasPending(counts: ShiftPendingCounts | null | undefined): boolean {
  return Boolean(counts && (counts.pendingService > 0 || counts.pendingCombo > 0 || counts.qrPaidUnconfirmed > 0))
}

/** Kết quả `/shift/close` (và `/shift/force-close`): `{alreadyClosed, shift{đủ trường}, summary|null, warnings?}`. */
export function normalizeCloseResult(raw: unknown): ShiftCloseResult {
  const r = asRecord(raw)
  const shiftRaw = asRecord(r.shift)
  const summary = r.summary && typeof r.summary === 'object' ? normalizeSummary(r.summary) : null
  return {
    alreadyClosed: r.alreadyClosed === true,
    shift: {
      ...normalizeShiftInfo(shiftRaw),
      closeTime: toText(shiftRaw.closeTime),
      countedCash: toNullableNumber(shiftRaw.countedCash),
      expectedCash: toNullableNumber(shiftRaw.expectedCash) ?? summary?.expectedCash ?? null,
      cashDiff: toNullableNumber(shiftRaw.cashDiff),
      note: toText(shiftRaw.note),
    },
    summary,
    warnings: normalizePendingCounts(r.warnings),
  }
}

// ---------------------------------------------------------------------------------------------
// Ghi chú chốt ca: server dùng isSqlSafeText (HttpHandlerCommon.cpp) — từ chối ' \ và mọi ký tự < 0x20 (kể cả xuống dòng)
// ---------------------------------------------------------------------------------------------

/** Xuống dòng / tab -> khoảng trắng (Enter không được tạo ký tự bị server từ chối). */
export function sanitizeNoteInput(value: string): string {
  return Array.from(value, (ch) => (ch.charCodeAt(0) < 0x20 ? ' ' : ch)).join('')
}

export function validateShiftNote(value: string): string | undefined {
  if (value.length > MAX_SHIFT_NOTE) return `Ghi chú tối đa ${MAX_SHIFT_NOTE} ký tự.`
  if (/['\\]/.test(value)) return "Ghi chú không dùng dấu nháy đơn (') hoặc gạch chéo ngược (\\)."
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Số tiền / định dạng
// ---------------------------------------------------------------------------------------------

export function formatMoney(value: number): string {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

/** Chênh lệch có dấu rõ ràng: "+10.000 đ", "−10.000 đ", "0 đ". */
export function formatSigned(value: number): string {
  const body = new Intl.NumberFormat('vi-VN').format(Math.abs(value))
  if (value > 0) return `+${body} đ`
  if (value < 0) return `−${body} đ`
  return '0 đ'
}

/** "YYYY-MM-DD HH:MM:SS" -> "HH:mm dd/MM" (widget); không khớp thì giữ nguyên. */
export function formatShiftTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
  return match ? `${match[4]}:${match[5]} ${match[3]}/${match[2]}` : value
}

/** "YYYY-MM-DD HH:MM:SS" -> "HH:mm dd/MM/yyyy". */
export function formatShiftDateTime(value: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
  return match ? `${match[4]}:${match[5]} ${match[3]}/${match[2]}/${match[1]}` : value
}

/** Tiền thực đếm − tiền dự kiến; chưa nhập thực đếm ⇒ null (chỉ để xem trước, số chốt là số server trả). */
export function cashDifference(counted: number | null, expected: number): number | null {
  return counted === null ? null : counted - expected
}

/** Thông báo lỗi dưới ô tiền; undefined = hợp lệ (ô trống = hợp lệ, hiểu là không nhập). */
export function validateCashInput(value: number | null, label: string): string | undefined {
  if (value === null) return undefined
  if (!Number.isInteger(value) || value < 0) return `${label} phải là số nguyên không âm.`
  if (value > MAX_SHIFT_CASH) return `${label} tối đa ${new Intl.NumberFormat('vi-VN').format(MAX_SHIFT_CASH)} đ.`
  return undefined
}

// ---------------------------------------------------------------------------------------------
// Đơn chờ duyệt (cảnh báo khi chốt ca) — đếm đúng như Hàng đợi: MÓN CHÍNH, bỏ dòng topping
// ---------------------------------------------------------------------------------------------

/** ServicePaid = 1: khách đã trả QR nhưng chưa ai xác nhận. */
const SERVICE_PAID_QR = 1

/** Cùng quy tắc `groupOrders` của Hàng đợi: dòng có parentId trỏ tới một món chính trong danh sách là topping. */
export function countPendingMainLines(orders: readonly PendingOrder[]): { mains: number; qrPaid: number } {
  const mainIds = new Set(orders.filter((o) => !o.parentId || o.parentId === 0).map((o) => o.serviceDetailId))
  const mains = orders.filter((o) => !o.parentId || o.parentId === 0 || !mainIds.has(o.parentId))
  return { mains: mains.length, qrPaid: mains.filter((o) => o.servicePaid === SERVICE_PAID_QR).length }
}

// ---------------------------------------------------------------------------------------------
// Phiếu chốt ca (HTML -> bitmap ở browser, in qua /printer/print). Chữ không viết tắt.
// ---------------------------------------------------------------------------------------------

export type CloseTicketInput = {
  shopName: string
  result: ShiftCloseResult
  type: 1 | 2
}

export function buildCloseTicketHtml({ shopName, result, type }: CloseTicketInput): string {
  const { shift, summary } = result
  const totals = summary?.totals
  const rows: string[] = [receiptTitle('PHIẾU CHỐT CA')]
  if (shopName.trim()) {
    rows.push(
      `<tr><td colspan="2" style="text-align:center;font-weight:700;">${escapeReceiptHtml(shopName.trim())}</td></tr>`,
    )
  }
  rows.push(receiptDivider(type))
  rows.push(receiptRow('Ca số:', `#${shift.shiftId}`, true))
  rows.push(receiptRow('Nhân viên:', shift.staffName || '-'))
  rows.push(receiptRow('Mở ca:', formatReceiptDateTime(shift.openTime) || '-'))
  rows.push(receiptRow('Chốt ca:', formatReceiptDateTime(shift.closeTime) || '-'))
  rows.push(receiptDivider(type))

  if (summary && totals) {
    rows.push(receiptRow('Tiền mặt:', formatReceiptNumber(totals.cash)))
    rows.push(receiptRow('Chuyển khoản:', formatReceiptNumber(totals.online)))
    rows.push(receiptRow('QR:', formatReceiptNumber(totals.qr)))
    for (const source of summary.sources) {
      if (source.count === 0 && source.total === 0) continue
      rows.push(receiptRow(`${source.name}:`, formatReceiptNumber(source.total)))
    }
    if (summary.refund.count > 0 || summary.refund.cash !== 0 || summary.refund.online !== 0 || summary.refund.qr !== 0) {
      rows.push(
        receiptRow('Hoàn tiền:', formatReceiptNumber(summary.refund.cash + summary.refund.online + summary.refund.qr)),
      )
    }
    rows.push(receiptRow('Doanh thu ca:', formatReceiptNumber(totals.total), true))
    rows.push(receiptDivider(type))
  }

  rows.push(receiptRow('Tiền đầu ca:', formatReceiptNumber(shift.openingCash)))
  if (shift.expectedCash !== null) rows.push(receiptRow('Tiền mặt dự kiến:', formatReceiptNumber(shift.expectedCash)))
  if (shift.countedCash !== null) {
    rows.push(receiptRow('Tiền thực đếm:', formatReceiptNumber(shift.countedCash), true))
    if (shift.cashDiff !== null) rows.push(receiptRow('Chênh lệch:', formatSigned(shift.cashDiff), true))
  } else {
    rows.push(receiptRow('Tiền thực đếm:', 'Không nhập'))
  }
  if (shift.note.trim()) rows.push(receiptRow('Ghi chú:', shift.note.trim()))
  rows.push(receiptDivider(type))
  // Chừa lề cuối để dao cắt không cắt vào dòng cuối.
  rows.push('<tr><td colspan="2" style="height:22px;padding:0;"></td></tr>')

  return `${RECEIPT_STYLE}<table>${rows.join('')}</table>`
}
