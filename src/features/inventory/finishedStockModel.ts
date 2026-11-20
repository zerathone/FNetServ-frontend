// task service-catalog đợt 2 — hàm thuần cho "Quản lý tồn" kho THÀNH PHẨM (tồn kho, phiếu nhập/kiểm kê nhiều dòng,
// báo cáo, chốt kho). KHÔNG import giá trị từ api/client hay React (unit test chạy bằng node --experimental-strip-types)
// ⇒ chỉ `import type`. Kho NGUYÊN LIỆU nằm ở inventoryModel.ts — file này không dùng chung state với nó.
import type { ServiceItem } from '../../api/services.ts'

// ----- Quyền (mã theo ServerSide_ai/define.h) -----

export const RIGHT_FINISHED_IMPORT = 64
export const RIGHT_FINISHED_CONVERT_UNIT = 65
export const RIGHT_FINISHED_STOCKTAKE = 68
export const RIGHT_FINISHED_CLOSING = 69

export type FinishedReportKind = 'imports' | 'stocktakes' | 'closings'

/** Mã quyền xem báo cáo: `own` = chỉ xem của chính mình, `all` = xem của mọi người. */
export const REPORT_RIGHTS: Record<FinishedReportKind, { own: number; all: number }> = {
  imports: { own: 9391, all: 93911 },
  stocktakes: { own: 9392, all: 93921 },
  closings: { own: 9394, all: 93941 },
}

/**
 * Bộ lọc "Người thực hiện" theo quyền (parity Qt): có mã ALL ⇒ chọn tự do (0 = tất cả); chỉ có mã thường (hoặc không có
 * quyền nào) ⇒ KHOÁ vào chính mình (gửi staffId của mình). Server vẫn là nguồn chặn.
 * Trả `undefined` = không lọc theo người.
 */
export function effectiveStaffFilter(canAll: boolean, myStaffId: number | null, selected: number): number | undefined {
  if (canAll) return selected > 0 ? selected : undefined
  return myStaffId !== null && myStaffId > 0 ? myStaffId : undefined
}

// ----- Định dạng số -----

/** 1234567 → "1.234.567" (không phụ thuộc ICU của môi trường chạy test). */
export function formatInt(value: number): string {
  const sign = value < 0 ? '-' : ''
  return sign + String(Math.abs(Math.trunc(value))).replace(/\B(?=(\d{3})+(?!\d))/g, '.')
}

export function formatMoney(value: number): string {
  return `${formatInt(value)} đ`
}

/** Số có dấu rõ ràng: "+5", "−3" (U+2212, như inventoryModel.formatDiff), "0". */
export function formatSigned(value: number): string {
  if (value === 0) return '0'
  return `${value > 0 ? '+' : '−'}${formatInt(Math.abs(value))}`
}

/** "2026-11-18" + "09:05:00" → "18/11/2026 09:05:00". Chuỗi lạ giữ nguyên, thiếu giờ thì chỉ có ngày. */
export function formatDateTimeText(date: string, time: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim())
  const day = m ? `${m[3]}/${m[2]}/${m[1]}` : date.trim()
  return `${day} ${time.trim()}`.trim()
}

// ----- Chênh lệch tồn (Dự kiến − Thực tế) -----

type StockLike = Pick<ServiceItem, 'inventory' | 'inventoryExpected'>

/** Chênh lệch = Dự kiến − Thực tế. null khi server cũ chưa trả `inventoryExpected` (hiện "—", không lỗi). */
export function stockDiff(service: StockLike): number | null {
  if (service.inventoryExpected === undefined || service.inventoryExpected === null) return null
  return service.inventoryExpected - service.inventory
}

export type DiffBadge = { tone: 'danger' | 'warning'; text: string }

/** Quy tắc badge: âm = danger, dương = warning, 0 hoặc không biết = null (để trống). */
export function diffBadge(diff: number | null): DiffBadge | null {
  if (diff === null || diff === 0) return null
  return { tone: diff < 0 ? 'danger' : 'warning', text: formatSigned(diff) }
}

