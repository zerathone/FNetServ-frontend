// task topping-kho / T3f — hàm thuần cho các màn kho. KHÔNG import giá trị từ api/client (unit test chạy bằng
// node --experimental-strip-types; kéo `client` vào là vỡ test) ⇒ chỉ `import type` từ api/inventory.
import type { ClosingLine, LedgerRow, MaterialRow } from '../../api/inventory.ts'

// ----- Số lượng nguyên liệu: chuỗi decimal(12,3), KHÔNG đi qua float -----

const MAX_MILLI = 999_999_999_999 // decimal(12,3) → 999.999.999,999

/** Chuỗi người dùng gõ → số nguyên "phần nghìn" (milli). Nhận "1.5" hoặc "1,5"; null nếu sai định dạng/quá 3 số lẻ. */
export function parseMilli(input: string): number | null {
  const s = input.trim().replace(',', '.')
  const m = /^(\d{1,9})(?:\.(\d{1,3}))?$/.exec(s)
  if (!m) return null
  const milli = Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0'))
  return milli <= MAX_MILLI ? milli : null
}

/** Chuỗi gửi lên server (dấu chấm, bỏ số 0 thừa phía trước). null nếu không hợp lệ. */
export function toWireDecimal(input: string): string | null {
  const milli = parseMilli(input)
  return milli === null ? null : milliToString(milli)
}

export function milliToString(milli: number): string {
  const sign = milli < 0 ? '-' : ''
  const abs = Math.abs(milli)
  const int = Math.floor(abs / 1000)
  const frac = String(abs % 1000).padStart(3, '0').replace(/0+$/, '')
  return `${sign}${int}${frac ? `.${frac}` : ''}`
}

/** Số dương (> 0) hợp lệ. */
export function isPositiveQty(input: string): boolean {
  const milli = parseMilli(input)
  return milli !== null && milli > 0
}

/** Hiển thị "1.500" (server) → "1,5"; nghìn phân tách bằng dấu chấm kiểu vi-VN. Chuỗi lạ trả nguyên văn. */
export function formatQty(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(value.trim())
  if (!m) return value
  const int = m[2].replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  const frac = (m[3] ?? '').replace(/0+$/, '')
  return `${m[1]}${int}${frac ? `,${frac}` : ''}`
}

/** Chênh lệch có dấu rõ ràng: "+2", "−1,5", "0". */
export function formatDiff(value: string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—'
  const milli = parseMilli(value.replace(/^-/, ''))
  if (milli === null) return value
  if (milli === 0) return '0'
  return `${value.startsWith('-') ? '−' : '+'}${formatQty(value.replace(/^-/, ''))}`
}

export function diffTone(value: string | null | undefined): 'neutral' | 'warning' | 'danger' | 'success' {
  if (!value) return 'neutral'
  const milli = parseMilli(value.replace(/^-/, ''))
  if (milli === null || milli === 0) return 'neutral'
  return value.startsWith('-') ? 'danger' : 'warning'
}

// ----- Trạng thái tồn của nguyên liệu (thống nhất với "Còn tồn / Hết tồn" của dịch vụ) -----

/**
 * Bốn nhóm rời nhau: ngừng dùng → hết tồn (tồn ≤ 0) → sắp hết (0 < tồn ≤ mức tối thiểu) → còn tồn.
 * Khác cờ `low` của server (tồn ≤ tối thiểu, đã gồm cả hết tồn).
 */
export type MaterialStockState = 'available' | 'low' | 'out' | 'stopped'
export type MaterialStockFilter = 'all' | MaterialStockState

export function materialStockState(m: Pick<MaterialRow, 'isActive' | 'stockQty' | 'minStockQty'>): MaterialStockState {
  if (m.isActive !== 1) return 'stopped'
  const stock = Number(m.stockQty)
  if (!(stock > 0)) return 'out'
  return stock <= Number(m.minStockQty) ? 'low' : 'available'
}

export const MATERIAL_STOCK_LABEL: Record<MaterialStockState, string> = {
  available: 'Còn tồn',
  low: 'Sắp hết',
  out: 'Hết tồn',
  stopped: 'Ngừng dùng',
}

