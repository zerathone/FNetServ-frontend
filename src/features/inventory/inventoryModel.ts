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

// ----- Phiếu nhập/xuất/kiểm kê nguyên liệu -----

export type MaterialMoveType = 1 | 2 | 3

export const MOVE_TYPE_LABEL: Record<number, string> = {
  1: 'Nhập kho',
  2: 'Xuất / trả',
  3: 'Kiểm kê',
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

/** Lỗi nhập liệu (tiếng Việt) hoặc null nếu hợp lệ. Kiểm tra phía server vẫn là nguồn sự thật. */
export function validateStockMove(input: StockMoveInput): string | null {
  const qty = parseMilli(input.qty)
  if (qty === null) return 'Số lượng không hợp lệ (tối đa 3 số lẻ).'
  if (input.msType !== 3 && qty <= 0) return 'Số lượng phải lớn hơn 0.'
  if (input.price.trim() !== '' && parseMilli(input.price) === null) return 'Đơn giá không hợp lệ.'
  if (!isValidStockCode(input.code.trim())) return 'Mã phiếu 1–20 ký tự gồm chữ, số và _ . - /'
  if (input.note.length > 255) return 'Ghi chú tối đa 255 ký tự.'
  return null
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

// ----- Kho thành phẩm -----

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

/** Ngày YYYY-MM-DD cho bộ lọc; rỗng hoặc sai dạng → undefined (không gửi). */
export function dateFilter(value: string): string | undefined {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}
