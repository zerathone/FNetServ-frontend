// Logic thuần cho trang Khuyến mãi (không React) — khớp luật của máy chủ (PromotionHandlers.cpp) và form MFC.
// Kiểm bằng tests/promotion-model.test.ts.

// ---------- Ngày ----------

/** Dạng 'YYYY-MM-DD' theo GIỜ ĐỊA PHƯƠNG (máy chủ cũng so ngày theo giờ địa phương). */
export function toYMD(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

let uidCounter = 0
/** Khóa ổn định cho dòng đang soạn (React key) — không gửi lên máy chủ. */
export function nextUid() {
  uidCounter += 1
  return `row-${uidCounter}`
}

export function today() {
  return toYMD(new Date())
}
export function addDaysYMD(ymd: string, days: number) {
  const [year, month, day] = ymd.split('-').map(Number)
  return toYMD(new Date(year, month - 1, day + days))
}

/** Máy chủ (và MFC) chỉ cho ngày bắt đầu lùi tối đa ngần này ngày so với hôm nay. */
export const MAX_BEGIN_DAYS_IN_PAST = 30

const YMD = /^\d{4}-\d{2}-\d{2}$/

/** Trả thông báo lỗi tiếng Việt hoặc null. Cùng luật `validPromotionDates` của máy chủ. */
export function validatePeriod(begin: string, end: string, today: string): string | null {
  if (!YMD.test(begin) || !YMD.test(end)) return 'Hãy chọn đủ ngày bắt đầu và ngày kết thúc.'
  if (begin > end) return 'Ngày kết thúc phải bằng hoặc sau ngày bắt đầu.'
  if (begin < addDaysYMD(today, -MAX_BEGIN_DAYS_IN_PAST)) {
    return `Ngày bắt đầu không được sớm hơn ${MAX_BEGIN_DAYS_IN_PAST} ngày so với hôm nay (giống form MFC). Hãy chọn ngày bắt đầu mới.`
  }
  return null
}

/** Khoảng ngày mặc định khi chưa có khuyến mãi: hôm nay → 30 ngày sau. */
export function defaultPeriod(today: string) {
  return { begin: today, end: addDaysYMD(today, 30) }
}

/**
 * Máy chủ luôn kiểm ngày kể cả khi chỉ xóa hết. Khi không còn gì để áp dụng thì gửi "hôm nay → hôm nay" để việc xóa
 * không bị chặn bởi ngày bắt đầu cũ của khuyến mãi đã hết hạn.
 */
export function periodForSave(begin: string, end: string, hasContent: boolean, today: string) {
  return hasContent ? { begin, end } : { begin: today, end: today }
}

// ---------- Ngày trong tuần (bitmask của máy chủ: CN=1, T2=2, T3=4, T4=8, T5=16, T6=32, T7=64) ----------

export const WEEKDAYS = [
  { bit: 2, short: 'T2', long: 'Thứ Hai' },
  { bit: 4, short: 'T3', long: 'Thứ Ba' },
  { bit: 8, short: 'T4', long: 'Thứ Tư' },
  { bit: 16, short: 'T5', long: 'Thứ Năm' },
  { bit: 32, short: 'T6', long: 'Thứ Sáu' },
  { bit: 64, short: 'T7', long: 'Thứ Bảy' },
  { bit: 1, short: 'CN', long: 'Chủ nhật' },
] as const

export const ALL_DAYS = 127
export const DAY_PRESETS = [
  { label: 'Cả tuần', mask: 127 },
  { label: 'T2 – T6', mask: 62 },
  { label: 'T7, CN', mask: 65 },
] as const

export function toggleDay(mask: number, bit: number) {
  return mask ^ bit
}

/** "Cả tuần", "T2 – T6", "T7, CN", "T2, T4"… — để đọc lướt. */
export function describeDays(mask: number) {
  if (mask <= 0) return 'Chưa chọn ngày'
  if (mask === ALL_DAYS) return 'Cả tuần'
  const picked = WEEKDAYS.filter((day) => (mask & day.bit) !== 0)
  // Dãy liên tiếp từ 3 ngày trở lên (theo thứ tự T2…CN) thì rút gọn "T2 – T6".
  if (picked.length >= 3) {
    const indexes = picked.map((day) => WEEKDAYS.indexOf(day))
    const consecutive = indexes.every((value, i) => i === 0 || value === indexes[i - 1] + 1)
    if (consecutive) return `${picked[0].short} – ${picked[picked.length - 1].short}`
  }
  return picked.map((day) => day.short).join(', ')
}

// ---------- Giờ (máy chủ lưu GIỜ NGUYÊN 0..24, không phải HHMMSS) ----------

export const HOURS_FROM = Array.from({ length: 24 }, (_, i) => i)

export function hoursTo(from: number) {
  return Array.from({ length: 24 - from }, (_, i) => from + 1 + i)
}

export function formatHour(hour: number) {
  return `${String(hour).padStart(2, '0')}:00`
}

/**
 * Đưa giá trị giờ đọc từ máy chủ về giờ nguyên 0..24. Bản web cũ từng lưu dạng HHMMSS (vd 235959): quy về giờ tròn
 * gần nhất không nhỏ hơn và đánh dấu để người dùng kiểm tra lại.
 */
export function normalizeHour(raw: unknown, fallback: number): { hour: number; fixed: boolean } {
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0) return { hour: fallback, fixed: true }
  if (value <= 24) return { hour: Math.floor(value), fixed: false }
  const hours = Math.floor(value / 10000)
  const rest = value % 10000
  return { hour: Math.min(24, rest > 0 ? hours + 1 : hours), fixed: true }
}