/** Mục của dropdown lọc ở header cột Trạng thái (Tất cả + bốn nhóm rời nhau). */
export const MATERIAL_STOCK_FILTER_OPTIONS: { value: MaterialStockFilter; label: string }[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'available', label: MATERIAL_STOCK_LABEL.available },
  { value: 'low', label: MATERIAL_STOCK_LABEL.low },
  { value: 'out', label: MATERIAL_STOCK_LABEL.out },
  { value: 'stopped', label: MATERIAL_STOCK_LABEL.stopped },
]

// ----- Phiếu nhập/xuất/kiểm kê nguyên liệu -----

export type MaterialMoveType = 1 | 2 | 3

export const MOVE_TYPE_LABEL: Record<number, string> = {
  1: 'Nhập kho',
  2: 'Xuất / trả',
  3: 'Kiểm kê',
}

/** Nhãn nút mở phiếu nhiều nguyên liệu (dùng ở mục Nhập kho/Xuất/Kiểm kê và ở thanh chọn của Tồn kho). */
export const VOUCHER_BUTTON_LABEL: Record<MaterialMoveType, string> = {
  1: 'Tạo phiếu nhập kho',
  2: 'Tạo phiếu xuất',
  3: 'Tạo phiếu kiểm kê',
}

const MOVE_CODE_PREFIX: Record<MaterialMoveType, string> = { 1: 'NK', 2: 'XK', 3: 'KK' }

/** Gợi ý mã phiếu: NK/XK/KK + yyMMddHHmmss (14 ký tự ≤ 20). Admin sửa được. */
export function suggestStockCode(msType: MaterialMoveType, now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    MOVE_CODE_PREFIX[msType] +
    p(now.getFullYear() % 100) +
    p(now.getMonth() + 1) +
    p(now.getDate()) +
    p(now.getHours()) +
    p(now.getMinutes()) +
    p(now.getSeconds())
  )
}

/** Mã phiếu server chấp nhận: 1..20 ký tự [A-Za-z0-9_.-/]. */
export function isValidStockCode(code: string): boolean {
  return /^[A-Za-z0-9_./-]{1,20}$/.test(code)
}

export type StockMoveInput = {
  msType: MaterialMoveType
  qty: string
  price: string
  code: string
  note: string
}

/** Lỗi số lượng / đơn giá của MỘT dòng phiếu (tiếng Việt) hoặc null. Dùng chung cho phiếu 1 dòng và phiếu nhiều dòng. */
export function validateStockLine(input: Pick<StockMoveInput, 'msType' | 'qty' | 'price'>): string | null {
  const qty = parseMilli(input.qty)
  if (qty === null) return 'Số lượng không hợp lệ (tối đa 3 số lẻ).'
  if (input.msType !== 3 && qty <= 0) return 'Số lượng phải lớn hơn 0.'
  if (input.price.trim() !== '' && parseMilli(input.price) === null) return 'Đơn giá không hợp lệ.'
  return null
}

/** Lỗi mã phiếu / ghi chú (dùng chung cho cả phiếu), hoặc null. */
export function validateStockHeader(input: Pick<StockMoveInput, 'code' | 'note'>): string | null {
  if (!isValidStockCode(input.code.trim())) return 'Mã phiếu 1–20 ký tự gồm chữ, số và _ . - /'
  if (input.note.length > 255) return 'Ghi chú tối đa 255 ký tự.'
  return null
}

/** Lỗi nhập liệu (tiếng Việt) hoặc null nếu hợp lệ. Kiểm tra phía server vẫn là nguồn sự thật. */
export function validateStockMove(input: StockMoveInput): string | null {
  return validateStockLine(input) ?? validateStockHeader(input)
}

/** Số nguyên liệu tối đa trong một lần nhập/xuất/kiểm kê hàng loạt (mỗi dòng là một lần gọi máy chủ). */
export const MAX_MATERIAL_BATCH = 50

/**
 * Tổng tiền của phiếu = số lượng × đơn giá (đ), làm tròn đến đồng. Chỉ để hiển thị — server tính lại.
 * Trả null khi thiếu/sai số lượng hoặc đơn giá (đơn giá không bắt buộc ⇒ chưa nhập thì không có tổng).
 */
export function stockMoveTotal(qty: string, price: string): number | null {
  if (qty.trim() === '' || price.trim() === '') return null
  const q = parseMilli(qty)
  const p = parseMilli(price)
  if (q === null || p === null) return null
  return Math.round((q * p) / 1_000_000)
}

