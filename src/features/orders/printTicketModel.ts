// task staff-service-order (FE-2) — logic thuần của nút "In phiếu" theo đơn. Tách khỏi component để test
// bằng `node --test` (tests/print-ticket-model.test.ts). KHÔNG dựng ESC/POS: phiếu là HTML → bitmap ở
// browser (`browserHtmlRaster`) → `/printer/print` có sẵn (handoff §4.3).
import type { PrintTargetItem, PrintTargetPrinter, PrintTargetsResponse } from '../../api/orders.ts'
import { GUEST_HOST_NAME, GUEST_USER_NAME } from './staffOrderModel.ts'

/** `/printer/print` từ WebUI chỉ nhận bitmap tới 4096 dòng. */
export const MAX_TICKET_ROWS = 4096

export type PrinterPaper = { type: 1 | 2; label: string; widthDots: 576 | 384 }

/**
 * `printertb.Type` = KHỔ GIẤY (DAOPrinter.h:14, define.h `TypeOfPrinter`): 1 = POS80 (576 dot),
 * 2 = POS58 (384 dot), 0 = A4/không phải máy in nhiệt. Khớp `browserHtmlRaster.PAPER` và
 * `PrinterSettingsPage` — KHÔNG dùng `paperWidth` BE-2 trả (đang đảo 384/576).
 */
export function printerPaper(type: number): PrinterPaper | null {
  if (type === 1) return { type: 1, label: 'POS 80 mm', widthDots: 576 }
  if (type === 2) return { type: 2, label: 'POS 58 mm', widthDots: 384 }
  return null
}

export type PrinterSplit = {
  /** In được từ WebUI: khổ nhiệt + có IP. */
  printable: PrintTargetPrinter[]
  /** Nhóm riêng "Máy in không hỗ trợ in từ Web" — tách khỏi `unrouted` để phiếu bếp không mất im lặng. */
  unsupported: Array<{ printer: PrintTargetPrinter; reason: string }>
}

export function unsupportedReason(printer: PrintTargetPrinter) {
  if (!printerPaper(printer.type)) return 'Không phải máy in nhiệt POS 58/80 — chỉ in được từ phần mềm quầy.'
  if (!printer.hasIp) return 'Chưa có địa chỉ IP — chỉ in được qua trình điều khiển Windows của phần mềm quầy.'
  return 'Không hỗ trợ in từ Web.'
}

export function splitPrinters(response: Pick<PrintTargetsResponse, 'printers'>): PrinterSplit {
  const printable: PrintTargetPrinter[] = []
  const unsupported: PrinterSplit['unsupported'] = []
  for (const printer of response.printers) {
    if (printer.printable && printerPaper(printer.type)) printable.push(printer)
    else unsupported.push({ printer, reason: unsupportedReason(printer) })
  }
  return { printable, unsupported }
}

export function escapeHtml(value: string) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function formatTicketMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

/** "YYYY-MM-DD" → "dd/mm/yyyy"; giá trị lạ giữ nguyên. */
export function formatTicketDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

export function ticketCustomerLabel(header: Pick<PrintTargetsResponse['header'], 'userName' | 'hostName'>) {
  const name = header.userName.trim()
  return !name || name.toLocaleUpperCase('vi') === GUEST_USER_NAME ? 'Khách vãng lai' : name
}

export function ticketHostLabel(header: Pick<PrintTargetsResponse['header'], 'hostName'>) {
  const host = header.hostName.trim()
  if (!host || host.toLocaleUpperCase('vi') === GUEST_HOST_NAME || host.toLocaleUpperCase('vi') === GUEST_USER_NAME)
    return 'Tại quầy'
  return host
}

export function ticketTotal(items: readonly PrintTargetItem[]) {
  return items.reduce((sum, item) => sum + item.amount, 0)
}

type TicketInput = {
  header: PrintTargetsResponse['header']
  printerName: string
  items: readonly PrintTargetItem[]
  type: 1 | 2
}

/**
 * HTML phiếu cho `renderPrinterHtml` (bố cục bảng + inline style, cùng kiểu mẫu in thử). Mỗi máy in
 * nhận phiếu RIÊNG chỉ gồm các món được gán cho máy đó. Mọi chuỗi từ DB đều qua `escapeHtml`.
 */
