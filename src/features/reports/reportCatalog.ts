// Danh mục trang báo cáo Web UI (task web-report-params, handoff mục 4.1 / 4.3 / 4.6 / 4.7).
// Mỗi trang GỘP nhiều `type` của /rptv2; `resolve` chọn type + staffid + tham số phụ từ control.
// Mã quyền là số `functiontb` — KHỚP bảng ở server (ServerSide_ai/FNetHttp/ReportRightPolicy.h);
// đổi một bên phải đổi bên kia. Khoá ở FE là UX + lớp chặn thực tế khi server còn shadow mode
// (INT_RBAC_ENFORCE=0); server enforce là lớp dự phòng.

import type { DynamicReportExtra } from '../../api/dynamic-reports'

export type ControlKind =
  | 'staff'
  | 'display'
  | 'paymentType'
  | 'revenueSource'
  | 'paymentMethod'
  | 'timeUsed'
  | 'moneyUsed'

export type DisplayOption = {
  value: string
  label: string
  /** Chỉ hiện cho người có quyền "xem tất cả" (server bỏ qua staffid ở chế độ này). */
  needsAll?: boolean
}

/** Giá trị control đã chuẩn hoá theo quyền — đầu vào của `resolve`. */
export type ReportInput = {
  display: string
  /** 0 = tất cả. Người thiếu quyền "tất cả" LUÔN nhận staffId của chính mình. */
  staffId: number
  canAll: boolean
  selfId: number
  paymentType: number
  revenueSource: number
  paymentMethod: number
  timeUsed: number
  moneyUsed: number
}

export type ReportRequestSpec = {
  type: number
  staffid: number
  extra: DynamicReportExtra
}

export type ReportPageDef = {
  id: string
  slug: string
  title: string
  shortLabel: string
  description: string
  /** Dashboard 34-40: chỉ ADMIN ở FE (server giữ gate cũ 931/9311 vì bên thứ 3 đang gọi). */
  dashboard?: boolean
  viewRight?: number
  /** Có mã này = được chọn nhân viên khác / tất cả. Không có = trang không có phạm vi nhân viên. */
  allRight?: number
  controls: ControlKind[]
  /** Trang 43: server `staffid=0` trả toàn số 0 nên KHÔNG có mục "Tất cả". */
  noAllStaff?: boolean
  displays?: DisplayOption[]
  defaultDisplay?: string
  /** Giới hạn khoảng ngày (số ngày, tính cả 2 đầu) khi `display` khớp — bảo vệ kết nối DB dùng chung. */
  dateLimit?: { display: string; days: number; message: string }
  resolve: (input: ReportInput) => ReportRequestSpec
}

export const REVENUE_SOURCE_OPTIONS = [
  { value: '0', label: 'Tất cả' },
  { value: '1', label: 'Tiền nạp hội viên' },
  { value: '2', label: 'Tiền giờ khách vãng lai' },
  { value: '3', label: 'Combo' },
  { value: '4', label: 'Thẻ nạp tiền' },
  { value: '5', label: 'Dịch vụ [FNet]' },
  { value: '7', label: 'Công nợ (trả nợ)' },
] as const

export const PAYMENT_METHOD_OPTIONS = [
  { value: '0', label: 'Tất cả' },
  { value: '1', label: 'Tiền mặt' },
  { value: '2', label: 'Chuyển khoản' },
  { value: '3', label: 'Thanh toán QR' },
] as const

export const MEMBER_PAYMENT_TYPE_OPTIONS = [
  { value: '0', label: 'Tất cả' },
  { value: '1', label: 'Tiền mặt' },
  { value: '2', label: 'Thẻ' },
  { value: '3', label: 'Online' },
  { value: '4', label: 'QR' },
] as const

// types = [loại theo 1 nhân viên, loại "ALL"]. `<all>` (staffId 0) chọn loại ALL vì loại đó bỏ qua staffid.
function pairByStaff(types: readonly [number, number], staffId: number): ReportRequestSpec {
  return staffId === 0
    ? { type: types[1], staffid: 0, extra: {} }
    : { type: types[0], staffid: staffId, extra: {} }
}

const simple = (type: number): ReportPageDef['resolve'] => () => ({ type, staffid: 0, extra: {} })

const CASH_PAIRS: Record<string, readonly [number, number]> = {
  daily: [1, 2],
  weekly: [3, 4],
  monthly: [5, 6],
}
const SERVICE_PAIRS: Record<string, readonly [number, number]> = {
  shift: [7, 8],
  daily: [9, 10],
}
const CARD_PAIRS: Record<string, readonly [number, number]> = {
  shift: [25, 26],
  daily: [27, 28],
}