export type ClosingGroup<T> = { key: string; createDate: string; createTime: string; staffId: number; rows: T[] }

/**
 * Gom các dòng báo cáo Nhập – xuất theo MỘT lần chốt = cùng thời điểm chốt (ngày + giờ) và cùng người chốt; thứ tự nhóm và
 * thứ tự dòng trong nhóm giữ nguyên như máy chủ trả. Dùng để vẽ ô "Thời điểm chốt" / "Người chốt" gộp (rowSpan) một lần cho cả kỳ.
 */
export function groupClosingRows<T extends { createDate: string; createTime: string; staffId: number }>(
  rows: readonly T[],
): ClosingGroup<T>[] {
  const groups: ClosingGroup<T>[] = []
  const byKey = new Map<string, ClosingGroup<T>>()
  for (const r of rows) {
    const key = `${r.createDate} ${r.createTime}|${r.staffId}`
    let group = byKey.get(key)
    if (!group) {
      group = { key, createDate: r.createDate, createTime: r.createTime, staffId: r.staffId, rows: [] }
      byKey.set(key, group)
      groups.push(group)
    }
    group.rows.push(r)
  }
  return groups
}

/**
 * Mốc "Từ" của MỘT lần chốt (đầu kỳ). Mỗi dòng mang mốc riêng (lần chốt trước của chính mặt hàng đó) nhưng thường giống nhau
 * cả kỳ ⇒ trả mốc SỚM NHẤT + số mốc khác nhau còn lại (`extra`; > 0 khi mặt hàng thêm sau lần chốt trước có mốc riêng). Dòng
 * không có mốc (rỗng) bị bỏ qua; không dòng nào có ⇒ null.
 */
export function closingGroupFrom(
  rows: readonly { fromDate: string; fromTime: string }[],
): { fromDate: string; fromTime: string; extra: number } | null {
  const distinct = [...new Set(rows.filter((r) => r.fromDate !== '').map((r) => `${r.fromDate} ${r.fromTime}`))].sort()
  if (distinct.length === 0) return null
  const [fromDate, fromTime = ''] = distinct[0].split(' ')
  return { fromDate, fromTime, extra: distinct.length - 1 }
}

/**
 * Thống kê điều chỉnh của các dòng báo cáo kiểm kê hàng hóa: tổng số lượng giảm (diff < 0), tổng tăng (diff > 0), số dòng không
 * đổi (diff = 0), cùng số dòng giảm / tăng. `decrease` trả số dương (hiển thị kèm dấu "−"). Số lượng hàng hóa là số nguyên ⇒
 * cộng thẳng, không lo làm tròn. Chỉ tính các dòng đã tải (một trang) — máy chủ chưa trả tổng cho cả khoảng lọc.
 */
export function summarizeStocktakeAdjust(rows: readonly { numAdjust: number }[]): {
  decrease: number
  increase: number
  decreaseLines: number
  increaseLines: number
  unchanged: number
} {
  let decrease = 0
  let increase = 0
  let decreaseLines = 0
  let increaseLines = 0
  let unchanged = 0
  for (const r of rows) {
    if (r.numAdjust < 0) {
      decrease += -r.numAdjust
      decreaseLines += 1
    } else if (r.numAdjust > 0) {
      increase += r.numAdjust
      increaseLines += 1
    } else unchanged += 1
  }
  return { decrease, increase, decreaseLines, increaseLines, unchanged }
}

/** Món quản lý tồn (cờ `inventoryManagement === 1`). */
export function isManagedStock(service: Pick<ServiceItem, 'inventoryManagement'>): boolean {
  return service.inventoryManagement === 1
}

export type ClosingPreview = { managedCount: number; diffCount: number; unknownDiff: boolean }

/** Số liệu cho hộp xác nhận Chốt kho: bao nhiêu món sẽ chốt, bao nhiêu món đang chênh lệch ≠ 0. */
export function closingPreview(services: readonly ServiceItem[]): ClosingPreview {
  let managedCount = 0
  let diffCount = 0
  let unknownDiff = false
  for (const s of services) {
    if (!isManagedStock(s)) continue
    managedCount += 1
    const diff = stockDiff(s)
    if (diff === null) unknownDiff = true
    else if (diff !== 0) diffCount += 1
  }
  return { managedCount, diffCount, unknownDiff }
}

