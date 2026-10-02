// Logic thuần (không import client/store) cho "Dọn dẹp hội viên" + "Tìm kiếm nâng cao":
// giá trị mặc định theo MFC, validate, dựng query/body, map lỗi server -> câu tiếng Việt.
// Giữ thuần để chạy bằng node --test (tests/user-admin-model.test.ts).
// Hợp đồng REST: handoff/HANDOFF_web-user-cleanup-search.md §4.2.

export const USER_ADMIN_RIGHTS = {
  /** R_DELETE_USER — dọn dẹp + xóa hội viên (/users/clean-candidates, /users/batch). */
  DELETE_USER: 23,
  /** R_USERGROUP_MODIFY_USER — đổi nhóm hàng loạt (/users/change-group). */
  USERGROUP_MODIFY_USER: 224,
} as const

/** Mã nhóm giá loại MEMBER (UGTYPE::MEMBER) trong /usergroup. */
export const MEMBER_GROUP_TYPE_CODE = 2

/** MFC phân trang 200 dòng/trang (CleanMemberList). */
export const CLEAN_PAGE_SIZE = 200
/** Server kẹp maxRemain trong khoảng int32. */
const MAX_REMAIN_LIMIT = 2_147_483_647
/** MFC DDV_MaxChars cho ô tiền. */
const MONEY_MAX_DIGITS = 11

export type SortDir = 'asc' | 'desc'
export type SortChoice = 'none' | SortDir
export type TriState = 'any' | 'yes' | 'no'

// ─── Ngày ────────────────────────────────────────────────────────────────────

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function toIsoDate(date: Date): string {
  const y = String(date.getFullYear()).padStart(4, '0')
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** YYYY-MM-DD hợp lệ thật (không nhận 2026-02-31). */
export function isValidIsoDate(value: string): boolean {
  const match = ISO_DATE.exec(value)
  if (!match) return false
  const [, y, m, d] = match
  const date = new Date(Number(y), Number(m) - 1, Number(d))
  return (
    date.getFullYear() === Number(y) &&
    date.getMonth() === Number(m) - 1 &&
    date.getDate() === Number(d)
  )
}

/** Lùi `months` tháng, kẹp ngày cuối tháng (31/8 lùi 6 tháng -> 28/2, không nhảy sang tháng 3). */
export function monthsBefore(today: Date, months: number): Date {
  const target = new Date(today.getFullYear(), today.getMonth() - months, 1)
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(today.getDate(), lastDay))
  return target
}

// ─── Dọn dẹp hội viên ────────────────────────────────────────────────────────

export type CleanDebitMode = 'no' | 'have' | 'all'

export type CleanForm = {
  useLastLogin: boolean
  lastLogin: string
  useMaxRemain: boolean
  maxRemain: string
  debit: CleanDebitMode
  sortLastLogin: SortChoice
  sortRemain: SortChoice
}

/** Mặc định = CCleanMemberDlg: đăng nhập cuối 6 tháng trước, số dư ≤ 1000, không nợ. */
export function defaultCleanForm(today: Date = new Date()): CleanForm {
  return {
    useLastLogin: true,
    lastLogin: toIsoDate(monthsBefore(today, 6)),
    useMaxRemain: true,
    maxRemain: '1000',
    debit: 'no',
    sortLastLogin: 'none',
    sortRemain: 'none',
  }
}

export type FormErrors<T> = Partial<Record<keyof T, string>>

export function validateCleanForm(form: CleanForm, today: Date = new Date()): FormErrors<CleanForm> {
  const errors: FormErrors<CleanForm> = {}
  if (form.useLastLogin) {
    if (!isValidIsoDate(form.lastLogin)) {
      errors.lastLogin = 'Chọn ngày hợp lệ.'
    } else if (form.lastLogin >= toIsoDate(today)) {
      errors.lastLogin = 'Ngày đăng nhập cuối phải trước hôm nay.'
    }
  }
  if (form.useMaxRemain) {
    if (!form.maxRemain) {
      errors.maxRemain = 'Nhập số dư tối đa.'
    } else if (!/^\d+$/.test(form.maxRemain) || Number(form.maxRemain) > MAX_REMAIN_LIMIT) {
      errors.maxRemain = 'Số dư tối đa chỉ gồm chữ số và không quá 2.147.483.647.'
    }
  }
  return errors
}