export function buildServiceTicketHtml({ header, printerName, items, type }: TicketInput) {
  const dots = '.'.repeat(type === 1 ? 46 : 32)
  const when = header.paidDate
    ? `Thu lúc: ${formatTicketDate(header.paidDate)} ${header.paidTime.slice(0, 5)}`
    : `Gọi lúc: ${formatTicketDate(header.orderDate)} ${header.orderTime.slice(0, 5)}`
  const row = (label: string, value: string) =>
    `<tr><td style="width:32%;">${escapeHtml(label)}</td><td style="width:68%;text-align:right;font-weight:700;">${escapeHtml(value)}</td></tr>`
  const lines = items
    .map(
      (item) => `
      <tr><td colspan="2" style="font-weight:700;">${escapeHtml(item.serviceName)}</td></tr>
      <tr><td>${escapeHtml(`${item.quantity}${item.unit ? ` ${item.unit}` : ''}`)}</td><td style="text-align:right;">${escapeHtml(formatTicketMoney(item.amount))}</td></tr>`,
    )
    .join('')
  return `
    <style>
      * { box-sizing: border-box; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      td { padding: 2px 0; font: 15px 'Segoe UI', Arial, sans-serif; overflow-wrap: break-word; }
      .divider { text-align: center; white-space: pre; font-size: 13px; }
    </style>
    <table>
      <tr><td colspan="2" style="padding:5px 0;text-align:center;font-size:18px;font-weight:700;">PHIẾU DỊCH VỤ</td></tr>
      <tr><td colspan="2" style="text-align:center;font-size:12px;">${escapeHtml(printerName)}</td></tr>
      <tr><td colspan="2" class="divider">${dots}</td></tr>
      ${row('Máy:', ticketHostLabel(header))}
      ${row('Khách:', ticketCustomerLabel(header))}
      ${header.voucherId > 0 ? row('Phiếu:', `#${header.voucherId}`) : ''}
      <tr><td colspan="2">${escapeHtml(when)}</td></tr>
      ${header.staffName ? row('Nhân viên:', header.staffName) : ''}
      <tr><td colspan="2" class="divider">${dots}</td></tr>
      ${lines}
      <tr><td colspan="2" class="divider">${dots}</td></tr>
      <tr><td style="font-weight:700;">Cộng:</td><td style="text-align:right;font-weight:700;font-size:17px;">${escapeHtml(formatTicketMoney(ticketTotal(items)))}</td></tr>
    </table>`
}

// ---------------------------------------------------------------------------------------------
// Kết quả từng máy in (PLAN_2.11: in lỗi KHÔNG rollback tiền, KHÔNG tự thử lại — chỉ bấm lại từng máy)
// ---------------------------------------------------------------------------------------------

export type PrinterJobState =
  | { status: 'idle' }
  | { status: 'printing' }
  | { status: 'done' }
  | { status: 'failed'; message: string; partiallySent: boolean }

export function describePrintFailure(error: unknown): { message: string; partiallySent: boolean } {
  const fallback = 'Không gửi được lệnh in.'
  if (!error || typeof error !== 'object') return { message: fallback, partiallySent: false }
  const candidate = error as { message?: unknown; details?: unknown }
  const details = (candidate.details && typeof candidate.details === 'object' ? candidate.details : {}) as {
    result?: unknown
    partiallySent?: unknown
  }
  const partiallySent = details.partiallySent === true
  let message = typeof candidate.message === 'string' && candidate.message ? candidate.message : fallback
  if (details.result === 'ConnectFailed') message = 'Không kết nối được máy in (tắt nguồn, sai IP hoặc mất mạng).'
  if (partiallySent) message += ' Máy in có thể đã in một phần — kiểm tra giấy trước khi bấm in lại.'
  return { message, partiallySent }
}

/** Cho Promise.allSettled: `rejected` ⇒ failed, `fulfilled` ⇒ done. */
export function jobStateOf(result: PromiseSettledResult<unknown>): PrinterJobState {
  if (result.status === 'fulfilled') return { status: 'done' }
  const failure = describePrintFailure(result.reason)
  return { status: 'failed', ...failure }
}
