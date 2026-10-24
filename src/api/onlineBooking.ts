import { apiGet, apiPost, apiPut, ApiError } from './client'
import { useAuthStore } from '../store/auth'
import {
  createMockAdminMachines,
  createMockBoardMachines,
  createMockBookings,
  createMockConfig,
  HOUR,
  isoOffset,
  MIN,
  MOCK_MEMBERS,
  MOCK_NOW,
} from './onlineBookingMock'

// ===== Hợp đồng API — PLAN/PLAN_ONLINE_BOOKING.md §3 =====

export type BookingStatus =
  | 'pending'
  | 'wait_approval'
  | 'confirmed'
  | 'in_use'
  | 'done'
  | 'no_show'
  | 'cancelled'
  | 'rejected'

export type FailCode =
  | 'DISABLED'
  | 'TOO_SOON'
  | 'TOO_FAR'
  | 'BAD_HOURS'
  | 'OUTSIDE_WINDOW'
  | 'NOT_BOOKABLE'
  | 'MACHINE_NOT_OFF'
  | 'MACHINE_BUSY'
  | 'BAD_MEMBER'
  | 'MEMBER_HAS_BOOKING'
  | 'MEMBER_MISMATCH'
  | 'MEMBER_NO_PHONE'
  | 'NO_BALANCE'
  | 'PRICE_CHANGED'
  | 'APPROVAL_TIMEOUT'
  | 'REJECTED_BY_STAFF'
  | 'ALREADY_USED'
  | 'BAD_STATUS'
  | 'BAD_REQUEST'
  | 'INTERNAL'
  | 'TID_USED'

/** OB-R2: cách trả tiền của đơn FZone (PLAN_ONLINE_BOOKING_QR.md). Đơn đặt hộ luôn 'wallet'. */
export type PayMethod = 'wallet' | 'qr'
/**
 * OB-R3: huỷ có cộng lại tài khoản chính — none | pending (đã huỷ, đang cộng) | credited |
 * failed (cộng lỗi: phiếu ghi một phần / mã phiếu bị chiếm — quản lý đối soát tay, hệ thống không tự thử lại).
 */
export type CancelCreditState = 'none' | 'pending' | 'credited' | 'failed'

export type PcState = 'off' | 'on_idle' | 'in_use' | 'unknown'
export type BookingChannel = 'fzone' | 'staff'
export type SlotSource = 'online' | 'counter' | 'legacy'
export type SlotState = 'pending' | 'wait_approval' | 'confirmed' | 'in_use'

export type BookedSlot = { from: string; to: string; source: SlotSource; state: SlotState }
export type MachinePrice = { userGroupId: number; userGroup: string; pricePerHour: number }
export type BookableNow = { earliestFrom: string; maxMinutes: number } | null

export type BoardMachine = {
  pc: string
  machineGroupId: number
  machineGroup: string
  pcState: PcState
  bookedSlots: BookedSlot[]
  bookableNow: BookableNow
  available: boolean
  prices: MachinePrice[]
}

export type BoardResponse = {
  serverTime: string
  enabled: boolean
  fee: number
  maxHours: number
  /** task OB-R8: số giờ tối thiểu mỗi đơn. */
  minHours: number
  minLeadMin: number
  maxAheadMin: number
  /** task OB-R8: đặt sát giờ hơn mức này (phút) thì chỉ chọn được máy đang tắt. 0 = không bao giờ bắt máy tắt. */
  requireOffWithinMin: number
  /** task OB-R8: giữ máy bao lâu sau giờ bắt đầu khi chủ đơn chưa vào. 0 = giữ tới hết khung. */
  lateHoldMin: number
  slotBufferMin: number
  horizon: { from: string; to: string }
  machines: BoardMachine[]
}

export type BookingPerson = { staffId: number; name: string } | null

