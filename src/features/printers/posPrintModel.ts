// task web-print-flows — logic thuần dùng chung cho phiếu in POS từ Web (thẻ combo, phiếu nạp tiền).
// Tách khỏi component để test bằng `node --test` (tests/pos-print-model.test.ts). KHÔNG dựng ESC/POS:
// phiếu là HTML → bitmap ở browser (`browserHtmlRaster`) → `/printer/print` có sẵn.
import type { CafeInfo } from '../../api/settings.ts'
import { printerPaper } from '../orders/printTicketModel.ts'

/** Phần của `Printer` (api/printer.ts) mà model cần — không import type đầy đủ để test dựng dữ liệu gọn. */
export type PosPrinterLike = {
  printerId?: number
  printerName: string
  type: number
  active: number
  ipAddress: string
}

export type PosPrintScope = 'combo' | 'deposit' | 'service'

export type PosPrintPrefs = {
  printerId?: number
  /** Ô "In thông tin phòng máy" (mỗi chỗ in tự cấu hình, mặc định bỏ tick — Qt `roomInfo`, MFC `cafe_info`). */
  roomInfo?: boolean
  /** Bật/tắt in (chỉ dùng cho nạp tiền, parity ô "In phiếu" của MFC). */
  enabled?: boolean
}

/** In được từ Web: máy đang hoạt động, có IP, khổ nhiệt POS 58/80. Máy driver Windows/A4 bị loại (đã bỏ ở 2.11). */
export function eligiblePosPrinters<T extends PosPrinterLike>(printers: readonly T[]): T[] {
  return printers.filter(
    (printer) =>
      printer.active === 1 &&
      Boolean(printer.printerId) &&
      printer.ipAddress.trim() !== '' &&
      printerPaper(printer.type) !== null,
  )
}

export function findPrinterByName<T extends PosPrinterLike>(printers: readonly T[], name: string): T | undefined {
  const wanted = name.trim().toLocaleLowerCase('vi')
  if (!wanted) return undefined
  return printers.find((printer) => printer.printerName.trim().toLocaleLowerCase('vi') === wanted)
}

/**
 * Chọn máy in: lần chọn trước (nếu còn hợp lệ) → máy trùng tên cấu hình sẵn (option 139 của MFC) → máy đầu tiên → 0.
 */
export function pickPrinterId<T extends PosPrinterLike>(
  eligible: readonly T[],
  preferredId: number | undefined,
  preferredName: string | undefined,
): number {
  if (preferredId && eligible.some((printer) => printer.printerId === preferredId)) return preferredId
  const byName = preferredName ? findPrinterByName(eligible, preferredName) : undefined
  if (byName?.printerId) return byName.printerId
  return eligible[0]?.printerId ?? 0
}

// ---------------------------------------------------------------------------------------------
// Ghi nhớ lựa chọn theo trình duyệt. Chỉ là tiện ích — KHÔNG phải nguồn sự thật (localStorage có thể throw/rỗng).
// ---------------------------------------------------------------------------------------------

type ReadableStorage = Pick<Storage, 'getItem'>
type WritableStorage = Pick<Storage, 'setItem'>

const prefsKey = (scope: PosPrintScope) => `fnet.print.${scope}`

export function readPosPrefs(scope: PosPrintScope, storage: ReadableStorage | null): PosPrintPrefs {
  try {
    const raw = storage?.getItem(prefsKey(scope))
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    if (!parsed || typeof parsed !== 'object') return {}
    const prefs: PosPrintPrefs = {}
    if (typeof parsed.printerId === 'number' && Number.isInteger(parsed.printerId) && parsed.printerId > 0) {
      prefs.printerId = parsed.printerId
    }
    if (typeof parsed.roomInfo === 'boolean') prefs.roomInfo = parsed.roomInfo
    if (typeof parsed.enabled === 'boolean') prefs.enabled = parsed.enabled
    return prefs
  } catch {
    return {}
  }
}

