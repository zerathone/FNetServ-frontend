export type BirthdayWeek = {
  /** `today` = đúng hôm nay; `week` = còn lại trong tuần (thứ Hai → Chủ nhật) chứa hôm nay. */
  kind: 'today' | 'week'
  /** Số ngày từ hôm nay tới sinh nhật: 0 hôm nay, dương = sắp tới, âm = đã qua trong tuần. */
  daysFromToday: number
  /** Chữ cho tooltip / trình đọc màn hình. */
  label: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function isLeapYear(year: number) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
}

/** Ngày dương lịch (giờ địa phương, 00:00) — tránh lệch múi giờ khi so ngày. */
function localDay(year: number, month: number, day: number) {
  return new Date(year, month - 1, day)
}

/**
 * Sinh nhật có rơi vào tuần hiện tại (thứ Hai → Chủ nhật) không.
 * - `birthday`: 'YYYY-MM-DD' (server trả '0000-00-00' khi chưa nhập → null).
 * - Sinh 29/02 mà năm không nhuận: tính 28/02.
 * - Tuần vắt qua giao thừa (vd 29/12 → 04/01) vẫn nhận đúng sinh nhật đầu/cuối năm.
 */
export function birthdayWeekStatus(birthday: string | null | undefined, today: Date = new Date()): BirthdayWeek | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec((birthday ?? '').trim())
  if (!match) return null
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31 || match[1] === '0000') return null

  const todayStart = localDay(today.getFullYear(), today.getMonth() + 1, today.getDate())
  const weekday = (todayStart.getDay() + 6) % 7 // 0 = thứ Hai
  const weekStart = todayStart.getTime() - weekday * DAY_MS
  const weekEnd = weekStart + 6 * DAY_MS

  for (const year of [today.getFullYear() - 1, today.getFullYear(), today.getFullYear() + 1]) {
    const effectiveDay = month === 2 && day === 29 && !isLeapYear(year) ? 28 : day
    const date = localDay(year, month, effectiveDay)
    // Ngày không tồn tại (vd 31/04) bị JS cuộn sang tháng sau → bỏ.
    if (date.getMonth() + 1 !== month) return null
    const time = date.getTime()
    if (time < weekStart || time > weekEnd) continue

    const daysFromToday = Math.round((time - todayStart.getTime()) / DAY_MS)
    const dateText = `${String(effectiveDay).padStart(2, '0')}/${String(month).padStart(2, '0')}`
    if (daysFromToday === 0) return { kind: 'today', daysFromToday, label: 'Hôm nay là sinh nhật' }
    const when = daysFromToday > 0 ? `còn ${daysFromToday} ngày nữa` : `đã qua ${-daysFromToday} ngày`
    return { kind: 'week', daysFromToday, label: `Tuần sinh nhật (${dateText}, ${when})` }
  }
  return null
}

export type BirthdayMonthOption = {
  /** 1..12 */
  month: number
  /** "Tháng 11" */
  label: string
  /** Số tài khoản sinh tháng này (thiếu dữ liệu ⇒ 0). */
  count: number
  /** Tháng hiện tại (luôn là phần tử đầu danh sách). */
  isCurrent: boolean
}

/**
 * 12 tháng cho dropdown lọc sinh nhật: BẮT ĐẦU từ tháng hiện tại rồi tăng dần, vòng qua tháng 12 → 1
 * (vd hiện tại = 11 ⇒ 11, 12, 1, 2, … 10). `counts[m - 1]` là số tài khoản sinh tháng m.
 */
export function birthdayMonthOptions(current: number, counts: readonly number[] | undefined): BirthdayMonthOption[] {
  const start = Number.isInteger(current) && current >= 1 && current <= 12 ? current : 1
  return Array.from({ length: 12 }, (_, offset) => {
    const month = ((start - 1 + offset) % 12) + 1
    return { month, label: `Tháng ${month}`, count: counts?.[month - 1] ?? 0, isCurrent: offset === 0 }
  })
}