function sortParam(params: URLSearchParams, key: string, choice: SortChoice) {
  if (choice !== 'none') params.set(key, choice)
}

/** Query string (không có dấu ?) cho GET /users/clean-candidates. Form đã validate. */
export function buildCleanQuery(form: CleanForm, page: number): string {
  const params = new URLSearchParams()
  if (form.useLastLogin) {
    params.set('lastLogin', form.lastLogin)
  } else {
    params.set('useLastLogin', '0')
  }
  if (form.useMaxRemain) {
    params.set('maxRemain', form.maxRemain)
  } else {
    params.set('useMaxRemain', '0')
  }
  params.set('debit', form.debit)
  sortParam(params, 'sortLastLogin', form.sortLastLogin)
  sortParam(params, 'sortRemain', form.sortRemain)
  params.set('limit', String(CLEAN_PAGE_SIZE))
  params.set('offset', String(page * CLEAN_PAGE_SIZE))
  return params.toString()
}

export type CleanCandidateLike = { remainMoney: number }

export function sumRemainMoney(items: readonly CleanCandidateLike[]): number {
  return items.reduce((sum, item) => sum + (item.remainMoney || 0), 0)
}

// ─── Tìm kiếm nâng cao ───────────────────────────────────────────────────────

export type AdvForm = {
  useMaxPaid: boolean
  maxPaid: string
  useMinPaid: boolean
  minPaid: string
  sortPaid: SortChoice
  useLapse: boolean
  lapseFrom: string
  lapseTo: string
  useMaxRemain: boolean
  maxRemain: string
  useMinRemain: boolean
  minRemain: string
  sortRemain: SortChoice
  idNumber: TriState
  phone: TriState
}

/** Bộ lọc dạng gửi server (chuỗi, chỉ chứa trường đang dùng). Dùng làm "snapshot" đã bấm Tìm. */
export type AdvFilter = Partial<{
  maxPaid: string
  minPaid: string
  sortPaid: SortDir
  maxRemain: string
  minRemain: string
  sortRemain: SortDir
  idNumber: '0' | '1'
  phone: '0' | '1'
  lapseFrom: string
  lapseTo: string
}>

/** Mặc định = CUserSearchAdvDlg: sắp xếp theo đã nạp giảm dần; khoảng ngày điền sẵn 1 tháng -> hôm nay nhưng tắt. */
export function defaultAdvForm(today: Date = new Date()): AdvForm {
  return {
    useMaxPaid: false,
    maxPaid: '',
    useMinPaid: false,
    minPaid: '',
    sortPaid: 'desc',
    useLapse: false,
    lapseFrom: toIsoDate(monthsBefore(today, 1)),
    lapseTo: toIsoDate(today),
    useMaxRemain: false,
    maxRemain: '',
    useMinRemain: false,
    minRemain: '',
    sortRemain: 'none',
    idNumber: 'any',
    phone: 'any',
  }
}

function moneyError(value: string, label: string): string | undefined {
  if (!value) return `Nhập ${label}.`
  if (!/^\d+$/.test(value)) return `${label} chỉ gồm chữ số.`
  if (value.length > MONEY_MAX_DIGITS) return `${label} tối đa ${MONEY_MAX_DIGITS} chữ số.`
  return undefined
}

export function validateAdvForm(form: AdvForm, today: Date = new Date()): FormErrors<AdvForm> {
  const errors: FormErrors<AdvForm> = {}
  const check = (
    use: boolean,
    key: 'maxPaid' | 'minPaid' | 'maxRemain' | 'minRemain',
    label: string,
  ) => {
    if (!use) return
    const message = moneyError(form[key], label)
    if (message) errors[key] = message
  }
  check(form.useMaxPaid, 'maxPaid', 'số đã nạp tối đa')
  check(form.useMinPaid, 'minPaid', 'số đã nạp tối thiểu')
  check(form.useMaxRemain, 'maxRemain', 'số còn lại tối đa')
  check(form.useMinRemain, 'minRemain', 'số còn lại tối thiểu')

  if (
    form.useMaxPaid && form.useMinPaid && !errors.maxPaid && !errors.minPaid &&
    Number(form.minPaid) > Number(form.maxPaid)
  ) {
    errors.minPaid = 'Số đã nạp tối thiểu không được lớn hơn tối đa.'
  }
  if (
    form.useMaxRemain && form.useMinRemain && !errors.maxRemain && !errors.minRemain &&
    Number(form.minRemain) > Number(form.maxRemain)
  ) {
    errors.minRemain = 'Số còn lại tối thiểu không được lớn hơn tối đa.'
  }

  if (form.useLapse) {
    const todayIso = toIsoDate(today)
    if (!isValidIsoDate(form.lapseFrom)) {
      errors.lapseFrom = 'Chọn ngày bắt đầu hợp lệ.'
    }
    if (!isValidIsoDate(form.lapseTo)) {
      errors.lapseTo = 'Chọn ngày kết thúc hợp lệ.'
    } else if (form.lapseTo > todayIso) {
      errors.lapseTo = 'Ngày kết thúc không được ở tương lai.'
    }
    if (!errors.lapseFrom && !errors.lapseTo && form.lapseFrom > form.lapseTo) {
      errors.lapseFrom = 'Ngày bắt đầu không được sau ngày kết thúc.'
    }
  }
  return errors
}