export function writePosPrefs(scope: PosPrintScope, prefs: PosPrintPrefs, storage: WritableStorage | null) {
  try {
    storage?.setItem(prefsKey(scope), JSON.stringify(prefs))
  } catch {
    // Chế độ riêng tư / bị chặn: bỏ qua, trang vẫn chạy.
  }
}

export function browserStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------------------------
// Mảnh HTML dùng chung (bố cục bảng + inline style, cùng kiểu `buildServiceTicketHtml` / mẫu in thử)
// ---------------------------------------------------------------------------------------------

export function escapeReceiptHtml(value: unknown) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export const RECEIPT_STYLE = `<style>
      * { box-sizing: border-box; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      td { padding: 2px 0; font: 15px 'Segoe UI', Arial, sans-serif; overflow-wrap: break-word; }
      .divider { text-align: center; white-space: pre; font-size: 13px; }
    </style>`

export function receiptDots(type: 1 | 2) {
  return '.'.repeat(type === 1 ? 46 : 32)
}

export function receiptTitle(text: string) {
  return `<tr><td colspan="2" style="padding:5px 0;text-align:center;font-size:18px;font-weight:700;">${escapeReceiptHtml(text)}</td></tr>`
}

export function receiptRow(label: string, value: string, bold = false) {
  return `<tr><td style="width:35%;">${escapeReceiptHtml(label)}</td><td style="width:65%;text-align:right;${bold ? 'font-weight:700;' : ''}">${escapeReceiptHtml(value)}</td></tr>`
}

export function receiptFullRow(text: string, bold = false) {
  return `<tr><td colspan="2" style="${bold ? 'font-weight:700;' : ''}">${escapeReceiptHtml(text)}</td></tr>`
}

export function receiptDivider(type: 1 | 2) {
  return `<tr><td colspan="2" class="divider">${receiptDots(type)}</td></tr>`
}

/** Số có dấu phẩy ngăn cách nghìn, KHÔNG kèm đơn vị — đúng định dạng phiếu Qt (`QLocale::English`). */
export function formatReceiptNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

/**
 * Khối "thông tin phòng máy" (Qt `generateData*`: dòng `****************`, tên đậm giữa, Địa chỉ / Điện thoại /
 * Website / Email). Chỉ gọi khi người dùng đã tick ô "In thông tin phòng máy". Luôn in đủ các dòng kể cả khi
 * giá trị đang trống (user chốt: thiếu thì để trống trên phiếu, không được tự ý bỏ dòng/bỏ cả khối).
 */
export function roomInfoRowsHtml(cafe: CafeInfo | null | undefined) {
  if (!cafe) return ''
  const rows: Array<[string, string]> = [
    ['Địa chỉ:', cafe.cafeAddress],
    ['Điện thoại:', cafe.cafePhone],
    ['Website:', cafe.cafePage],
    ['Email:', cafe.cafeEmail],
  ]
  return [
    '<tr><td colspan="2" class="divider">****************</td></tr>',
    `<tr><td colspan="2" style="padding:4px 0;text-align:center;font-size:16px;font-weight:700;">${escapeReceiptHtml(cafe.cafeName.trim())}</td></tr>`,
    ...rows.map(([label, value]) => receiptRow(label, value.trim())),
  ].join('')
}

/** "YYYY-MM-DD" → "dd/mm/yyyy"; giá trị lạ giữ nguyên. */
export function formatReceiptDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]}` : value
}

/** Giờ máy trạm của trình duyệt → "YYYY-MM-DD HH:MM:SS" (cùng dạng `FMT_DATETIME_SYSTEM` của MFC). */
export function formatSystemDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

/** "YYYY-MM-DD HH:MM:SS" → "dd/mm/yyyy HH:mm"; không khớp thì giữ nguyên. */
export function formatReceiptDateTime(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(value.trim())
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : value
}