export type Booking = {
  bookId: number
  bookCode: string
  zOid: string
  channel: BookingChannel
  member: { userId: number; username: string }
  pc: string
  machineGroup: string
  pcState: PcState
  from: string
  to: string
  minutes: number
  pricePerHour: number
  fee: number
  total: number
  status: BookingStatus
  failCode: FailCode | null
  createdAt: string
  approvalDeadline: string | null
  loginAt: string | null
  createdBy: BookingPerson
  approvedBy: BookingPerson
  cancelledBy: BookingPerson
  cancelReason: string | null
  // OB-R2/R3 — optional: server trước OB-R2 không trả các field này.
  payMethod?: PayMethod
  depositPaymentId?: number | null
  cancelCredit?: CancelCreditState
  cancelCreditAmount?: number | null
}

export type BookingListParams = {
  /** @deprecated dung fromDate/toDate (loc theo khoang ngay); date van duoc server chap nhan de tuong thich nguoc. */
  date?: string
  fromDate?: string
  toDate?: string
  status?: BookingStatus
  pc?: string
  channel?: BookingChannel
  q?: string
  limit?: number
  offset?: number
}

export type BookingListResponse = { total: number; items: Booking[] }

export type ConfigSetting = { v: number; enabled: 0 | 1; fee: number; approval_mode: 0 | 1 }
export type ConfigTime = {
  v: number
  max_ahead: number
  max_hours: number
  /** task OB-R8: số giờ tối thiểu mỗi đơn (1…23, phải nhỏ hơn max_hours). */
  min_hours: number
  min_lead: number
  buffer: number
  approval_timeout: number
  /** task OB-R8: ngưỡng "chỉ chọn máy đang tắt" (phút, 0…10080). */
  require_off_within: number
}
/** task OB-R8: `late_hold` = thời gian giữ máy khi khách đến trễ (phút; 0 = tắt, hoặc 15…30). */
export type ConfigStation = { v: number; lock_window: number; early_login: number; late_hold: number }
export type ConfigRow = 'setting' | 'time' | 'station'
export type ConfigResponse = {
  setting: ConfigSetting
  time: ConfigTime
  station: ConfigStation
  corrupt: ConfigRow[]
}
export type ConfigFieldError = { row: ConfigRow; key: string; message: string }
export type ConfigPutPayload = Partial<Pick<ConfigResponse, 'setting' | 'time' | 'station'>>

export type AdminMachine = {
  machineId: number
  pc: string
  machineGroupId: number
  machineGroup: string
  enabled: boolean
  prices: MachinePrice[]
}

/** OB-R7: thời lượng tính bằng `minutes`, bước 30 phút (30 ≤ minutes ≤ max_hours*60). */
export const BOOKING_STEP_MIN = 30

export type QuotePayload = { username: string; phone: string; pc: string; from: number; minutes: number }
export type QuoteResponse = { pricePerHour: number; fee: number; total: number; to: string; memberName: string }
export type CreatePayload = QuotePayload & { expectedTotal: number }

export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

// ===== Cờ mock — chỉ bật khi `npm run dev` VÀ có VITE_OB_MOCK=1 trong `.env.development.local` =====
// Bản build (PROD) luôn là false. Dữ liệu giả + hướng dẫn sửa: ./onlineBookingMock.ts.
// Mock không ghi gì xuống server; tải lại trang là dữ liệu về lại như file mock.
const USE_MOCK = import.meta.env.DEV && (import.meta.env.VITE_OB_MOCK as string | undefined) === '1'

function mockDelay<T>(value: T, ms = 250): Promise<T> {
  return new Promise((resolve) => window.setTimeout(() => resolve(value), ms))
}

function mockFail(failCode: FailCode, message: string): never {
  throw new ApiError(message, { httpStatus: 200, code: failCode, details: { failCode } })
}

function currentStaff(): { staffId: number; name: string } {
  const state = useAuthStore.getState()
  return { staffId: state.staffId ?? 0, name: state.staffName || 'Nhân viên' }
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('84') ? `0${digits.slice(2)}` : digits
}