// ----- Phiếu nhập kho nhiều dòng -----

export const MAX_BATCH_LINES = 50
export const MAX_FINISHED_QTY = 1_000_000
export const MAX_FINISHED_MONEY = 999_999_999
export const NOTE_MAX = 250

export type ImportDraftLine = {
  key: string
  serviceId: number
  /** 0 = đơn vị gốc của món; khác 0 = unitId của đơn vị quy đổi đã chọn. */
  unitId: number
  /** Số đơn vị gốc trong 1 đơn vị đã chọn (đơn vị gốc = 1). */
  factor: number
  quantity: string
  price: string
  note: string
}

function parseNonNegInt(input: string): number | null {
  const s = input.trim()
  return /^\d{1,9}$/.test(s) ? Number(s) : null
}

/** Thành tiền dòng = SL × giá (đều theo đơn vị đã chọn). null khi thiếu/sai số. Máy chủ tính lại. */
export function importLineTotal(line: Pick<ImportDraftLine, 'quantity' | 'price'>): number | null {
  const q = parseNonNegInt(line.quantity)
  const p = parseNonNegInt(line.price)
  return q === null || p === null ? null : q * p
}

/** Lỗi nhập liệu (tiếng Việt) hoặc null. Máy chủ vẫn là nguồn chặn. */
export function validateImportLine(line: ImportDraftLine): string | null {
  const q = parseNonNegInt(line.quantity)
  if (q === null || q < 1) return 'Số lượng phải là số nguyên từ 1 trở lên.'
  const p = parseNonNegInt(line.price)
  if (p === null) return 'Giá nhập phải là số nguyên từ 0 trở lên.'
  if (q * line.factor > MAX_FINISHED_QTY) {
    return `Số lượng sau quy đổi (${formatInt(q * line.factor)}) vượt giới hạn ${formatInt(MAX_FINISHED_QTY)}.`
  }
  if (q * p > MAX_FINISHED_MONEY) return `Thành tiền vượt giới hạn ${formatInt(MAX_FINISHED_MONEY)} đ.`
  if (line.note.length > NOTE_MAX) return `Ghi chú tối đa ${NOTE_MAX} ký tự.`
  return null
}

/** Tổng tiền cả phiếu = cộng thành tiền các dòng tính được (dòng sai số bị bỏ qua). */
export function importVoucherTotal(lines: readonly Pick<ImportDraftLine, 'quantity' | 'price'>[]): number {
  let sum = 0
  for (const line of lines) sum += importLineTotal(line) ?? 0
  return sum
}

/** Lỗi toàn phiếu (số dòng) hoặc lỗi dòng đầu tiên; null = ghi được. */
export function validateImportVoucher(lines: readonly ImportDraftLine[]): string | null {
  if (lines.length === 0) return 'Phiếu chưa có dòng nào.'
  if (lines.length > MAX_BATCH_LINES) return `Một phiếu tối đa ${MAX_BATCH_LINES} dòng.`
  for (const line of lines) {
    const error = validateImportLine(line)
    if (error) return error
  }
  if (importVoucherTotal(lines) > MAX_FINISHED_MONEY * MAX_BATCH_LINES) return 'Tổng tiền phiếu quá lớn.'
  return null
}

/** Phần thân gửi `import-batch` (không gồm idem). `unitId` bỏ trống = đơn vị gốc. */
export function importBatchLines(lines: readonly ImportDraftLine[]) {
  return lines.map((l) => ({
    serviceId: l.serviceId,
    quantity: Number(l.quantity.trim()),
    price: Number(l.price.trim()),
    ...(l.unitId > 0 ? { unitId: l.unitId } : {}),
    ...(l.note.trim() !== '' ? { note: l.note.trim() } : {}),
  }))
}

// ----- Phiếu kiểm kê nhiều dòng -----

export type StocktakeMode = 'real' | 'adjust'

