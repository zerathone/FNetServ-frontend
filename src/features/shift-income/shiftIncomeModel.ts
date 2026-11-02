// Mô hình dữ liệu widget "Nguồn thu ca" ở sidebar. Nguồn: /rptv2 type 43 (báo cáo ca V2) của CHÍNH nhân viên đang
// đăng nhập, khung 24 giờ trượt (cùng khung với ô thống kê COMBO / Đơn dịch vụ).
//
// Type 43 trả 7 dòng cố định, mỗi dòng [tên, số lượt, tiền mặt, chuyển khoản, QR, tổng]:
//   dòng 0-5 = 6 nguồn thu, dòng 6 = "Doanh thu" (tổng). Widget gộp 6 dòng đó thành 3 nguồn (SOURCE_GROUPS).
// PY_GUESS_SERVICE (dịch vụ tiền mặt của khách tại quầy) ĐÃ nằm trong dòng "Dịch vụ [FNet]" — CReportUtils::
// PaymentTypes thêm nó cho nguồn dịch vụ ở cả 3 nhánh (ReportUtils.cpp:245, 268, 280) — nên 6 dòng nguồn cộng lại
// bằng dòng 6 ở các cột hình thức. Widget tự cộng từ 6 nguồn, KHÔNG đọc cột "tổng" (index 5) của dòng 6 vì cột đó
// còn gồm PY_TRANSFER_SERVICE mà các cột hình thức không có.
// CẤN TRỪ: server hiện CHƯA trả (các dòng *_DEDUCT trong CReportUtils::PaymentTypes đang bị comment). Khi server
// thêm cột thứ 7 (index 6 = cấn trừ) cho mỗi dòng thì widget tự hiện; chưa có thì `hasDeduct=false`.
import { parseNum } from '../reports/incomeByStaffModel'

export type MethodKey = 'cash' | 'bank' | 'qr' | 'deduct'
export type SortKey = 'total' | MethodKey

/** Thứ tự hiển thị trong danh sách hình thức và checklist. */
export const METHOD_KEYS: readonly MethodKey[] = ['cash', 'bank', 'qr', 'deduct']

export const METHOD_LABEL: Record<MethodKey, string> = {
  cash: 'Tiền mặt',
  bank: 'Chuyển khoản',
  qr: 'QR',
  deduct: 'Cấn trừ',
}

/** true = tính vào tổng thu. Cấn trừ mặc định KHÔNG tính (không phải tiền thu mới) — xem store/revenuePrefs. */
export type MethodSelection = Record<MethodKey, boolean>

// 3 nguồn thu GỘP (user chốt 2026-11-01): khách vãng lai, thẻ nạp tiền, công nợ thực chất đều là tiền giờ nên gộp
// chung với nạp hội viên thành "Nạp tiền". Mỗi nhóm gồm các dòng gốc (RowKey) của type 43; checklist vẫn chọn theo
// dòng gốc nên khoản nào bỏ chọn thì biến mất khỏi nhóm lẫn tổng.
export type SourceKey = 'topup' | 'combo' | 'service'
export type RowKey = 'member' | 'anonym' | 'combo' | 'card' | 'service' | 'debt'

export const ROW_KEYS: readonly RowKey[] = ['member', 'anonym', 'combo', 'card', 'service', 'debt']

/** true = tính vào tổng thu. Mặc định tất cả đều tính. Khóa lưu trữ là dòng gốc nên giá trị lưu từ bản trước vẫn dùng được. */
export type SourceSelection = Record<RowKey, boolean>

// BẮT BUỘC: luôn tính vào tổng, checklist khóa lại, bỏ qua giá trị đã lưu trước đó.
export const MANDATORY_METHODS: readonly MethodKey[] = ['cash', 'qr']
export const MANDATORY_SOURCES: readonly RowKey[] = ['member', 'combo', 'service']