// ----- Dữ liệu giả (nguồn ở ./onlineBookingMock.ts) -----

// Chỉ dựng khi USE_MOCK — bản build/chạy thật không tạo dữ liệu giả.
const mockBoardMachines = USE_MOCK ? createMockBoardMachines() : []
let mockConfig: ConfigResponse = createMockConfig()
let mockBookings: Booking[] = USE_MOCK ? createMockBookings(mockBoardMachines, mockConfig.setting.fee) : []
let mockNextBookId = mockBookings.length + 1
let mockMachines: AdminMachine[] = USE_MOCK ? createMockAdminMachines(mockBoardMachines) : []

function slotSourceOf(channel: BookingChannel): SlotSource {
  return channel === 'staff' ? 'counter' : 'online'
}

/**
 * task OB-R8: đơn có `from − now` nhỏ hơn `require_off_within` thì chỉ chọn được máy đang tắt.
 * So nghiêm ngặt `<` — giống `RequiresOff()` phía server.
 */
function mockRequiresOff(fromMs: number): boolean {
  return fromMs - Date.now() < mockConfig.time.require_off_within * MIN
}

function buildMockBoard(): BoardResponse {
  const live = mockBookings.filter((b) => b.status === 'wait_approval' || b.status === 'confirmed' || b.status === 'in_use')
  const machines: BoardMachine[] = mockBoardMachines.map((m) => {
    const bookedSlots: BookedSlot[] = live
      .filter((b) => b.pc === m.pc)
      .map((b) => ({ from: b.from, to: b.to, source: slotSourceOf(b.channel), state: b.status as SlotState }))
      .sort((a, b) => a.from.localeCompare(b.from))
    // task OB-R8: máy đang bật vẫn đặt được — nhưng sớm nhất là qua ngưỡng `require_off_within`.
    const leadMin =
      m.pcState === 'off'
        ? mockConfig.time.min_lead
        : Math.max(mockConfig.time.min_lead, mockConfig.time.require_off_within)
    const available = leadMin <= mockConfig.time.max_ahead
    const bookableNow: BookableNow = available
      ? { earliestFrom: isoOffset(MOCK_NOW + leadMin * MIN), maxMinutes: mockConfig.time.max_hours * 60 }
      : null
    return {
      pc: m.pc,
      machineGroupId: m.machineGroupId,
      machineGroup: m.machineGroup,
      pcState: m.pcState,
      bookedSlots,
      bookableNow,
      available,
      prices: m.prices,
    }
  })
  return {
    serverTime: isoOffset(Date.now()),
    enabled: mockConfig.setting.enabled === 1,
    fee: mockConfig.setting.fee,
    maxHours: mockConfig.time.max_hours,
    minHours: mockConfig.time.min_hours,
    minLeadMin: mockConfig.time.min_lead,
    maxAheadMin: mockConfig.time.max_ahead,
    requireOffWithinMin: mockConfig.time.require_off_within,
    lateHoldMin: mockConfig.station.late_hold,
    slotBufferMin: mockConfig.time.buffer,
    horizon: { from: isoOffset(Date.now()), to: isoOffset(Date.now() + 8 * HOUR) },
    machines: mockConfig.setting.enabled === 1 ? machines : [],
  }
}