export type StocktakeDraftLine = {
  key: string
  serviceId: number
  /** Số thực tế (mode `real`) hoặc số điều chỉnh có dấu (mode `adjust`) — chuỗi người dùng gõ. */
  value: string
  note: string
}

export type StocktakeCheck =
  | { ok: true; real: number; adjust: number; warning?: string }
  | { ok: false; error: string }

export function exceedsExpectedMessage(expected: number): string {
  return `Số thực tế vượt tồn sổ sách (dự kiến ${formatInt(expected)}) — nếu có hàng nhập chưa ghi, hãy lập phiếu nhập kho.`
}

/**
 * Kiểm tra một dòng kiểm kê theo tồn hiện tại. Lỗi cứng (`ok:false`) chặn ghi phiếu; `warning` = báo trước luật Q14
 * (làm TĂNG tồn vượt "Dự kiến" sẽ bị máy chủ từ chối) — không chặn vì số tồn ở FE có thể đã cũ, máy chủ đọc lại lúc ghi.
 */
export function checkStocktakeLine(
  mode: StocktakeMode,
  value: string,
  snapshot: { inventory: number; expected?: number },
  note = '',
): StocktakeCheck {
  const s = value.trim()
  if (note.length > NOTE_MAX) return { ok: false, error: `Ghi chú tối đa ${NOTE_MAX} ký tự.` }
  let real: number
  let adjust: number
  if (mode === 'real') {
    if (!/^\d{1,9}$/.test(s)) return { ok: false, error: 'Số thực tế phải là số nguyên từ 0 trở lên.' }
    real = Number(s)
    adjust = real - snapshot.inventory
  } else {
    if (!/^-?\d{1,9}$/.test(s)) return { ok: false, error: 'Số điều chỉnh phải là số nguyên (âm để giảm).' }
    adjust = Number(s)
    real = snapshot.inventory + adjust
  }
  if (real < 0) return { ok: false, error: `Kết quả âm (${formatInt(real)}) — tồn thực tế không được nhỏ hơn 0.` }
  if (real > MAX_FINISHED_QTY) return { ok: false, error: `Số thực tế vượt giới hạn ${formatInt(MAX_FINISHED_QTY)}.` }
  if (adjust > 0 && snapshot.expected !== undefined && real > snapshot.expected) {
    return { ok: true, real, adjust, warning: exceedsExpectedMessage(snapshot.expected) }
  }
  return { ok: true, real, adjust }
}

/** Phần thân gửi `stocktake-batch` (không gồm idem): đúng MỘT trong numReal / numAdjust mỗi dòng. */
export function stocktakeBatchLines(mode: StocktakeMode, lines: readonly StocktakeDraftLine[]) {
  return lines.map((l) => ({
    serviceId: l.serviceId,
    ...(mode === 'real' ? { numReal: Number(l.value.trim()) } : { numAdjust: Number(l.value.trim()) }),
    ...(l.note.trim() !== '' ? { note: l.note.trim() } : {}),
  }))
}

// ----- Kết quả theo dòng của phiếu (không nguyên tử — parity Qt) -----

export type BatchLineResult = { index: number; ok: boolean; code?: string; message?: string }

const LINE_CODE_FALLBACK: Record<string, string> = {
  invalid_request: 'Dữ liệu dòng không hợp lệ.',
  invalid_unit: 'Đơn vị nhập không thuộc món này.',
  not_found: 'Không tìm thấy mặt hàng.',
  not_managed: 'Mặt hàng không quản lý tồn.',
  db_error: 'Lỗi cơ sở dữ liệu, dòng chưa được ghi.',
  negative_result: 'Kết quả tồn âm.',
  exceeds_expected: 'Số thực tế vượt tồn sổ sách.',
}

/** Lý do lỗi của dòng: nguyên văn `message` của máy chủ, thiếu thì dùng câu mặc định theo mã. */
export function describeLineError(result: Pick<BatchLineResult, 'code' | 'message'>): string {
  if (result.message && result.message.trim() !== '') return result.message
  return (result.code && LINE_CODE_FALLBACK[result.code]) || 'Dòng chưa được ghi.'
}