// Dòng của type 43: 0 nạp hội viên, 1 khách vãng lai, 2 combo, 3 thẻ nạp tiền, 4 dịch vụ [FNet], 5 công nợ
// (dòng 6 = tổng, không dùng). Nhãn khớp StaffStatCard của trang báo cáo (IncomeByStaffStats.tsx).
export const SOURCE_GROUPS: ReadonlyArray<{
  key: SourceKey
  name: string
  rows: ReadonlyArray<{ key: RowKey; index: number; name: string }>
}> = [
  {
    key: 'topup',
    name: 'Nạp tiền',
    rows: [
      { key: 'member', index: 0, name: 'Nạp hội viên' },
      { key: 'anonym', index: 1, name: 'Khách vãng lai' },
      { key: 'card', index: 3, name: 'Thẻ nạp tiền' },
      { key: 'debt', index: 5, name: 'Công nợ' },
    ],
  },
  { key: 'combo', name: 'Combo', rows: [{ key: 'combo', index: 2, name: 'Combo' }] },
  { key: 'service', name: 'Dịch vụ', rows: [{ key: 'service', index: 4, name: 'Dịch vụ [FNet]' }] },
]

/** Một bộ số theo hình thức: dùng cho cả nguồn gộp lẫn từng dòng gốc bên trong. */
export interface IncomePart<K extends string = string> {
  key: K
  name: string
  count: number
  cash: number
  bank: number
  qr: number
  deduct: number
}

export interface IncomeSource extends IncomePart<SourceKey> {
  /** Các dòng gốc của nguồn (luôn đủ, kể cả nguồn chỉ có một dòng); số của nguồn = cộng các dòng này. */
  parts: IncomePart<RowKey>[]
}

export interface ShiftIncome {
  /** 3 nguồn gộp từ 6 dòng nguồn của type 43 (xem SOURCE_GROUPS), CHƯA áp dụng checklist — xem selectSources. */
  sources: IncomeSource[]
  /** false = server chưa trả cột cấn trừ (deduct luôn 0, không có nghĩa là "không phát sinh"). */
  hasDeduct: boolean
}

type RowArr = unknown[]

function cell(row: unknown, col: number): number {
  return parseNum(Array.isArray(row) ? (row as RowArr)[col] : 0)
}

/** null khi dữ liệu không đủ 7 dòng (BE lỗi / chưa có quyền) — UI coi như chưa có số liệu. */
export function buildShiftIncome(data: unknown): ShiftIncome | null {
  if (!Array.isArray(data) || data.length < 7) return null
  const sum = data[6]
  const hasDeduct = Array.isArray(sum) && (sum as RowArr).length >= 7
  const sources = SOURCE_GROUPS.map<IncomeSource>(({ key, name, rows }) => {
    const parts = rows.map<IncomePart<RowKey>>((row) => {
      const source = data[row.index]
      return {
        key: row.key,
        name: row.name,
        count: cell(source, 1),
        cash: cell(source, 2),
        bank: cell(source, 3),
        qr: cell(source, 4),
        deduct: hasDeduct ? cell(source, 6) : 0,
      }
    })
    return { ...sumParts(key, name, parts), parts }
  })
  return { sources, hasDeduct }
}

function sumParts<K extends string>(key: K, name: string, parts: readonly IncomePart[]): IncomePart<K> {
  const total = (pick: (part: IncomePart) => number) => parts.reduce((sum, part) => sum + pick(part), 0)
  return {
    key,
    name,
    count: total((part) => part.count),
    cash: total((part) => part.cash),
    bank: total((part) => part.bank),
    qr: total((part) => part.qr),
    deduct: total((part) => part.deduct),
  }
}

/** Áp checklist nguồn thu: dòng gốc bỏ chọn biến mất, số của nguồn cộng lại từ các dòng còn lại; nguồn hết dòng thì bỏ. */
export function selectSources(income: ShiftIncome, selection: SourceSelection): IncomeSource[] {
  return income.sources
    .map<IncomeSource>((source) => {
      const parts = source.parts.filter((part) => selection[part.key])
      return { ...sumParts(source.key, source.name, parts), parts }
    })
    .filter((source) => source.parts.length > 0)
}