function mockResolveQuote(payload: QuotePayload): QuoteResponse {
  if (mockConfig.setting.enabled !== 1) mockFail('DISABLED', 'Tính năng đặt máy online đang tắt')
  const machine = mockBoardMachines.find((m) => m.pc === payload.pc)
  if (!machine) mockFail('NOT_BOOKABLE', 'Máy không nằm trong danh sách cho đặt online')
  // task OB-R8: chỉ đơn đặt sát giờ mới bắt buộc máy đang tắt.
  if (mockRequiresOff(payload.from * 1000) && machine.pcState !== 'off') {
    mockFail('MACHINE_NOT_OFF', 'Máy đang bật — đặt sát giờ chỉ chọn được máy đang tắt')
  }
  // task OB-R8: sàn dưới = `min_hours` giờ (trước đây là hằng số 30 phút).
  if (
    !Number.isInteger(payload.minutes) ||
    payload.minutes < mockConfig.time.min_hours * 60 ||
    payload.minutes % BOOKING_STEP_MIN !== 0 ||
    payload.minutes > mockConfig.time.max_hours * 60
  ) {
    mockFail(
      'BAD_HOURS',
      `Thời lượng đặt từ ${mockConfig.time.min_hours} giờ đến ${mockConfig.time.max_hours} giờ, theo bước 30 phút.`,
    )
  }
  const username = payload.username.trim().toLowerCase()
  const mockMember = MOCK_MEMBERS.find(
    (m) => m.username === username && normalizePhone(m.phone) === normalizePhone(payload.phone),
  )
  if (!mockMember) {
    mockFail('MEMBER_MISMATCH', 'Tên đăng nhập và số điện thoại không khớp')
  }
  const pricePerHour = machine.prices[0]?.pricePerHour ?? 0
  const fee = mockConfig.setting.fee
  // Giống ComputeQuote phía server: giờ nguyên × giá/giờ; phần 30 phút lẻ = nửa giá, làm tròn lên bội 500đ.
  let base = pricePerHour * Math.floor(payload.minutes / 60)
  if (payload.minutes % 60 !== 0) base += Math.ceil(Math.floor((pricePerHour + 1) / 2) / 500) * 500
  const total = base + fee
  const to = isoOffset(payload.from * 1000 + payload.minutes * MIN)
  return { pricePerHour, fee, total, to, memberName: mockMember.name }
}

// ===== API thật =====

function buildQuery(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') search.set(key, String(value))
  })
  const query = search.toString()
  return query ? `?${query}` : ''
}

export function getBoard(params: { from?: number; horizonHours?: number } = {}): Promise<BoardResponse> {
  if (USE_MOCK) return mockDelay(buildMockBoard())
  return apiGet<BoardResponse>(`/onlinebook/board${buildQuery(params)}`)
}

export function getBookingList(params: BookingListParams = {}): Promise<BookingListResponse> {
  if (USE_MOCK) {
    let items = mockBookings.slice()
    if (params.date) items = items.filter((b) => b.from.slice(0, 10) === params.date)
    if (params.fromDate) items = items.filter((b) => b.from.slice(0, 10) >= params.fromDate!)
    if (params.toDate) items = items.filter((b) => b.from.slice(0, 10) <= params.toDate!)
    if (params.status) items = items.filter((b) => b.status === params.status)
    if (params.pc) items = items.filter((b) => b.pc === params.pc)
    if (params.channel) items = items.filter((b) => b.channel === params.channel)
    if (params.q) {
      const q = params.q.trim().toLowerCase()
      items = items.filter((b) => b.bookCode.toLowerCase().includes(q) || b.member.username.toLowerCase().includes(q))
    }
    items = items.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const total = items.length
    const offset = params.offset ?? 0
    const limit = params.limit ?? 20
    return mockDelay({ total, items: items.slice(offset, offset + limit) })
  }
  return apiGet<BookingListResponse>(`/onlinebook/list${buildQuery(params)}`)
}

export function quoteBooking(payload: QuotePayload): Promise<QuoteResponse> {
  if (USE_MOCK) return mockDelay(mockResolveQuote(payload))
  return apiPost<QuoteResponse, QuotePayload>('/onlinebook/quote', payload)
}

