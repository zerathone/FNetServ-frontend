// task work-shift S2 (F1) — logic THUẦN của giao diện ca (không React, không fetch) để test bằng `node --test`
// (tests/shift-model.test.ts). Chuẩn hoá dữ liệu server, định dạng, kiểm số tiền, dựng HTML phiếu chốt ca.
import type {
  ShiftCloseResult,
  ShiftCurrent,
  ShiftInfo,
  ShiftLastClosed,
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
    return { enabled: false, mode: 0, serverTime: toText(r.serverTime), shift: null, lastClosed: null }
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
  }
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
    refund: { count: toNumber(refund.count), cash: toNumber(refund.cash), online: toNumber(refund.online) },
    totals,
    expectedCash: toNumber(r.expectedCash),
    refundsQrCanceled: normalizeCountTotal(r.refundsQrCanceled, 'total'),
    onlineBook: normalizeCountTotal(r.onlineBook, 'walletTotal'),
  }
}

/** `{count, <totalKey>}` hoặc null (máy chủ chưa có dữ liệu / không gửi). Chỉ ép số khi là đối tượng. */
function normalizeCountTotal<K extends string>(raw: unknown, totalKey: K): ({ count: number } & Record<K, number>) | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const r = raw as Record<string, unknown>
  return { count: toNumber(r.count), [totalKey]: toNumber(r[totalKey]) } as { count: number } & Record<K, number>
}

/** Đếm đơn chờ — nhận cả dạng số lẫn {count, amount} cho `qrPaidUnconfirmed`; bóc `data` lồng nếu có. */
export function normalizePendingCounts(raw: unknown): ShiftPendingCounts | null {
  let r = asRecord(raw)
  if (r.pendingService === undefined && r.pendingCombo === undefined && r.data) r = asRecord(r.data)
  if (r.pendingService === undefined && r.pendingCombo === undefined && r.qrPaidUnconfirmed === undefined) return null
  const qr = r.qrPaidUnconfirmed
  const qrRecord = asRecord(qr)
  return {
    pendingService: toNumber(r.pendingService),
    pendingCombo: toNumber(r.pendingCombo),
    qrPaidUnconfirmed:
      qr && typeof qr === 'object'
        ? { count: toNumber(qrRecord.count), amount: toNullableNumber(qrRecord.amount) }
        : { count: toNumber(qr), amount: null },
  }
}

export function hasPending(counts: ShiftPendingCounts | null | undefined): boolean {
  return Boolean(
    counts && (counts.pendingService > 0 || counts.pendingCombo > 0 || counts.qrPaidUnconfirmed.count > 0),
  )
}

/** Kết quả `/shift/close`: nhận dạng lồng {shift, summary, warnings} lẫn dạng phẳng. */
export function normalizeCloseResult(raw: unknown): ShiftCloseResult {
  const r = asRecord(raw)
  const shiftRaw = asRecord(r.shift && typeof r.shift === 'object' ? r.shift : r)
  const summaryRaw = r.summary && typeof r.summary === 'object' ? r.summary : r.sources ? r : null
  const summary = summaryRaw ? normalizeSummary(summaryRaw) : null
  const read = (key: string) => (shiftRaw[key] !== undefined ? shiftRaw[key] : r[key])
  return {
    alreadyClosed: r.alreadyClosed === true,
    shift: {
      ...normalizeShiftInfo(shiftRaw),
      closeTime: toText(read('closeTime')),
      countedCash: toNullableNumber(read('countedCash')),
      expectedCash: toNullableNumber(read('expectedCash')) ?? summary?.expectedCash ?? null,
      cashDiff: toNullableNumber(read('cashDiff')),
      note: toText(read('note')),
    },
    summary,
    warnings: normalizePendingCounts(r.warnings),
  }
}

/**
 * Hợp đồng S1 không quy định chắc hình dạng response của /shift/close ⇒ điền các trường định danh của ca còn thiếu từ ca
 * mà client đang giữ (cùng một ca nên tiền đầu ca không thể khác). Chỉ ghi đè khi server không gửi / gửi id khác 0 trùng.
 */
export function fillCloseFromSnapshot(result: ShiftCloseResult, snapshot: ShiftInfo): ShiftCloseResult {
  const same = result.shift.shiftId <= 0 || result.shift.shiftId === snapshot.shiftId
  if (!same) return result
  return {
    ...result,
    shift: {
      ...result.shift,
      shiftId: snapshot.shiftId,
      staffId: result.shift.staffId || snapshot.staffId,
      staffName: result.shift.staffName || snapshot.staffName,
      openTime: result.shift.openTime || snapshot.openTime,
      openingCash: snapshot.openingCash,
    },
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
    if (summary.refund.count > 0 || summary.refund.cash !== 0 || summary.refund.online !== 0) {
      rows.push(receiptRow('Hoàn tiền:', formatReceiptNumber(summary.refund.cash + summary.refund.online)))
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