export type BatchOutcome = {
  /** Khoá các dòng đã ghi xong (phải biến khỏi lưới). */
  okKeys: Set<string>
  /** Dòng lỗi (hoặc máy chủ không trả kết quả) ⇒ giữ lại kèm lý do. */
  errors: Record<string, string>
  okCount: number
  failCount: number
}

/** Ghép `results[index]` vào dòng đã gửi theo thứ tự. Dòng thiếu kết quả coi như CHƯA ghi (giữ lại). */
export function mergeBatchResults(
  sent: readonly { key: string }[],
  results: readonly BatchLineResult[],
): BatchOutcome {
  const byIndex = new Map<number, BatchLineResult>()
  for (const r of results) byIndex.set(r.index, r)
  const okKeys = new Set<string>()
  const errors: Record<string, string> = {}
  sent.forEach((line, index) => {
    const r = byIndex.get(index)
    if (r?.ok) okKeys.add(line.key)
    else errors[line.key] = r ? describeLineError(r) : 'Máy chủ không trả kết quả cho dòng này — kiểm tra sổ rồi ghi lại.'
  })
  return { okKeys, errors, okCount: okKeys.size, failCount: sent.length - okKeys.size }
}

/** Nhãn trạng thái ngắn của cả lần ghi: dùng cho toast. */
export function batchStatusLabel(okCount: number, failCount: number): string {
  if (failCount === 0) return `Đã ghi ${okCount} dòng.`
  if (okCount === 0) return `Không ghi được dòng nào (${failCount} dòng lỗi).`
  return `Đã ghi ${okCount} dòng, còn ${failCount} dòng lỗi được giữ lại trên phiếu.`
}

// ----- Trạng thái dòng trong lưới -----

export type LineStatus = 'pending' | 'error' | 'warning'

export function lineStatus(error: string | undefined, warning: string | undefined): LineStatus {
  if (error) return 'error'
  return warning ? 'warning' : 'pending'
}

export const LINE_STATUS_LABEL: Record<LineStatus, string> = {
  pending: 'Chờ ghi',
  error: 'Lỗi',
  warning: 'Cảnh báo',
}

// ----- Báo cáo: phân trang 200 dòng, khoảng ngày -----

export const REPORT_PAGE_SIZE = 200

export function reportOffset(page: number, pageSize = REPORT_PAGE_SIZE): number {
  return Math.max(0, page) * pageSize
}