export function createBooking(payload: CreatePayload): Promise<Booking> {
  if (USE_MOCK) {
    const quote = mockResolveQuote(payload)
    if (Math.abs(quote.total - payload.expectedTotal) > 0) {
      mockFail('PRICE_CHANGED', 'Giá đã thay đổi so với lúc xem trước, vui lòng xem lại')
    }
    const staff = currentStaff()
    const booking: Booking = {
      bookId: mockNextBookId++,
      bookCode: `DM${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
      zOid: `STAFF-${staff.staffId}-${Math.random().toString(36).slice(2, 8)}`,
      channel: 'staff',
      member: {
        userId: MOCK_MEMBERS.find((m) => m.username === payload.username.trim().toLowerCase())?.userId ?? 0,
        username: payload.username.trim().toLowerCase(),
      },
      pc: payload.pc,
      machineGroup: mockBoardMachines.find((m) => m.pc === payload.pc)?.machineGroup ?? '',
      pcState: 'off',
      from: isoOffset(payload.from * 1000),
      to: quote.to,
      minutes: payload.minutes,
      pricePerHour: quote.pricePerHour,
      fee: quote.fee,
      total: quote.total,
      status: 'confirmed',
      failCode: null,
      createdAt: isoOffset(Date.now()),
      approvalDeadline: null,
      loginAt: null,
      createdBy: staff,
      approvedBy: staff,
      cancelledBy: null,
      cancelReason: null,
    }
    mockBookings = [booking, ...mockBookings]
    return mockDelay(booking)
  }
  return apiPost<Booking, CreatePayload>('/onlinebook/create', payload)
}

export function approveBooking(payload: { bookId: number }): Promise<Booking> {
  if (USE_MOCK) {
    const booking = mockBookings.find((b) => b.bookId === payload.bookId)
    if (!booking) mockFail('BAD_STATUS', 'Không tìm thấy đơn')
    if (booking.status !== 'wait_approval') mockFail('BAD_STATUS', 'Đơn không còn ở trạng thái chờ duyệt')
    const machine = mockBoardMachines.find((m) => m.pc === booking.pc)
    // task OB-R8: duyệt muộn có thể làm `from − now` tụt xuống dưới ngưỡng ⇒ lúc đó mới bắt máy tắt.
    if (machine && mockRequiresOff(Date.parse(booking.from)) && machine.pcState !== 'off') {
      mockFail('MACHINE_NOT_OFF', 'Máy đang bật — đặt sát giờ chỉ chọn được máy đang tắt')
    }
    const staff = currentStaff()
    booking.status = 'confirmed'
    booking.approvedBy = staff
    booking.approvalDeadline = null
    return mockDelay({ ...booking })
  }
  return apiPost<Booking, { bookId: number }>('/onlinebook/approve', payload)
}

export function rejectBooking(payload: { bookId: number; reason: string }): Promise<Booking> {
  if (USE_MOCK) {
    const booking = mockBookings.find((b) => b.bookId === payload.bookId)
    if (!booking) mockFail('BAD_STATUS', 'Không tìm thấy đơn')
    if (booking.status !== 'wait_approval') mockFail('BAD_STATUS', 'Đơn không còn ở trạng thái chờ duyệt')
    booking.status = 'rejected'
    booking.failCode = 'REJECTED_BY_STAFF'
    return mockDelay({ ...booking })
  }
  return apiPost<Booking, { bookId: number; reason: string }>('/onlinebook/reject', payload)
}

/** OB-R3: `credit: true` = "Huỷ + cộng lại tài khoản chính" (đúng `total`, chỉ ví chính). Thiếu = không hoàn. */
export type CancelPayload = { bookId: number; reason: string; credit?: boolean }

export function cancelBooking(payload: CancelPayload): Promise<Booking> {
  if (USE_MOCK) {
    const booking = mockBookings.find((b) => b.bookId === payload.bookId)
    if (!booking) mockFail('BAD_STATUS', 'Không tìm thấy đơn')
    if (booking.status !== 'confirmed') mockFail('BAD_STATUS', 'Chỉ huỷ được đơn đã xác nhận, chưa login')
    const staff = currentStaff()
    booking.status = 'cancelled'
    booking.cancelledBy = staff
    booking.cancelReason = payload.reason
    booking.cancelCredit = payload.credit ? 'credited' : 'none'
    booking.cancelCreditAmount = payload.credit ? booking.total : null
    return mockDelay({ ...booking })
  }
  return apiPost<Booking, CancelPayload>('/onlinebook/cancel', payload)
}

export function getOnlineBookConfig(): Promise<ConfigResponse> {
  if (USE_MOCK) return mockDelay(JSON.parse(JSON.stringify(mockConfig)) as ConfigResponse)
  return apiGet<ConfigResponse>('/onlinebook/config')
}

function mockValidateConfig(next: ConfigResponse): ConfigFieldError[] {
  const errors: ConfigFieldError[] = []
  if (next.time.min_lead >= next.time.max_ahead) {
    errors.push({ row: 'time', key: 'min_lead', message: 'Phải nhỏ hơn "Đặt trước tối đa"' })
  }
  // task OB-R8: ràng buộc `max_ahead ≤ lock_window` ĐÃ BỎ; thay bằng `min_hours < max_hours`.
  if (next.time.min_hours >= next.time.max_hours) {
    errors.push({ row: 'time', key: 'min_hours', message: 'Phải nhỏ hơn "Số giờ tối đa mỗi đơn"' })
  }
  if (next.setting.approval_mode === 1 && next.time.min_lead < next.time.approval_timeout) {
    errors.push({ row: 'time', key: 'min_lead', message: 'Duyệt thủ công: phải ≥ "Hết hạn chờ duyệt"' })
  }
  if (next.station.early_login > next.time.min_lead) {
    errors.push({ row: 'station', key: 'early_login', message: 'Không được lớn hơn "Không đặt sát giờ"' })
  }
  // task OB-R8: late_hold = 0 (tắt) hoặc 15…30 phút.
  if (next.station.late_hold !== 0 && (next.station.late_hold < 15 || next.station.late_hold > 30)) {
    errors.push({ row: 'station', key: 'late_hold', message: 'Phải là 0 (tắt) hoặc từ 15 đến 30 phút' })
  }
  return errors
}

export function putOnlineBookConfig(payload: ConfigPutPayload): Promise<ConfigResponse> {
  if (USE_MOCK) {
    const next: ConfigResponse = {
      setting: { ...mockConfig.setting, ...payload.setting },
      time: { ...mockConfig.time, ...payload.time },
      station: { ...mockConfig.station, ...payload.station },
      corrupt: mockConfig.corrupt,
    }
    const errors = mockValidateConfig(next)
    if (errors.length > 0) {
      throw new ApiError('Giá trị cấu hình không hợp lệ', {
        httpStatus: 200,
        code: 'BAD_REQUEST',
        details: { failCode: 'BAD_REQUEST', errors },
      })
    }
    mockConfig = next
    return mockDelay(JSON.parse(JSON.stringify(mockConfig)) as ConfigResponse)
  }
  return apiPut<ConfigResponse, ConfigPutPayload>('/onlinebook/config', payload)
}

export function getOnlineBookAdminMachines(): Promise<{ machines: AdminMachine[] }> {
  if (USE_MOCK) return mockDelay({ machines: JSON.parse(JSON.stringify(mockMachines)) as AdminMachine[] })
  return apiGet<{ machines: AdminMachine[] }>('/onlinebook/admin/machines')
}

export function saveOnlineBookMachines(payload: {
  machines: Array<{ machineId: number; enabled: boolean }>
}): Promise<void> {
  if (USE_MOCK) {
    const byId = new Map(payload.machines.map((m) => [m.machineId, m.enabled]))
    mockMachines = mockMachines.map((m) => (byId.has(m.machineId) ? { ...m, enabled: byId.get(m.machineId)! } : m))
    return mockDelay(undefined)
  }
  return apiPost<void, typeof payload>('/onlinebook/machines/save', payload)
}