const SHIFT_DAILY_DISPLAYS: DisplayOption[] = [
  { value: 'shift', label: 'Theo ca' },
  { value: 'daily', label: 'Hằng ngày' },
]

export const REPORT_PAGES: readonly ReportPageDef[] = [
  {
    id: 'revenue-stats',
    slug: 'revenue-stats',
    title: 'Thống kê doanh thu',
    shortLabel: 'DT',
    description: 'Doanh thu theo nhân viên quản lý, hiển thị hằng ngày, hằng tuần hoặc hằng tháng.',
    viewRight: 931,
    allRight: 9311,
    controls: ['staff', 'display'],
    displays: [
      { value: 'daily', label: 'Hằng ngày' },
      { value: 'weekly', label: 'Hằng tuần' },
      { value: 'monthly', label: 'Hằng tháng' },
    ],
    defaultDisplay: 'daily',
    resolve: (i) => pairByStaff(CASH_PAIRS[i.display] ?? CASH_PAIRS.daily, i.staffId),
  },
  {
    id: 'service-revenue',
    slug: 'service-revenue',
    title: 'Doanh thu dịch vụ',
    shortLabel: 'DV',
    description: 'Doanh thu dịch vụ theo nhân viên quản lý, hiển thị theo ca hoặc hằng ngày.',
    viewRight: 934,
    allRight: 9341,
    controls: ['staff', 'display'],
    displays: SHIFT_DAILY_DISPLAYS,
    defaultDisplay: 'shift',
    resolve: (i) => pairByStaff(SERVICE_PAIRS[i.display] ?? SERVICE_PAIRS.shift, i.staffId),
  },
  {
    id: 'card-revenue',
    slug: 'card-revenue',
    title: 'Doanh thu thẻ nạp tiền',
    shortLabel: 'Thẻ',
    description: 'Doanh thu thẻ nạp tiền theo nhân viên quản lý, hiển thị theo ca hoặc hằng ngày.',
    viewRight: 938,
    allRight: 9381,
    controls: ['staff', 'display'],
    displays: SHIFT_DAILY_DISPLAYS,
    defaultDisplay: 'shift',
    resolve: (i) => pairByStaff(CARD_PAIRS[i.display] ?? CARD_PAIRS.shift, i.staffId),
  },
  {
    id: 'member-recharge',
    slug: 'member-recharge',
    title: 'Doanh thu nạp tiền hội viên',
    shortLabel: 'Nạp',
    description: 'Doanh thu nạp tiền hội viên theo nhân viên quản lý và hình thức nạp.',
    viewRight: 93222,
    allRight: 93221,
    controls: ['staff', 'display', 'paymentType'],
    displays: SHIFT_DAILY_DISPLAYS,
    defaultDisplay: 'shift',
    // Nhân viên là tham số staffid (0 = tất cả) — KHÔNG đổi type như các trang ghép cặp ALL.
    resolve: (i) => ({
      type: i.display === 'daily' ? 33 : 32,
      staffid: i.staffId,
      extra: { payment_type: i.paymentType },
    }),
  },
  {
    id: 'machine-revenue',
    slug: 'machine-revenue',
    title: 'Doanh thu theo máy',
    shortLabel: 'Máy',
    description: 'Doanh thu theo từng máy trạm.',
    viewRight: 935,
    controls: [],
    resolve: simple(11),
  },
  {
    id: 'free-time',
    slug: 'free-time',
    title: 'Thời gian miễn phí',
    shortLabel: 'TGMP',
    description: 'Thời gian miễn phí đã tặng cho hội viên.',
    viewRight: 936,
    controls: [],
    resolve: simple(12),
  },
  {
    id: 'free-money',
    slug: 'free-money',
    title: 'Số tiền miễn phí',
    shortLabel: 'Tiền MP',
    description: 'Số tiền miễn phí đã tặng cho hội viên.',
    viewRight: 937,
    controls: [],
    resolve: simple(13),
  },
  {
    id: 'member-debt',
    slug: 'member-debt',
    title: 'Công nợ hội viên',
    shortLabel: 'Nợ',
    description: 'Công nợ và nợ dịch vụ của hội viên.',
    viewRight: 933,
    controls: [],
    resolve: simple(15),
  },
  {
    id: 'member-usage',
    slug: 'member-usage',
    title: 'Giờ và tiền sử dụng của hội viên',
    shortLabel: 'Giờ',
    description: 'Hội viên có giờ và tiền sử dụng từ mức tối thiểu trở lên.',
    viewRight: 9321,
    controls: ['timeUsed', 'moneyUsed'],
    resolve: (i) => ({
      type: 31,
      staffid: 0,
      extra: { time_used: i.timeUsed, money_used: i.moneyUsed },
    }),
  },
  {
    id: 'income-summary',
    slug: 'income-summary',
    title: 'Doanh thu tổng hợp',
    shortLabel: 'TH',
    description: 'Doanh thu V2 theo nguồn thu và phương thức thanh toán.',
    viewRight: 931041,
    allRight: 9310411,
    controls: ['staff', 'display', 'revenueSource', 'paymentMethod'],
    displays: [
      { value: '0', label: 'Hằng ngày' },
      // Ver20_IncomeWeekly/Monthly KHÔNG lọc nhân viên/nguồn thu/phương thức (đọc code 2026-09-30)
      // => luôn là số liệu toàn bộ, nên chỉ người có quyền xem tất cả mới được chọn.
      { value: '1', label: 'Hằng tuần', needsAll: true },
      { value: '2', label: 'Hằng tháng', needsAll: true },
    ],
    defaultDisplay: '0',
    dateLimit: {
      display: '0',
      days: 31,
      message: 'Hiển thị hằng ngày chỉ xem tối đa 31 ngày mỗi lần. Hãy thu hẹp khoảng ngày.',
    },
    resolve: (i) => {
      // Thiếu quyền xem tất cả thì KHÔNG BAO GIỜ gửi tuần/tháng (phòng state lạc): rơi về hằng ngày của chính mình.
      const td = i.canAll ? Number(i.display) || 0 : 0
      // Tuần/tháng: server bỏ qua staffid/nguồn thu/phương thức — gửi "tất cả" cho rõ nghĩa.
      const all = td !== 0
      return {
        type: 41,
        staffid: all ? 0 : i.staffId,
        extra: {
          time_display: td,
          revenue_source: all ? 0 : i.revenueSource,
          payment_method: all ? 0 : i.paymentMethod,
        },
      }
    },
  },
  {
    id: 'income-by-staff',
    slug: 'income-by-staff',
    title: 'Doanh thu theo nhân viên',
    shortLabel: 'NV',
    description: 'Doanh thu V2 tổng hợp theo từng nhân viên.',
    viewRight: 931042,
    allRight: 9310421,
    controls: ['staff'],
    // staffId đã chuẩn hoá bởi effectiveStaff: 0 = tất cả (canAll), selfId nếu thiếu quyền.
    resolve: (i) => ({ type: 42, staffid: i.staffId, extra: {} }),
  },
  {
    id: 'shift-report',
    slug: 'shift-report',
    title: 'Báo cáo ca',
    shortLabel: 'Ca',
    description: 'Báo cáo giao ca V2 theo nhân viên quản lý. Phải chọn một nhân viên.',
    viewRight: 931043,
    allRight: 9310431,
    controls: ['staff'],
    noAllStaff: true,
    resolve: (i) => ({ type: 43, staffid: i.staffId, extra: {} }),
  },
  // --- Dashboard 34-40: chỉ ADMIN (FE). Server giữ gate 931/9311. ---
  ...(
    [
      [34, 'income', 'DASHBOARD Doanh thu', 'DT'],
      [35, 'income-mobile', 'DASHBOARD Doanh thu (mobile)', 'DTm'],
      [36, 'customers', 'DASHBOARD Khách hàng', 'KH'],
      [37, 'customers-detail', 'DASHBOARD Khách hàng chi tiết', 'KHct'],
      [38, 'machine-usage', 'DASHBOARD Sử dụng máy', 'SDM'],
      [39, 'machine-usage-detail', 'DASHBOARD Sử dụng máy chi tiết', 'SDMct'],
      [40, 'account-stats', 'DASHBOARD Thống kê Tài khoản', 'TK'],
    ] as const
  ).map(
    ([type, slug, title, shortLabel]): ReportPageDef => ({
      id: `dashboard-${slug}`,
      slug,
      title,
      shortLabel,
      description: 'Số liệu tổng quan dành cho quản trị viên.',
      dashboard: true,
      controls: [],
      resolve: simple(type),
    }),
  ),
]

export function reportPath(def: ReportPageDef) {
  return def.dashboard ? `/analysis/dashboard/${def.slug}` : `/analysis/${def.slug}`
}

export function findReportPage(slug: string | undefined, dashboard: boolean) {
  return REPORT_PAGES.find((page) => page.slug === slug && Boolean(page.dashboard) === dashboard)
}

/** Mã quyền cho phép VÀO trang (xem hoặc xem-tất-cả — parity menu MFC). Dashboard: rỗng (chỉ admin). */
export function reportViewCodes(def: ReportPageDef): number[] {
  return [def.viewRight, def.allRight].filter((code): code is number => code !== undefined)
}