/** Xem trước tồn sau phiếu để người dùng thấy trước (xuất vượt tồn bị server chặn). */
export function previewStockAfter(
  stockQty: string,
  input: Pick<StockMoveInput, 'msType' | 'qty'>,
): { after: string; short: boolean } | null {
  const stock = parseMilli(stockQty)
  const qty = parseMilli(input.qty)
  if (stock === null || qty === null) return null
  if (input.msType === 1) return { after: milliToString(stock + qty), short: false }
  if (input.msType === 3) return { after: milliToString(qty), short: false }
  return { after: milliToString(stock - qty), short: stock - qty < 0 }
}

/**
 * Chênh lệch kiểm kê = số đếm thực tế − tồn hiện tại, dạng chuỗi decimal có dấu ("-1.5", "0", "2"); null khi chưa/sai số.
 * Cùng quy ước dấu với kiểm kê hàng hóa (âm = hao hụt) và với `diff` máy chủ trả về.
 */
export function stocktakeDiff(stockQty: string, countedQty: string): string | null {
  const stock = parseMilli(stockQty)
  const counted = parseMilli(countedQty)
  if (stock === null || counted === null) return null
  return milliToString(counted - stock)
}

// ----- Công thức / topping của một món -----

export type RecipeDraftLine = { key: string; materialId: number; qty: string; waste: string }

export const MAX_RECIPE_LINES = 50
export const MAX_TOPPING_LINES = 30

export function validateRecipeDraft(lines: readonly RecipeDraftLine[]): string | null {
  if (lines.length > MAX_RECIPE_LINES) return `Tối đa ${MAX_RECIPE_LINES} nguyên liệu.`
  const seen = new Set<number>()
  for (const line of lines) {
    if (!line.materialId) return 'Mỗi dòng phải chọn nguyên liệu.'
    if (seen.has(line.materialId)) return 'Một nguyên liệu chỉ xuất hiện một lần trong công thức.'
    seen.add(line.materialId)
    if (!isPositiveQty(line.qty)) return 'Định lượng phải > 0 (tối đa 3 số lẻ).'
    const waste = line.waste.trim() === '' ? 0 : parseWastePercent(line.waste)
    if (waste === null) return 'Hao hụt từ 0 đến 100 (tối đa 2 số lẻ).'
  }
  return null
}

/** % hao hụt → phần trăm ×100 (centi); null nếu ngoài 0..100 hoặc quá 2 số lẻ. */
export function parseWastePercent(input: string): number | null {
  const m = /^(\d{1,3})(?:[.,](\d{1,2}))?$/.exec(input.trim())
  if (!m) return null
  const centi = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'))
  return centi <= 10_000 ? centi : null
}

export function recipeLinesBody(lines: readonly RecipeDraftLine[]) {
  return lines.map((l) => ({
    materialId: l.materialId,
    qty: toWireDecimal(l.qty) as string,
    wastePercent: l.waste.trim() === '' ? '0' : l.waste.trim().replace(',', '.'),
  }))
}

export type ToppingDraftLine = { key: string; serviceId: number; qty: string; price: string }

export function validateToppingDraft(serviceId: number, lines: readonly ToppingDraftLine[]): string | null {
  if (lines.length > MAX_TOPPING_LINES) return `Tối đa ${MAX_TOPPING_LINES} topping.`
  const seen = new Set<number>()
  for (const line of lines) {
    if (!line.serviceId) return 'Mỗi dòng phải chọn topping.'
    if (line.serviceId === serviceId) return 'Món không thể là topping của chính nó.'
    if (seen.has(line.serviceId)) return 'Một topping chỉ xuất hiện một lần.'
    seen.add(line.serviceId)
    if (line.qty.trim() !== '' && !isPositiveQty(line.qty)) return 'Lượng nguyên liệu mỗi topping phải > 0.'
    if (line.price.trim() !== '' && parseMilli(line.price) === null) return 'Giá topping không hợp lệ.'
  }
  return null
}

export function toppingLinesBody(lines: readonly ToppingDraftLine[]) {
  return lines.map((l) => ({
    serviceId: l.serviceId,
    ...(l.qty.trim() !== '' ? { toppingQty: toWireDecimal(l.qty) as string } : {}),
    ...(l.price.trim() !== '' ? { topPrice: toWireDecimal(l.price) as string } : {}),
  }))
}

// ----- Kho hàng hóa -----

export function parseWholeNumber(input: string, allowNegative = false): number | null {
  const m = (allowNegative ? /^-?\d{1,7}$/ : /^\d{1,7}$/).exec(input.trim())
  return m ? Number(input.trim()) : null
}

