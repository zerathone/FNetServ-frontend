// task web-print-flows (FE-A) — logic thuần của phiếu THẺ COMBO in ra máy in POS. Mirror
// `PrintReceipt::generateDataComboCard` (QT-FNetSubServ/global/printreceipt.cpp:705). Tách khỏi component để test
// bằng `node --test` (tests/combo-card-print-model.test.ts).
import type { Combo, ComboSaleResult } from '../../api/combo.ts'
import type { CafeInfo } from '../../api/settings.ts'
import {
  RECEIPT_STYLE,
  escapeReceiptHtml,
  formatReceiptDate,
  formatReceiptNumber,
  receiptDivider,
  receiptFullRow,
  receiptRow,
  receiptTitle,
  roomInfoRowsHtml,
} from '../printers/posPrintModel.ts'

/** `combotb.Type` — 2 = theo thời lượng (Qt `ComboType_Two`), còn lại = khung giờ cố định. */
export const COMBO_TYPE_DURATION = 2

export type ComboCardPrintData = {
  username: string
  password: string
  comboName: string
  price: number | null
  zone: string
  fromDate: string
  fromTime: string
  toDate: string
  toTime: string
  comboType: number
  duration: number
  donates: Array<{ name: string; quantity: number }>
  issuedAt: string
  staffName: string
}

type CardContext = {
  /** Giờ trình duyệt "dd/mm/yyyy HH:mm" khi server chưa trả `issuedAt`. */
  fallbackIssuedAt: string
  fallbackStaffName: string
}

/**
 * Gộp kết quả bán (server) với danh mục combo đã chọn. Giá trị server luôn thắng — phiếu in phải khớp hạn dùng đã
 * ghi trong DB; danh mục chỉ bù những trường BE cũ chưa trả (giá, tên, nhóm máy, dịch vụ tặng kèm).
 */
export function toComboCardData(
  result: ComboSaleResult,
  combo: Combo | undefined,
  context: CardContext,
): ComboCardPrintData {
  const zoneFromCatalog = combo ? combo.machineGroups.map((group) => group.name).join(', ') : ''
  return {
    username: result.username,
    password: result.password,
    comboName: result.comboName ?? combo?.name ?? '',
    price: result.price ?? combo?.price ?? null,
    // Server nối tên nhóm máy bằng '|' (DAOCombo::get) — in dạng "VIP, Thường" như danh mục.
    zone: result.zone !== undefined ? result.zone.split('|').map((name) => name.trim()).filter(Boolean).join(', ') : zoneFromCatalog,
    fromDate: result.fromDate ?? '',
    fromTime: result.fromTime ?? '',
    toDate: result.toDate ?? '',
    toTime: result.toTime ?? '',
    comboType: result.comboType ?? combo?.type ?? 1,
    duration: result.duration ?? combo?.duration ?? 0,
    donates:
      result.donates ?? (combo ? combo.donates.map((item) => ({ name: item.name, quantity: item.quantity })) : []),
    issuedAt: result.issuedAt ?? context.fallbackIssuedAt,
    staffName: result.staffName ?? context.fallbackStaffName,
  }
}

const hhmm = (value: string) => value.trim().slice(0, 5)

function dateTime(date: string, time: string) {
  if (!date.trim()) return ''
  return `${formatReceiptDate(date)}${time.trim() ? ` ${hhmm(time)}` : ''}`
}

type CardInput = {
  card: ComboCardPrintData
  printerName: string
  type: 1 | 2
  /** Chỉ truyền khi thu ngân đã tick "In thông tin phòng máy". */
  cafe?: CafeInfo | null
}

/** HTML MỘT phiếu thẻ combo cho `renderPrinterHtml`. Mọi chuỗi từ DB/người dùng đều qua `escapeReceiptHtml`. */
export function buildComboCardHtml({ card, printerName, type, cafe }: CardInput) {
  const rows: string[] = [
    receiptTitle('THẺ COMBO'),
    card.issuedAt ? receiptRow('Ngày:', card.issuedAt) : '',
    card.staffName ? receiptRow('Nhân viên:', card.staffName) : '',
    receiptRow('Máy in:', printerName),
    card.price !== null ? receiptRow('Giá:', formatReceiptNumber(card.price)) : '',
    receiptRow('Tài khoản:', card.username, true),
    receiptRow('Mật khẩu:', card.password, true),
  ]

  if (card.zone.trim()) {
    rows.push(receiptFullRow('Nhóm máy:'))
    rows.push(`<tr><td colspan="2" style="text-align:center;">${escapeReceiptHtml(card.zone)}</td></tr>`)
  }

  const from = dateTime(card.fromDate, card.fromTime)
  const to = dateTime(card.toDate, card.toTime)
  if (from || to) {
    rows.push(receiptFullRow('Thời hạn sử dụng:'))
    if (from) rows.push(receiptRow('Từ:', from, true))
    if (to) rows.push(receiptRow('Đến:', to, true))
  }

  if (card.comboType === COMBO_TYPE_DURATION) {
    rows.push(receiptFullRow('Giờ sử dụng:'))
    rows.push(receiptRow('Thời lượng:', `${formatReceiptNumber(card.duration)} tiếng`, true))
    if (card.fromTime.trim()) rows.push(receiptRow('Từ:', hhmm(card.fromTime), true))
  } else if (card.fromTime.trim() || card.toTime.trim()) {
    rows.push(receiptFullRow('Giờ sử dụng:'))
    if (card.fromTime.trim()) rows.push(receiptRow('Từ:', hhmm(card.fromTime), true))
    if (card.toTime.trim()) rows.push(receiptRow('Đến:', hhmm(card.toTime), true))
  }

  if (card.donates.length > 0) {
    rows.push(receiptFullRow('Dịch vụ tặng kèm:'))
    rows.push(
      `<tr><td>Dịch vụ</td><td style="text-align:right;">Số lượng</td></tr>`,
      ...card.donates.map(
        (item) =>
          `<tr><td style="font-weight:700;">${escapeReceiptHtml(item.name)}</td><td style="text-align:right;">${escapeReceiptHtml(formatReceiptNumber(item.quantity))}</td></tr>`,
      ),
    )
  }

  rows.push(roomInfoRowsHtml(cafe))
  rows.push(receiptDivider(type))

  return `${RECEIPT_STYLE}<table>${rows.filter(Boolean).join('')}</table>`
}

/** Văn bản dự phòng (sao chép / tải .txt) khi in lỗi — mật khẩu chỉ có MỘT lần nên phải cứu được. */
export function formatComboCredentialsText(cards: ReadonlyArray<Pick<ComboCardPrintData, 'username' | 'password'>>) {
  return cards.map((card) => `${card.username}\t${card.password}`).join('\r\n')
}