// ---------- Khung giờ vàng ----------

export const MAX_PRICE = 999_999

export type TimeRule = {
  uid: string
  machineGroupId: number
  beginHour: number
  endHour: number
  price: number | null
  dayMask: number
}

export function validateTimeRules(rules: TimeRule[]): string | null {
  for (const [index, rule] of rules.entries()) {
    const label = `Khung giờ ${index + 1}`
    if (!rule.machineGroupId) return `${label}: hãy chọn nhóm máy.`
    if (!(rule.endHour > rule.beginHour)) return `${label}: giờ kết thúc phải sau giờ bắt đầu.`
    if (rule.price === null || !Number.isInteger(rule.price) || rule.price < 0 || rule.price > MAX_PRICE) {
      return `${label}: giá phải là số nguyên từ 0 đến ${MAX_PRICE.toLocaleString('vi-VN')} đồng.`
    }
    if (rule.dayMask <= 0 || rule.dayMask > ALL_DAYS) return `${label}: hãy chọn ít nhất một ngày trong tuần.`
  }
  return null
}

/** Cặp khung (chỉ số) cùng nhóm máy, trùng ngày và chồng giờ — hệ thống chỉ lấy một giá cho mỗi phút. */
export function findTimeOverlaps(rules: TimeRule[]): Array<[number, number]> {
  const pairs: Array<[number, number]> = []
  for (let i = 0; i < rules.length; i += 1) {
    for (let j = i + 1; j < rules.length; j += 1) {
      const a = rules[i]
      const b = rules[j]
      if (a.machineGroupId !== b.machineGroupId || !a.machineGroupId) continue
      if ((a.dayMask & b.dayMask) === 0) continue
      if (a.beginHour < b.endHour && b.beginHour < a.endHour) pairs.push([i, j])
    }
  }
  return pairs
}

// ---------- Giảm giá theo thời gian sử dụng ----------

/** 0 = "Bắt đầu" (đợt đầu), 1 = "Tiếp theo" (các đợt sau) — đúng nhãn form MFC. */
export type DiscountOrder = 0 | 1

export type DiscountRule = {
  uid: string
  machineGroupId: number
  order: DiscountOrder
  hours: number
  price: number | null
}

export const DISCOUNT_HOURS = Array.from({ length: 24 }, (_, i) => i + 1)