/** Form đã validate -> bộ lọc gửi server (bỏ trường tắt). */
export function toAdvFilter(form: AdvForm): AdvFilter {
  const filter: AdvFilter = {}
  if (form.useMaxPaid) filter.maxPaid = form.maxPaid
  if (form.useMinPaid) filter.minPaid = form.minPaid
  if (form.sortPaid !== 'none') filter.sortPaid = form.sortPaid
  if (form.useMaxRemain) filter.maxRemain = form.maxRemain
  if (form.useMinRemain) filter.minRemain = form.minRemain
  if (form.sortRemain !== 'none') filter.sortRemain = form.sortRemain
  if (form.idNumber !== 'any') filter.idNumber = form.idNumber === 'yes' ? '1' : '0'
  if (form.phone !== 'any') filter.phone = form.phone === 'yes' ? '1' : '0'
  if (form.useLapse) {
    filter.lapseFrom = form.lapseFrom
    filter.lapseTo = form.lapseTo
  }
  return filter
}

/** Có ít nhất 1 tiêu chí lọc thật (sort không tính). Server chặn đổi nhóm khi không có (NO_FILTER). */
export function advHasCriteria(filter: AdvFilter | null | undefined): boolean {
  if (!filter) return false
  return Boolean(
    filter.maxPaid !== undefined ||
      filter.minPaid !== undefined ||
      filter.maxRemain !== undefined ||
      filter.minRemain !== undefined ||
      filter.idNumber !== undefined ||
      filter.phone !== undefined ||
      (filter.lapseFrom !== undefined && filter.lapseTo !== undefined),
  )
}

export function buildAdvQuery(filter: AdvFilter, limit: number, offset: number): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined) params.set(key, value)
  }
  params.set('limit', String(limit))
  params.set('offset', String(offset))
  return params.toString()
}

/** Nhãn cột khi LAPSE bật: moneyPaid = nạp trong khoảng, moneyUsed vẫn là cả đời (server). */
export function advColumnLabel(
  column: string,
  baseLabel: string,
  filter: AdvFilter | null | undefined,
): string {
  if (!filter || filter.lapseFrom === undefined) return baseLabel
  if (column === 'moneyPaid') return 'Đã nạp trong khoảng'
  if (column === 'moneyUsed') return 'Đã dùng (tổng)'
  return baseLabel
}

/** Mô tả ngắn các điều kiện đang áp dụng, hiện trên chip "Đang lọc nâng cao". */
export function describeAdvFilter(filter: AdvFilter): string {
  const fmt = (value: string) => new Intl.NumberFormat('vi-VN').format(Number(value))
  const parts: string[] = []
  if (filter.minPaid !== undefined) parts.push(`đã nạp ≥ ${fmt(filter.minPaid)}`)
  if (filter.maxPaid !== undefined) parts.push(`đã nạp ≤ ${fmt(filter.maxPaid)}`)
  if (filter.lapseFrom !== undefined) parts.push(`nạp ${filter.lapseFrom} → ${filter.lapseTo}`)
  if (filter.minRemain !== undefined) parts.push(`còn lại ≥ ${fmt(filter.minRemain)}`)
  if (filter.maxRemain !== undefined) parts.push(`còn lại ≤ ${fmt(filter.maxRemain)}`)
  if (filter.idNumber !== undefined) parts.push(filter.idNumber === '1' ? 'có CCCD' : 'không có CCCD')
  if (filter.phone !== undefined) parts.push(filter.phone === '1' ? 'có điện thoại' : 'không có điện thoại')
  return parts.length ? parts.join(' · ') : 'chỉ sắp xếp'
}