export function reportTotalPages(total: number, pageSize = REPORT_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

const pad2 = (n: number) => String(n).padStart(2, '0')

export function toDateText(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

/** Mặc định: Từ = lùi 1 tháng, Đến = hôm nay (ngày địa phương); cả ngày hôm nay nằm trong khoảng (server gồm 2 đầu). */
export function defaultReportRange(now: Date = new Date()): { fromDate: string; toDate: string } {
  const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate())
  // 31/03 lùi 1 tháng = "31/02" → tràn sang tháng sau; kẹp về ngày cuối tháng trước.
  if (from.getMonth() !== (now.getMonth() + 11) % 12) from.setDate(0)
  return { fromDate: toDateText(from), toDate: toDateText(now) }
}

/** Giờ mặc định của khoảng lọc báo cáo: cả ngày. */
export const REPORT_DEFAULT_FROM_TIME = '00:00'
export const REPORT_DEFAULT_TO_TIME = '23:59'

/**
 * Từ > Đến ⇒ lỗi (Qt báo lỗi, server trả invalid_request). Thiếu một đầu thì hợp lệ. Cùng một ngày thì so tiếp giờ
 * ('HH:mm' so chuỗi được vì luôn đủ 2 chữ số); giờ chỉ có nghĩa khi cả hai ngày đã chọn.
 */
export function validateReportRange(
  fromDate: string,
  toDate: string,
  fromTime: string = REPORT_DEFAULT_FROM_TIME,
  toTime: string = REPORT_DEFAULT_TO_TIME,
): string | null {
  if (fromDate && toDate && fromDate > toDate) return 'Ngày bắt đầu không được sau ngày kết thúc.'
  if (fromDate && toDate && fromDate === toDate && fromTime > toTime) return 'Giờ bắt đầu không được sau giờ kết thúc.'
  return null
}

/** Giờ gửi lên máy chủ: chỉ gửi khi có ngày tương ứng và khác mặc định cả ngày (đường cũ giữ nguyên khi không đổi giờ). */
export function reportTimeFilter(
  fromDate: string,
  toDate: string,
  fromTime: string,
  toTime: string,
): { fromTime?: string; toTime?: string } {
  return {
    ...(fromDate && fromTime && fromTime !== REPORT_DEFAULT_FROM_TIME ? { fromTime } : {}),
    ...(toDate && toTime && toTime !== REPORT_DEFAULT_TO_TIME ? { toTime } : {}),
  }
}

// ----- Mục con của tab Quản lý tồn (giữ trên URL `?view=`) -----

export type StockView = 'stock' | 'imports' | 'stocktakes' | 'closings'

export const STOCK_VIEWS: readonly StockView[] = ['stock', 'imports', 'stocktakes', 'closings']

/** Giá trị lạ/thiếu ⇒ "Tồn kho" (mặc định). */
export function parseStockView(raw: string | null): StockView {
  return STOCK_VIEWS.find((v) => v === raw) ?? 'stock'
}

// ----- Đơn vị quy đổi -----

export const MIN_UNIT_FACTOR = 2
export const MAX_UNIT_FACTOR = 1_000_000

/** Hệ số quy đổi: số nguyên 2..1.000.000; trả null nếu sai. */
export function parseUnitFactor(input: string): number | null {
  const s = input.trim()
  if (!/^\d{1,7}$/.test(s)) return null
  const n = Number(s)
  return n >= MIN_UNIT_FACTOR && n <= MAX_UNIT_FACTOR ? n : null
}

/** "1 thùng = 12 chai". */
export function unitFactorText(unit: string, factor: number, rootUnit: string): string {
  return `1 ${unit} = ${formatInt(factor)} ${rootUnit}`
}

export type UnitChoice = { unitId: number; label: string; factor: number }

/**
 * Lựa chọn "Đơn vị nhập" của một món: đơn vị gốc đứng đầu (unitId 0 = không gửi `unitId`, hệ số 1), sau đó các đơn vị quy đổi.
 * `list` = kết quả `convert-unit/list` (có thể chưa tải / `supported:false` ⇒ chỉ có đơn vị gốc, lấy tên từ `fallbackRootUnit`).
 */
export function unitChoices(
  list: { supported?: boolean; rootUnit?: string; rows?: readonly { unitId: number; unit: string; quantity: number; root: boolean }[] } | undefined,
  fallbackRootUnit: string,
): UnitChoice[] {
  const rootUnit = (list?.rootUnit || fallbackRootUnit || 'đơn vị gốc').trim()
  const choices: UnitChoice[] = [{ unitId: 0, label: rootUnit, factor: 1 }]
  if (!list || list.supported === false) return choices
  for (const row of list.rows ?? []) {
    if (row.root || row.quantity < MIN_UNIT_FACTOR) continue
    choices.push({ unitId: row.unitId, label: `${row.unit} (= ${formatInt(row.quantity)} ${rootUnit})`, factor: row.quantity })
  }
  return choices
}

/** Hệ số của đơn vị đã chọn; không tìm thấy (đơn vị vừa bị xoá…) ⇒ 1 (máy chủ vẫn là nguồn chặn, trả invalid_unit). */
export function unitFactorOf(choices: readonly UnitChoice[], unitId: number): number {
  return choices.find((c) => c.unitId === unitId)?.factor ?? 1
}

/** Tóm tắt kết quả chốt kho cho toast. */
export function closingResultText(closedCount: number, skippedCount: number): string {
  const base = `Đã chốt kho cho ${closedCount} mặt hàng.`
  return skippedCount > 0 ? `${base} ${skippedCount} mặt hàng bị bỏ qua (xem nhật ký máy chủ).` : base
}