// ----- Lỗi từ server -----

type ErrorLike = { message?: string; code?: string; details?: unknown }

/** Thêm chi tiết có ích (đủ/thiếu bao nhiêu, nguyên liệu nào) vào thông báo của server. */
export function describeInventoryError(error: unknown): string {
  const e = (error ?? {}) as ErrorLike
  const base = e.message || 'Không thực hiện được, thử lại sau.'
  const d = (e.details ?? {}) as Record<string, unknown>
  if (e.code === 'material_short' && typeof d.stockQty === 'string' && typeof d.need === 'string') {
    return `${base} Tồn ${formatQty(d.stockQty)}, cần ${formatQty(d.need)}.`
  }
  if (e.code === 'in_use' && typeof d.recipeCount === 'number') {
    return `${base} (${d.recipeCount} công thức/topping đang dùng)`
  }
  return base
}

// ----- Chốt kỳ -----

export function countClosingDiffs(rows: readonly Pick<ClosingLine, 'diffQty'>[]): number {
  return rows.filter((r) => parseMilli((r.diffQty ?? '0').replace(/^-/, '')) !== 0).length
}

/** Dòng xem trước (MaterialRow có cột kỳ) lệch sổ: diffQty ≠ 0. */
export function previewHasDiff(row: Pick<MaterialRow, 'diffQty'>): boolean {
  return row.diffQty !== undefined && countClosingDiffs([{ diffQty: row.diffQty }]) === 1
}

// ----- Sổ kho -----

export function formatUnixSeconds(sec: number): string {
  if (!sec) return '—'
  const d = new Date(sec * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`
}

/** Dòng sổ kho kiểm kê mà FNet ghi kèm số cũ (R6a) → có thể hiển thị "từ X → Y (lệch Z)". */
export function ledgerHasStocktakeLog(row: Pick<LedgerRow, 'msType' | 'stockBefore'>): boolean {
  return row.msType === 3 && row.stockBefore !== null
}

/**
 * Tổng điều chỉnh của các dòng kiểm kê: cộng riêng phần giảm (diff < 0) và phần tăng (diff > 0), trả số tuyệt đối dạng chuỗi
 * thập phân ("12.5"). Bỏ qua dòng không có nhật ký kiểm kê (iCafe tạo ⇒ `diff` null). Cộng bằng số nguyên (milli), không qua float.
 * Lưu ý: đây là tổng SỐ LƯỢNG (nhiều nguyên liệu có thể khác đơn vị) — phiếu kiểm kê không ghi đơn giá nên không quy ra tiền.
 * `unchanged` = số dòng kiểm kê có nhật ký mà chênh lệch bằng 0 (đếm dòng, vì số lượng không đổi luôn là 0);
 * `decreaseLines` / `increaseLines` = số dòng giảm / tăng tương ứng.
 */
export function sumStocktakeAdjust(rows: readonly Pick<LedgerRow, 'diff'>[]): {
  decrease: string
  increase: string
  decreaseLines: number
  increaseLines: number
  unchanged: number
} {
  let dec = 0
  let inc = 0
  let decreaseLines = 0
  let increaseLines = 0
  let unchanged = 0
  for (const r of rows) {
    if (!r.diff) continue
    const milli = parseMilli(r.diff.replace(/^-/, ''))
    if (milli === null) continue
    if (milli === 0) unchanged += 1
    else if (r.diff.startsWith('-')) {
      dec += milli
      decreaseLines += 1
    } else {
      inc += milli
      increaseLines += 1
    }
  }
  return { decrease: milliToString(dec), increase: milliToString(inc), decreaseLines, increaseLines, unchanged }
}

/**
 * Các kỳ chốt có NGÀY chốt (phần `YYYY-MM-DD` đầu `createDate`) nằm trong [fromDate, toDate] (gồm hai đầu; rỗng = không giới hạn
 * phía đó). Giữ nguyên thứ tự đầu vào.
 */
export function closingsInRange<T extends { createDate: string }>(rows: readonly T[], fromDate: string, toDate: string): T[] {
  return rows.filter((r) => {
    const day = r.createDate.slice(0, 10)
    return (fromDate === '' || day >= fromDate) && (toDate === '' || day <= toDate)
  })
}

/** Ngày YYYY-MM-DD cho bộ lọc; rỗng hoặc sai dạng → undefined (không gửi). */
export function dateFilter(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}
