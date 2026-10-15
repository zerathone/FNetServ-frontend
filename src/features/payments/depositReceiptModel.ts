// task web-print-flows (FE-B) — logic thuần của PHIẾU NẠP TIỀN in ra máy in POS. Mirror
// `PrintReceipt::generateDataDeposit` (QT-FNetSubServ/global/printreceipt.cpp:1009) và `CUserDepositMoneyDlg::print_receipt`
// (ServerSide_ai/UserDepositMoneyDlg.cpp:2296). Test: tests/deposit-receipt-model.test.ts.
import type { CafeInfo } from '../../api/settings.ts'
import {
  RECEIPT_STYLE,
  formatReceiptNumber,
  receiptDivider,
  receiptRow,
  receiptTitle,
  roomInfoRowsHtml,
} from '../printers/posPrintModel.ts'
import type { DepositMethod } from './depositModel.ts'

/** Cấu hình in phiếu nạp mà MFC lưu ở option 139 (`CPrintAccountAutoDlg`). */
export type DepositPrintConfig = {
  /** Tên máy in (khớp `printertb.PrinterName`). */
  printer: string
  /** Ô "thông tin phòng máy" của dialog cấu hình MFC. */
  cafeInfo: boolean
  /** Dòng "Ghi chú" cố định (≤ 40 ký tự, chủ quán nhập ở dialog cấu hình) — KHÔNG phải ghi chú giao dịch. */
  note: string
}

function decodeBase64Utf8(text: string): string | null {
  try {
    const binary = atob(text.trim())
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

/**
 * Giá trị option 139 là JSON **mã hoá base64** (`GetConfig(true)` → `SetValue`; `LoadConfig` giải mã lại). Chấp nhận
 * cả JSON thô để dễ test. Hợp lệ khi đủ như MFC (`LoadConfig`): `paper_type >= 0` và `printer` không rỗng. Hỏng ⇒ `null`
 * (coi như chưa cấu hình, KHÔNG ném lỗi). `paper_type` chủ ý bị bỏ qua: bảng đó (A4=0, POS58=1, POS80=2) NGƯỢC với
 * `printertb.Type` (POS80=1, POS58=2) — Web chỉ dùng khổ của máy in.
 */
export function parseDepositPrintConfig(raw: string | null | undefined): DepositPrintConfig | null {
  if (!raw || !raw.trim()) return null
  const candidates = [decodeBase64Utf8(raw), raw]
  for (const text of candidates) {
    if (!text) continue
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const printer = typeof parsed.printer === 'string' ? parsed.printer.trim() : ''
      const paperType = typeof parsed.paper_type === 'number' ? parsed.paper_type : -1
      if (!printer || paperType < 0) continue
      return {
        printer,
        cafeInfo: parsed.cafe_info === true,
        note: typeof parsed.note === 'string' ? parsed.note : '',
      }
    } catch {
      // thử ứng viên kế tiếp
    }
  }
  return null
}

/** MFC: `PY_TIME_FEE` (tiền mặt) → "Tiền mặt", còn lại → "Chuyển khoản" (`IDS_CBX_USER_CASH` / `IDS_CBX_USER_PAYMENT_ONLINE`). */
export function depositMethodLabel(method: DepositMethod) {
  return method === 'cash' ? 'Tiền mặt' : 'Chuyển khoản'
}

/** Số tiền âm là thao tác rút — không in phiếu "nạp tiền". */
export function isPrintableDepositAmount(amount: number | null | undefined): amount is number {
  return typeof amount === 'number' && Number.isFinite(amount) && amount > 0
}

export type DepositReceiptInput = {
  /** "YYYY-MM-DD HH:MM:SS" — giờ trình duyệt (user chốt 2026-10-14). */
  issueDate: string
  staffName: string
  amount: number
  username: string
  methodLabel: string
  /** Máy trạm của hội viên nếu đang online; rỗng ⇒ bỏ dòng. */
  machine: string
  printerName: string
  /** Dòng ghi chú cố định từ config; rỗng ⇒ bỏ dòng. */
  note: string
  type: 1 | 2
  /** Chỉ truyền khi thu ngân đã tick "In thông tin phòng máy". */
  cafe?: CafeInfo | null
}

/** HTML phiếu nạp cho `renderPrinterHtml`. Mọi chuỗi động qua `escapeReceiptHtml` (trong `receiptRow`). */
export function buildDepositReceiptHtml(input: DepositReceiptInput) {
  const rows = [
    receiptTitle('NẠP TIỀN TÀI KHOẢN'),
    receiptRow('Thời điểm:', input.issueDate),
    receiptRow('Thu ngân:', input.staffName),
    receiptRow('Số tiền nạp:', formatReceiptNumber(input.amount), true),
    receiptRow('Tài khoản:', input.username, true),
    receiptRow('Phương thức:', input.methodLabel),
    input.machine.trim() ? receiptRow('Máy sử dụng:', input.machine) : '',
    receiptRow('Máy in:', input.printerName),
    input.note.trim() ? receiptRow('Ghi chú:', input.note) : '',
    roomInfoRowsHtml(input.cafe),
    receiptDivider(input.type),
  ]
  return `${RECEIPT_STYLE}<table>${rows.filter(Boolean).join('')}</table>`
}
