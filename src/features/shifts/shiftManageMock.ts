// Dữ liệu GIẢ cho trang quản lý "Ca làm việc" (/shifts) — chạy khi server CHƯA có route /shift/list|payments|stock|
// force-close|reconcile (B2 chưa xong). Dùng chung biến VITE_SHIFT_MOCK với mock thu ngân (xem đầu `shiftMock.ts`).
//
// Chế độ dành riêng cho trang /shifts (ngoài off / none / open / pending / warn / error đã có):
//   open     (mặc định cho trang này) hôm nay có 5 ca: đang mở, đã chốt (thiếu tiền), đã chốt (khớp), đóng cưỡng bức, treo
//            (+ 1 ca đã chốt chưa đếm tiền); ngày quá khứ chỉ có ca đã đóng. Đối soát KHỚP. Có kho.
//   diff     như open nhưng đối soát LỆCH 200.000 đ (2 phiếu chưa thuộc ô nào + 1 phiếu thuộc hơn một ô)
//   nostock  như open nhưng /shift/stock trả available:false ⇒ tab Kho ẩn
//   denied   mọi route quản lý trả 403 RBAC_DENIED ⇒ "Bạn không có quyền xem danh sách ca"
//   off      /shift/list trả SHIFT_DISABLED ⇒ "Chưa bật chế độ ca"
//   error    /shift/list trả lỗi máy chủ ⇒ "Không tải được danh sách ca" + Thử lại
//
// Đóng cưỡng bức trong mock: ca đang mở (201, 205) chuyển sang trạng thái 3 trong bộ nhớ trang (F5 là về như ban đầu).
// Hình dạng dữ liệu = hợp đồng handoff/HANDOFF_work-shift-S3be.md mục 3; chỗ hợp đồng mơ hồ là GIẢ ĐỊNH (ghi ở handoff F2).
import { ApiError, RbacDeniedError } from '../../api/client'

type Json = Record<string, unknown>

const MANAGE_PATHS = new Set(['/shift/list', '/shift/payments', '/shift/stock', '/shift/force-close', '/shift/reconcile'])
export const isManagePath = (path: string) => MANAGE_PATHS.has(path)

const MANAGED_ID_FROM = 201
/** Ca do trang quản lý dựng (mã ≥ 201) khác với ca của thu ngân mock (128/129). */
export const isManagedShiftId = (id: unknown): id is number => typeof id === 'number' && id >= MANAGED_ID_FROM && id < 300