export type ChangeGroupBody = AdvFilter & {
  groupId: number
  confirm: boolean
  expectedCount?: number
}

export function buildChangeGroupBody(
  filter: AdvFilter,
  groupId: number,
  confirm: boolean,
  expectedCount?: number,
): ChangeGroupBody {
  const body: ChangeGroupBody = { ...filter, groupId, confirm }
  if (confirm && expectedCount !== undefined) body.expectedCount = expectedCount
  return body
}

// ─── Kết quả xóa / lỗi server ────────────────────────────────────────────────

export type DeleteResultLike = { deleted: boolean; deletedCount?: number; failed?: number[] }

export type Outcome = { tone: 'success' | 'error' | 'info'; message: string }

/** Chỉ báo thành công khi server xác nhận `deleted:true` và thật sự xóa được ≥ 1. */
export function summarizeDeleteResult(requested: number, result: DeleteResultLike): Outcome {
  if (!result.deleted) {
    return { tone: 'error', message: 'Máy chủ chưa xóa tài khoản nào (mới chỉ xem trước).' }
  }
  const deleted = result.deletedCount ?? 0
  const failed = result.failed?.length ?? 0
  if (deleted <= 0) {
    return { tone: 'error', message: `Không xóa được tài khoản nào (${failed || requested} lỗi).` }
  }
  if (failed > 0) {
    return {
      tone: 'error',
      message: `Đã xóa ${deleted}/${requested} tài khoản, ${failed} tài khoản xóa lỗi.`,
    }
  }
  return { tone: 'success', message: `Đã xóa ${deleted} tài khoản.` }
}

type ErrorLike = { name?: string; message?: string; details?: unknown }

function errorDetails(error: unknown): { code?: string; totalDebit?: number; count?: number } {
  const details = (error as ErrorLike | null)?.details
  if (details && typeof details === 'object') {
    return details as { code?: string; totalDebit?: number; count?: number }
  }
  return {}
}

/** RbacDeniedError đã được client.ts hiện toast — tầng trên không toast thêm lần nữa. */
export function isRbacDenied(error: unknown): boolean {
  return (error as ErrorLike | null)?.name === 'RbacDeniedError'
}

const money = (value: number) => `${new Intl.NumberFormat('vi-VN').format(value)} đ`

/** Lỗi guard của /users/batch (code nằm ở err.details.code, KHÔNG ở data). */
export function describeDeleteError(error: unknown): string {
  const { code, totalDebit } = errorDetails(error)
  switch (code) {
    case 'HAS_DEBIT':
      return totalDebit
        ? `Có tài khoản còn nợ (tổng ${money(totalDebit)}), không xóa được cả lô.`
        : 'Có tài khoản còn nợ, không xóa được cả lô.'
    case 'STAFF_REQUIRES_ADMIN':
      return 'Danh sách có tài khoản nhân viên, chỉ quản trị viên mới được xóa.'
    case 'STAFF_HAS_PAYMENT':
      return 'Danh sách có nhân viên đã phát sinh thanh toán, không xóa được.'
    default:
      return (error as ErrorLike | null)?.message || 'Không xóa được tài khoản.'
  }
}

export function describeChangeGroupError(error: unknown): string {
  const { code } = errorDetails(error)
  switch (code) {
    case 'NO_FILTER':
      return 'Cần ít nhất một điều kiện lọc.'
    case 'COUNT_MISMATCH':
      return 'Dữ liệu đã thay đổi, vui lòng tải lại.'
    default:
      return (error as ErrorLike | null)?.message || 'Không đổi được nhóm.'
  }
}

export function isCountMismatch(error: unknown): boolean {
  return errorDetails(error).code === 'COUNT_MISMATCH'
}

/** Lỗi bộ lọc từ server (không có code, message tiếng Anh) — FE đã validate nên hiếm gặp. */
export function describeFilterError(error: unknown): string {
  const message = (error as ErrorLike | null)?.message
  return message ? `Bộ lọc không hợp lệ (${message}).` : 'Bộ lọc không hợp lệ.'
}