/** Các hình thức có số liệu: cấn trừ chỉ có khi server đã trả. */
export function availableMethods(income: ShiftIncome): MethodKey[] {
  return METHOD_KEYS.filter((key) => key !== 'deduct' || income.hasDeduct)
}

/** Cộng các hình thức đang được chọn của MỘT nguồn (hoặc một bộ số bất kỳ có đủ 4 hình thức). */
export function sumSelected(
  values: Pick<IncomePart, MethodKey>,
  methods: readonly MethodKey[],
  selection: MethodSelection,
): number {
  return methods.reduce((sum, key) => sum + (selection[key] ? values[key] : 0), 0)
}

export interface IncomeSummary {
  /** Số tiền từng hình thức, chỉ cộng các nguồn đang chọn (hình thức bỏ chọn vẫn có số trong bảng cài đặt). */
  byMethod: Record<MethodKey, number>
  /** Cộng nguồn đang chọn x hình thức đang chọn. Mọi số trên widget suy ra từ đây nên luôn khớp nhau. */
  total: number
  /** Số lượt của các nguồn đang chọn. */
  count: number
}

export function summarize(
  sources: readonly IncomePart[],
  methods: readonly MethodKey[],
  methodSelection: MethodSelection,
): IncomeSummary {
  const byMethod: Record<MethodKey, number> = { cash: 0, bank: 0, qr: 0, deduct: 0 }
  let count = 0
  for (const source of sources) {
    for (const key of METHOD_KEYS) byMethod[key] += source[key]
    count += source.count
  }
  return { byMethod, total: sumSelected(byMethod, methods, methodSelection), count }
}

/** Xếp nguồn thu giảm dần theo tổng (chỉ các hình thức đã chọn) hoặc theo một hình thức; ổn định khi bằng nhau. */
export function sortSources<T extends IncomePart>(
  sources: T[],
  key: SortKey,
  methods: readonly MethodKey[],
  selection: MethodSelection,
): T[] {
  const valueOf = (source: T) => (key === 'total' ? sumSelected(source, methods, selection) : source[key])
  return sources
    .map((source, index) => ({ source, index }))
    .sort((a, b) => valueOf(b.source) - valueOf(a.source) || a.index - b.index)
    .map((item) => item.source)
}

export function maxCell(sources: IncomePart[], methods: readonly MethodKey[]): number {
  return sources.reduce((max, s) => Math.max(max, ...methods.map((key) => s[key])), 0)
}

export function formatVnd(value: number): string {
  return new Intl.NumberFormat('vi-VN').format(Math.round(value))
}

/** 2.800.000 -> "2,8tr", 420.000 -> "420k", 0 -> "–" (ô trong ma trận hẹp). */
export function formatCompact(value: number): string {
  if (value <= 0) return '–'
  if (value >= 1_000_000) {
    return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 1 }).format(value / 1_000_000)}tr`
  }
  return `${Math.round(value / 1000)}k`
}

const pad = (n: number) => String(n).padStart(2, '0')

export interface ShiftWindow {
  fromDate: string
  fromTime: string
  toDate: string
  /** "HH:mm dd/MM" — mốc bắt đầu để hiện trên widget. */
  sinceLabel: string
}

/**
 * 24 giờ trượt tính lùi từ `now` (đồng bộ với CompletedWindow phía server). Dùng giờ trình duyệt; chặn trên
 * để server mặc định 23:59:59 của `toDate` nên lệch đồng hồ nhỏ không làm mất giao dịch mới.
 */
export function rolling24hWindow(now: Date): ShiftWindow {
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000)
  const date = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  return {
    fromDate: date(from),
    fromTime: `${pad(from.getHours())}:${pad(from.getMinutes())}:${pad(from.getSeconds())}`,
    toDate: date(now),
    sinceLabel: `${pad(from.getHours())}:${pad(from.getMinutes())} ${pad(from.getDate())}/${pad(from.getMonth() + 1)}`,
  }
}