export function validateDiscountRules(rules: DiscountRule[]): string | null {
  for (const [index, rule] of rules.entries()) {
    const label = `Dòng ${index + 1}`
    if (!rule.machineGroupId) return `${label}: hãy chọn nhóm máy.`
    if (!Number.isInteger(rule.hours) || rule.hours < 1 || rule.hours > 24) return `${label}: số giờ từ 1 đến 24.`
    if (rule.price === null || !Number.isInteger(rule.price) || rule.price < 0 || rule.price > MAX_PRICE) {
      return `${label}: giá phải là số nguyên từ 0 đến ${MAX_PRICE.toLocaleString('vi-VN')} đồng.`
    }
  }
  return null
}

// ---------- Khuyến mãi nạp tiền ----------

export type MemberPolicyKind = 'none' | 'accumulate' | 'free' | 'percent'
export type TierRow = { uid: string; charge: number | null; value: number | null }

export type MemberDraft = {
  policy: MemberPolicyKind
  accumulate: { charge: number | null; bonus: number | null }
  freeTiers: TierRow[]
  percentTiers: TierRow[]
  firstDeposit: { percent: number | null; minAmount: number | null }
}

/** Có gì để áp dụng không (cần ngày) — chính sách khác "không có" hoặc có nạp lần đầu. */
export function memberHasContent(draft: MemberDraft) {
  return draft.policy !== 'none' || (draft.firstDeposit.percent ?? 0) > 0
}

function validateTiers(tiers: TierRow[], kind: 'free' | 'percent'): string | null {
  if (tiers.length === 0) return 'Hãy thêm ít nhất một mốc nạp.'
  const seen = new Set<number>()
  for (const [index, tier] of tiers.entries()) {
    const label = `Mốc ${index + 1}`
    if (tier.charge === null || tier.charge <= 0) return `${label}: mức nạp phải lớn hơn 0.`
    if (tier.value === null || tier.value <= 0) {
      return `${label}: ${kind === 'free' ? 'số tiền tặng' : 'phần trăm tặng'} phải lớn hơn 0.`
    }
    if (kind === 'percent' && tier.value > 100) return `${label}: phần trăm tặng tối đa 100.`
    if (seen.has(tier.charge)) return `${label}: mức nạp bị trùng với mốc khác.`
    seen.add(tier.charge)
  }
  return null
}

export function validateMemberDraft(draft: MemberDraft): string | null {
  if (draft.policy === 'accumulate') {
    const { charge, bonus } = draft.accumulate
    if (charge === null || charge <= 0 || bonus === null || bonus <= 0) return 'Chính sách tích lũy: nhập số tiền tích lũy và số tiền tặng lớn hơn 0.'
    if (bonus > charge) return 'Chính sách tích lũy: số tiền tặng không được lớn hơn số tiền tích lũy.'
  } else if (draft.policy === 'free') {
    const error = validateTiers(draft.freeTiers, 'free')
    if (error) return `Tặng tiền theo mức: ${error}`
  } else if (draft.policy === 'percent') {
    const error = validateTiers(draft.percentTiers, 'percent')
    if (error) return `Tặng % theo mức: ${error}`
  }
  const { percent, minAmount } = draft.firstDeposit
  if ((percent ?? 0) > 0) {
    if (percent! > 100) return 'Nạp lần đầu: phần trăm tặng tối đa 100.'
    if (minAmount !== null && minAmount < 0) return 'Nạp lần đầu: mức nạp tối thiểu không được âm.'
  }
  return null
}

/** Lời giải thích một dòng cho mỗi chính sách — hiện ngay trên lựa chọn để khỏi phải đoán. */
export const MEMBER_POLICY_OPTIONS: Array<{ value: MemberPolicyKind; label: string; hint: string }> = [
  { value: 'none', label: 'Không áp dụng', hint: 'Không tặng thêm khi nạp tiền.' },
  { value: 'accumulate', label: 'Tích lũy', hint: 'Nạp đủ một số tiền tích lũy thì tặng thêm một khoản.' },
  { value: 'free', label: 'Tặng tiền theo mức', hint: 'Nạp từ mỗi mức trở lên thì tặng một số tiền cố định.' },
  { value: 'percent', label: 'Tặng % theo mức', hint: 'Nạp từ mỗi mức trở lên thì tặng thêm một phần trăm.' },
]

export function formatMoney(value: number) {
  return new Intl.NumberFormat('vi-VN').format(value)
}