const pad = (n: number) => String(n).padStart(2, '0')
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const stamp = (d: Date) => `${ymd(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const addDays = (date: string, days: number) => {
  const [y, m, d] = date.split('-').map(Number)
  return ymd(new Date(y, m - 1, d + days))
}

const METHOD_LABEL: Record<string, string> = { cash: 'Tiền mặt', online: 'Chuyển khoản', qr: 'QR', deduct: 'Cấn trừ' }

const SOURCES = [
  { key: 'member', name: 'Nạp hội viên', type: 1, count: 24, cash: 1_850_000, online: 400_000, qr: 1_200_000, deduct: 0 },
  { key: 'guest', name: 'Khách vãng lai', type: 2, count: 9, cash: 380_000, online: 0, qr: 120_000, deduct: 0 },
  { key: 'combo', name: 'Combo', type: 3, count: 7, cash: 210_000, online: 150_000, qr: 300_000, deduct: 90_000 },
  { key: 'card', name: 'Thẻ nạp tiền', type: 4, count: 3, cash: 150_000, online: 0, qr: 50_000, deduct: 0 },
  // 140 lượt để danh sách giao dịch (ô Dịch vụ × Tiền mặt) vượt 50 dòng và thấy phân trang.
  { key: 'service', name: 'Dịch vụ', type: 5, count: 140, cash: 520_000, online: 60_000, qr: 340_000, deduct: 180_000 },
  { key: 'debt', name: 'Công nợ (trả nợ)', type: 7, count: 1, cash: 100_000, online: 0, qr: 0, deduct: 0 },
]

type ManagedShift = {
  shiftId: number
  staffId: number
  staffName: string
  /** Trạng thái gốc; đóng cưỡng bức trong mock đổi sang 3 qua `forced`. */
  status: number
  /** 'D' = ngày đang xem, 'D-1' = hôm trước. */
  openDay: 'D' | 'D-1'
  openAt: string
  closeAt: string | null
  openingCash: number
  scale: number
  /** Tiền thực đếm − dự kiến; null = không đếm. */
  countDelta: number | null
  hung?: boolean
  refundsQr: { count: number; total: number } | null
  onlineBook: { count: number; walletTotal: number } | null
  /** Có trong danh sách ngày quá khứ không (ca mở / treo chỉ có ở "hôm nay"). */
  pastToo: boolean
}

const SHIFTS: ManagedShift[] = [
  { shiftId: 201, staffId: 7, staffName: 'Nguyễn Thu Ngân', status: 1, openDay: 'D', openAt: '__NOW-3.5h', closeAt: null, openingCash: 500_000, scale: 1, countDelta: null, refundsQr: { count: 0, total: 0 }, onlineBook: { count: 0, walletTotal: 0 }, pastToo: false },
  { shiftId: 202, staffId: 8, staffName: 'Phạm Minh Tuấn', status: 2, openDay: 'D', openAt: '06:00', closeAt: '14:00', openingCash: 1_200_000, scale: 1.2, countDelta: -10_000, refundsQr: { count: 2, total: 180_000 }, onlineBook: { count: 3, walletTotal: 240_000 }, pastToo: true },
  { shiftId: 203, staffId: 9, staffName: 'Lê Hoài An', status: 2, openDay: 'D', openAt: '14:00', closeAt: '22:00', openingCash: 800_000, scale: 0.8, countDelta: 0, refundsQr: { count: 0, total: 0 }, onlineBook: { count: 1, walletTotal: 60_000 }, pastToo: true },
  { shiftId: 204, staffId: 10, staffName: 'Võ Quốc Bảo', status: 3, openDay: 'D', openAt: '07:00', closeAt: '09:00', openingCash: 300_000, scale: 0.3, countDelta: null, refundsQr: null, onlineBook: { count: 0, walletTotal: 0 }, pastToo: true },
  { shiftId: 205, staffId: 11, staffName: 'Đặng Thị Hạnh', status: 1, openDay: 'D-1', openAt: '20:00', closeAt: null, openingCash: 400_000, scale: 0.5, countDelta: null, hung: true, refundsQr: { count: 0, total: 0 }, onlineBook: { count: 0, walletTotal: 0 }, pastToo: false },
  { shiftId: 206, staffId: 12, staffName: 'Trần Đức Long', status: 2, openDay: 'D', openAt: '12:00', closeAt: '18:00', openingCash: 600_000, scale: 0.6, countDelta: 5_000, refundsQr: { count: 0, total: 0 }, onlineBook: null, pastToo: true },
]

/** Ca đã đóng cưỡng bức trong phiên mock (mã ca → giờ đóng). */
const forced = new Map<number, string>()

const round1000 = (v: number) => Math.round(v / 1000) * 1000

function scaledSources(scale: number) {
  return SOURCES.map((s) => {
    const cash = round1000(s.cash * scale)
    const online = round1000(s.online * scale)
    const qr = round1000(s.qr * scale)
    const deduct = round1000(s.deduct * scale)
    return { ...s, count: Math.max(1, Math.round(s.count * scale)), cash, online, qr, deduct, total: cash + online + qr }
  })
}

function effectiveStatus(shift: ManagedShift) {
  return forced.has(shift.shiftId) ? 3 : shift.status
}

function timesFor(shift: ManagedShift, date: string, now: Date) {
  const openDate = shift.openDay === 'D' ? date : addDays(date, -1)
  const openTime = shift.openAt === '__NOW-3.5h' ? stamp(new Date(now.getTime() - 3.5 * 3600_000)) : `${openDate} ${shift.openAt}:00`
  const closeTime = forced.get(shift.shiftId) ?? (shift.closeAt ? `${date} ${shift.closeAt}:00` : null)
  return { openTime, closeTime }
}

function summaryParts(shift: ManagedShift) {
  const sources = scaledSources(shift.scale)
  const sum = (key: 'count' | 'cash' | 'online' | 'qr' | 'deduct') => sources.reduce((acc, s) => acc + s[key], 0)
  const cash = sum('cash')
  const online = sum('online')
  const qr = sum('qr')
  return {
    sources,
    totals: { count: sum('count'), cash, online, qr, deduct: sum('deduct'), total: cash + online + qr },
    expectedCash: shift.openingCash + cash,
  }
}

function listItem(shift: ManagedShift, date: string, now: Date) {
  const parts = summaryParts(shift)
  const status = effectiveStatus(shift)
  const { openTime, closeTime } = timesFor(shift, date, now)
  const counted = status === 2 && shift.countDelta !== null ? parts.expectedCash + shift.countDelta : null
  return {
    shiftId: shift.shiftId,
    staffId: shift.staffId,
    staffName: shift.staffName,
    status,
    openTime,
    closeTime,
    openingCash: shift.openingCash,
    revenue: parts.totals.total,
    expectedCash: parts.expectedCash,
    countedCash: counted,
    cashDiff: counted === null ? null : counted - parts.expectedCash,
    hung: status === 1 && Boolean(shift.hung),
  }
}

function shiftsFor(date: string, now: Date) {
  const isToday = date === ymd(now)
  return SHIFTS.filter((s) => isToday || s.pastToo).map((s) => listItem(s, date, now))
}

function reconcileFor(mode: string, date: string, now: Date) {
  const shifts = shiftsFor(date, now)
  const shiftsTotal = shifts.reduce((acc, s) => acc + s.revenue, 0)
  const systemTotal = 1_850_000
  const otherTotal = 130_000
  const bucketTotal = shiftsTotal + systemTotal + otherTotal
  const bad = mode === 'diff'
  const reportTotal = bucketTotal + (bad ? 200_000 : 0)
  return {
    shifts,
    outside: { system: { count: 12, total: systemTotal }, other: { count: 2, total: otherTotal } },
    reportTotal,
    bucketTotal,
    diff: reportTotal - bucketTotal,
    shiftsTotal,
    systemTotal,
    otherTotal,
    orphans: bad ? ['10234', '10241'] : [],
    duplicates: bad ? ['10188'] : [],
  }
}

function buildPayments(shift: ManagedShift, date: string) {
  const items: Json[] = []
  const members = ['hv_minh', 'hv_lan', 'hv_nam', 'Khách vãng lai', 'hv_tuan', 'hv_hoa']
  let seq = 1
  for (const s of scaledSources(shift.scale)) {
    const all = s.cash + s.online + s.qr + s.deduct
    for (const method of ['cash', 'online', 'qr', 'deduct'] as const) {
      const value = s[method]
      if (value === 0 || all === 0) continue
      const n = Math.max(1, Math.round((s.count * value) / all))
      const each = Math.floor(value / n)
      for (let i = 0; i < n; i++) {
        const amount = i === n - 1 ? value - each * (n - 1) : each
        items.push({
          voucherId: `${shift.shiftId}${String(seq).padStart(4, '0')}`,
          date: shift.openDay === 'D' ? date : addDays(date, -1),
          time: `${pad(6 + Math.floor(seq / 40))}:${pad(seq % 60)}:00`,
          paymentType: s.type,
          typeName: `${s.name} — ${METHOD_LABEL[method]}`,
          source: s.key,
          method,
          amount,
          member: members[seq % members.length],
          staff: shift.staffName,
        })
        seq += 1
      }
    }
  }
  return items
}

const MATERIALS = [
  { materialId: 1, name: 'Cà phê hạt', unit: 'kg', open: 12.5, imported: 0, exported: 3.2, adjusted: 0 },
  { materialId: 2, name: 'Sữa đặc', unit: 'lon', open: 48, imported: 24, exported: 30, adjusted: -1 },
  { materialId: 3, name: 'Mì gói', unit: 'gói', open: 160, imported: 0, exported: 74, adjusted: 0 },
  { materialId: 4, name: 'Trứng gà', unit: 'quả', open: 90, imported: 60, exported: 82, adjusted: -2 },
  { materialId: 5, name: 'Đường cát', unit: 'kg', open: 8, imported: 0, exported: 1.75, adjusted: 0 },
  { materialId: 6, name: 'Trà đào (siro)', unit: 'chai', open: 14, imported: 6, exported: 9, adjusted: 0 },
]

function buildStock(shift: ManagedShift, open: boolean) {
  return MATERIALS.map((m) => {
    const exported = Math.round(m.exported * shift.scale * 100) / 100
    const closeValue = Math.round((m.open + m.imported - exported + m.adjusted) * 100) / 100
    return {
      materialId: m.materialId,
      name: m.name,
      unit: m.unit,
      open: m.open,
      // Hợp đồng: ca đã đóng ⇒ `close`; ca còn mở ⇒ `current`.
      ...(open ? { current: closeValue } : { close: closeValue }),
      delta: Math.round((closeValue - m.open) * 100) / 100,
      imported: m.imported,
      exported,
      adjusted: m.adjusted,
    }
  })
}

function managedSummary(shift: ManagedShift) {
  const parts = summaryParts(shift)
  return {
    sources: parts.sources,
    refund: { count: shift.refundsQr ? 1 : 0, cash: shift.refundsQr ? -50_000 : 0, online: 0 },
    totals: parts.totals,
    expectedCash: parts.expectedCash,
    refundsQrCanceled: shift.refundsQr,
    onlineBook: shift.onlineBook,
  }
}

const denied = () => new RbacDeniedError('Bạn không có quyền xem tất cả ca (Mock: Xem mọi ca).', undefined, 'Xem mọi ca')
const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

function managed(id: unknown): ManagedShift {
  const shift = SHIFTS.find((s) => s.shiftId === id)
  if (!shift) throw new ApiError('Không tìm thấy ca', { code: 'SHIFT_NOT_FOUND' })
  return shift
}

/** `/shift/summary` của một ca do trang quản lý dựng (mã ≥ 201). */
export function mockManagedSummary(mode: string, shiftId: number): Json {
  if (mode === 'denied') throw denied()
  return managedSummary(managed(shiftId)) as unknown as Json
}

export async function mockManageRequest(mode: string, path: string, body?: unknown): Promise<unknown> {
  const req = (body ?? {}) as Json
  const now = new Date()
  if (mode === 'denied') throw denied()
  if (mode === 'error' && path === '/shift/list') throw new ApiError('Mock: máy chủ lỗi khi tải danh sách ca')

  if (path === '/shift/list') {
    const date = typeof req.date === 'string' ? req.date : ymd(now)
    const r = reconcileFor(mode, date, now)
    return { shifts: r.shifts, outside: r.outside, reconcile: { reportTotal: r.reportTotal, bucketTotal: r.bucketTotal, diff: r.diff } }
  }

  if (path === '/shift/reconcile') {
    if (mode === 'error') throw new ApiError('Mock: máy chủ lỗi khi đối soát')
    const date = typeof req.date === 'string' ? req.date : ymd(now)
    const r = reconcileFor(mode, date, now)
    return {
      reportTotal: r.reportTotal,
      shiftsTotal: r.shiftsTotal,
      systemTotal: r.systemTotal,
      otherTotal: r.otherTotal,
      diff: r.diff,
      orphans: r.orphans,
      duplicates: r.duplicates,
    }
  }

  if (path === '/shift/payments') {
    const shift = managed(req.shiftId)
    const date = ymd(now)
    const source = typeof req.source === 'string' && req.source ? req.source : null
    const method = typeof req.method === 'string' && req.method ? req.method : null
    const limit = Math.min(200, typeof req.limit === 'number' ? req.limit : 50)
    const offset = typeof req.offset === 'number' ? req.offset : 0
    const all = buildPayments(shift, date).filter((i) => (!source || i.source === source) && (!method || i.method === method))
    await delay(150)
    return { total: all.length, items: all.slice(offset, offset + limit) }
  }

  if (path === '/shift/stock') {
    const shift = managed(req.shiftId)
    if (mode === 'nostock') return { available: false, rows: [] }
    return { available: true, rows: buildStock(shift, effectiveStatus(shift) === 1) }
  }

  // /shift/force-close
  const shift = managed(req.shiftId)
  const note = typeof req.note === 'string' ? req.note.trim() : ''
  if (note === '' || note.length > 500 || /['\\]/.test(note)) {
    throw new ApiError('Ghi chú đóng cưỡng bức phải từ 1 đến 500 ký tự', { code: 'INVALID_INPUT' })
  }
  const already = effectiveStatus(shift) !== 1
  if (!already) forced.set(shift.shiftId, stamp(now))
  const item = listItem(shift, ymd(now), now)
  return { alreadyClosed: already, shift: { ...item, note }, summary: managedSummary(shift) }
}
