import { apiGet, apiPost, apiPut, ApiError } from './client'
import { useAuthStore } from '../store/auth'

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
  minLeadMin: number
  maxAheadMin: number
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
}

export type BookingListParams = {
  date?: string
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
  min_lead: number
  buffer: number
  approval_timeout: number
}
export type ConfigStation = { v: number; lock_window: number; early_login: number }
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

export type QuotePayload = { username: string; phone: string; pc: string; from: number; hours: number }
export type QuoteResponse = { pricePerHour: number; fee: number; total: number; to: string; memberName: string }
export type CreatePayload = QuotePayload & { expectedTotal: number }

export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000)
}

// ===== Cờ mock — TẮT MẶC ĐỊNH (bắt buộc trước khi hỏi merge, xem DoD HANDOFF_OB-5) =====
// Bật tạm để dựng UI khi OB-2/OB-4 chưa merge vào master; dữ liệu giả không ghi gì xuống server.
const USE_MOCK = false

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

function isoOffset(ms: number): string {
  // Mock chạy trên máy dev bất kỳ múi giờ nào -- quy ước hiển thị theo giờ máy chủ (+07:00) như contract.
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}+07:00`
  )
}

function normalizePhone(phone: string): string {
  const digits = phone.replace(/\D/g, '')
  return digits.startsWith('84') ? `0${digits.slice(2)}` : digits
}

// ----- Dữ liệu giả -----

const MOCK_MEMBER = { userId: 501, username: 'hoivien01', phone: '0901234567', name: 'Nguyễn Văn A' }

type MockBoardMachine = {
  pc: string
  machineGroupId: number
  machineGroup: string
  pcState: PcState
  prices: MachinePrice[]
}

const mockBoardMachines: MockBoardMachine[] = [
  {
    pc: 'PC-01',
    machineGroupId: 1,
    machineGroup: 'VIP',
    pcState: 'off',
    prices: [
      { userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 10000 },
      { userGroupId: 4, userGroup: 'Hội viên VIP', pricePerHour: 8000 },
    ],
  },
  {
    pc: 'PC-02',
    machineGroupId: 1,
    machineGroup: 'VIP',
    pcState: 'on_idle',
    prices: [
      { userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 10000 },
      { userGroupId: 4, userGroup: 'Hội viên VIP', pricePerHour: 8000 },
    ],
  },
  {
    pc: 'PC-03',
    machineGroupId: 2,
    machineGroup: 'Thường',
    pcState: 'in_use',
    prices: [{ userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 7000 }],
  },
  {
    pc: 'PC-04',
    machineGroupId: 2,
    machineGroup: 'Thường',
    pcState: 'off',
    prices: [{ userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 7000 }],
  },
  {
    pc: 'PC-05',
    machineGroupId: 2,
    machineGroup: 'Thường',
    pcState: 'unknown',
    prices: [{ userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 7000 }],
  },
]

const MOCK_NOW = Date.now()
const HOUR = 3_600_000
const MIN = 60_000

let mockNextBookId = 7
let mockBookings: Booking[] = [
  {
    bookId: 1,
    bookCode: 'DM7K3QX',
    zOid: 'FZ-20261019-0001',
    channel: 'fzone',
    member: { userId: 501, username: 'hoivien01' },
    pc: 'PC-01',
    machineGroup: 'VIP',
    pcState: 'off',
    from: isoOffset(MOCK_NOW + 45 * MIN),
    to: isoOffset(MOCK_NOW + 45 * MIN + 2 * HOUR),
    minutes: 120,
    pricePerHour: 10000,
    fee: 0,
    total: 20000,
    status: 'wait_approval',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - 3 * MIN),
    approvalDeadline: isoOffset(MOCK_NOW + 12 * MIN),
    loginAt: null,
    createdBy: null,
    approvedBy: null,
    cancelledBy: null,
    cancelReason: null,
  },
  {
    bookId: 2,
    bookCode: 'DM9B2LK',
    zOid: 'FZ-20261019-0002',
    channel: 'fzone',
    member: { userId: 502, username: 'hoivien02' },
    pc: 'PC-04',
    machineGroup: 'Thường',
    pcState: 'off',
    from: isoOffset(MOCK_NOW + 5 * MIN),
    to: isoOffset(MOCK_NOW + 5 * MIN + HOUR),
    minutes: 60,
    pricePerHour: 7000,
    fee: 0,
    total: 7000,
    status: 'wait_approval',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - 13 * MIN),
    // Hết hạn duyệt rồi (demo trạng thái đếm ngược về 0 / sắp bị job quét chuyển REJECTED).
    approvalDeadline: isoOffset(MOCK_NOW - 1 * MIN),
    loginAt: null,
    createdBy: null,
    approvedBy: null,
    cancelledBy: null,
    cancelReason: null,
  },
  {
    bookId: 3,
    bookCode: 'DM1A4PX',
    zOid: 'STAFF-2-a1b2',
    channel: 'staff',
    member: { userId: 503, username: 'hoivien03' },
    pc: 'PC-02',
    machineGroup: 'VIP',
    pcState: 'on_idle',
    from: isoOffset(MOCK_NOW + 2 * HOUR),
    to: isoOffset(MOCK_NOW + 4 * HOUR),
    minutes: 120,
    pricePerHour: 8000,
    fee: 0,
    total: 16000,
    status: 'confirmed',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - HOUR),
    approvalDeadline: null,
    loginAt: null,
    createdBy: { staffId: 2, name: 'Thu ngân Lan' },
    approvedBy: { staffId: 2, name: 'Thu ngân Lan' },
    cancelledBy: null,
    cancelReason: null,
  },
  {
    bookId: 4,
    bookCode: 'DM5Q8ZZ',
    zOid: 'FZ-20261019-0004',
    channel: 'fzone',
    member: { userId: 504, username: 'hoivien04' },
    pc: 'PC-03',
    machineGroup: 'Thường',
    pcState: 'in_use',
    from: isoOffset(MOCK_NOW - HOUR),
    to: isoOffset(MOCK_NOW + HOUR),
    minutes: 120,
    pricePerHour: 7000,
    fee: 0,
    total: 14000,
    status: 'in_use',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - 2 * HOUR),
    approvalDeadline: null,
    loginAt: isoOffset(MOCK_NOW - 55 * MIN),
    createdBy: null,
    approvedBy: { staffId: 1, name: 'Quản lý' },
    cancelledBy: null,
    cancelReason: null,
  },
  {
    bookId: 5,
    bookCode: 'DM3C6YY',
    zOid: 'FZ-20261018-0099',
    channel: 'fzone',
    member: { userId: 505, username: 'hoivien05' },
    pc: 'PC-05',
    machineGroup: 'Thường',
    pcState: 'unknown',
    from: isoOffset(MOCK_NOW - 6 * HOUR),
    to: isoOffset(MOCK_NOW - 4 * HOUR),
    minutes: 120,
    pricePerHour: 7000,
    fee: 0,
    total: 14000,
    status: 'done',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - 8 * HOUR),
    approvalDeadline: null,
    loginAt: isoOffset(MOCK_NOW - 6 * HOUR),
    createdBy: null,
    approvedBy: { staffId: 1, name: 'Quản lý' },
    cancelledBy: null,
    cancelReason: null,
  },
  {
    bookId: 6,
    bookCode: 'DM2V1WW',
    zOid: 'FZ-20261018-0050',
    channel: 'fzone',
    member: { userId: 506, username: 'hoivien06' },
    pc: 'PC-04',
    machineGroup: 'Thường',
    pcState: 'off',
    from: isoOffset(MOCK_NOW - 20 * HOUR),
    to: isoOffset(MOCK_NOW - 19 * HOUR),
    minutes: 60,
    pricePerHour: 7000,
    fee: 0,
    total: 7000,
    status: 'no_show',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - 22 * HOUR),
    approvalDeadline: null,
    loginAt: null,
    createdBy: null,
    approvedBy: { staffId: 1, name: 'Quản lý' },
    cancelledBy: null,
    cancelReason: null,
  },
  {
    bookId: 7,
    bookCode: 'DM4N0VV',
    zOid: 'STAFF-2-c3d4',
    channel: 'staff',
    member: { userId: 507, username: 'hoivien07' },
    pc: 'PC-01',
    machineGroup: 'VIP',
    pcState: 'off',
    from: isoOffset(MOCK_NOW - 10 * HOUR),
    to: isoOffset(MOCK_NOW - 9 * HOUR),
    minutes: 60,
    pricePerHour: 10000,
    fee: 0,
    total: 10000,
    status: 'cancelled',
    failCode: null,
    createdAt: isoOffset(MOCK_NOW - 11 * HOUR),
    approvalDeadline: null,
    loginAt: null,
    createdBy: { staffId: 2, name: 'Thu ngân Lan' },
    approvedBy: { staffId: 2, name: 'Thu ngân Lan' },
    cancelledBy: { staffId: 1, name: 'Quản lý' },
    cancelReason: 'Khách gọi báo không đến được nữa',
  },
  {
    bookId: 8,
    bookCode: 'DM6R7UU',
    zOid: 'FZ-20261018-0010',
    channel: 'fzone',
    member: { userId: 508, username: 'hoivien08' },
    pc: 'PC-02',
    machineGroup: 'VIP',
    pcState: 'on_idle',
    from: isoOffset(MOCK_NOW - 30 * HOUR),
    to: isoOffset(MOCK_NOW - 29 * HOUR),
    minutes: 60,
    pricePerHour: 8000,
    fee: 0,
    total: 8000,
    status: 'rejected',
    failCode: 'APPROVAL_TIMEOUT',
    createdAt: isoOffset(MOCK_NOW - 31 * HOUR),
    approvalDeadline: isoOffset(MOCK_NOW - 30.5 * HOUR),
    loginAt: null,
    createdBy: null,
    approvedBy: null,
    cancelledBy: null,
    cancelReason: null,
  },
]

let mockMachines: AdminMachine[] = [
  {
    machineId: 101,
    pc: 'PC-01',
    machineGroupId: 1,
    machineGroup: 'VIP',
    enabled: true,
    prices: mockBoardMachines[0].prices,
  },
  {
    machineId: 102,
    pc: 'PC-02',
    machineGroupId: 1,
    machineGroup: 'VIP',
    enabled: true,
    prices: mockBoardMachines[1].prices,
  },
  {
    machineId: 103,
    pc: 'PC-03',
    machineGroupId: 2,
    machineGroup: 'Thường',
    enabled: false,
    prices: mockBoardMachines[2].prices,
  },
  {
    machineId: 104,
    pc: 'PC-04',
    machineGroupId: 2,
    machineGroup: 'Thường',
    enabled: true,
    prices: mockBoardMachines[3].prices,
  },
  {
    machineId: 105,
    pc: 'PC-05',
    machineGroupId: 2,
    machineGroup: 'Thường',
    enabled: false,
    prices: mockBoardMachines[4].prices,
  },
]

let mockConfig: ConfigResponse = {
  setting: { v: 1, enabled: 1, fee: 0, approval_mode: 1 },
  time: { v: 1, max_ahead: 120, max_hours: 6, min_lead: 15, buffer: 10, approval_timeout: 15 },
  station: { v: 1, lock_window: 180, early_login: 10 },
  corrupt: [],
}

function slotSourceOf(channel: BookingChannel): SlotSource {
  return channel === 'staff' ? 'counter' : 'online'
}

function buildMockBoard(): BoardResponse {
  const live = mockBookings.filter((b) => b.status === 'wait_approval' || b.status === 'confirmed' || b.status === 'in_use')
  const machines: BoardMachine[] = mockBoardMachines.map((m) => {
    const bookedSlots: BookedSlot[] = live
      .filter((b) => b.pc === m.pc)
      .map((b) => ({ from: b.from, to: b.to, source: slotSourceOf(b.channel), state: b.status as SlotState }))
      .sort((a, b) => a.from.localeCompare(b.from))
    const available = m.pcState === 'off'
    const bookableNow: BookableNow = available
      ? { earliestFrom: isoOffset(MOCK_NOW + mockConfig.time.min_lead * MIN), maxMinutes: mockConfig.time.max_hours * 60 }
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
    minLeadMin: mockConfig.time.min_lead,
    maxAheadMin: mockConfig.time.max_ahead,
    slotBufferMin: mockConfig.time.buffer,
    horizon: { from: isoOffset(Date.now()), to: isoOffset(Date.now() + 8 * HOUR) },
    machines: mockConfig.setting.enabled === 1 ? machines : [],
  }
}

function mockResolveQuote(payload: QuotePayload): QuoteResponse {
  if (mockConfig.setting.enabled !== 1) mockFail('DISABLED', 'Tính năng đặt máy online đang tắt')
  const machine = mockBoardMachines.find((m) => m.pc === payload.pc)
  if (!machine) mockFail('NOT_BOOKABLE', 'Máy không nằm trong danh sách cho đặt online')
  if (machine.pcState !== 'off') mockFail('MACHINE_NOT_OFF', 'Máy đang bật — chỉ đặt được máy đang tắt')
  if (!Number.isInteger(payload.hours) || payload.hours < 1 || payload.hours > mockConfig.time.max_hours) {
    mockFail('BAD_HOURS', `Số giờ đặt phải từ 1 đến ${mockConfig.time.max_hours}`)
  }
  const username = payload.username.trim().toLowerCase()
  const phoneOk = normalizePhone(payload.phone) === normalizePhone(MOCK_MEMBER.phone)
  if (username !== MOCK_MEMBER.username || !phoneOk) {
    mockFail('MEMBER_MISMATCH', 'Tên đăng nhập và số điện thoại không khớp')
  }
  const pricePerHour = machine.prices[0]?.pricePerHour ?? 0
  const fee = mockConfig.setting.fee
  const total = pricePerHour * payload.hours + fee
  const to = isoOffset(payload.from * 1000 + payload.hours * HOUR)
  return { pricePerHour, fee, total, to, memberName: MOCK_MEMBER.name }
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
      member: { userId: MOCK_MEMBER.userId, username: MOCK_MEMBER.username },
      pc: payload.pc,
      machineGroup: mockBoardMachines.find((m) => m.pc === payload.pc)?.machineGroup ?? '',
      pcState: 'off',
      from: isoOffset(payload.from * 1000),
      to: quote.to,
      minutes: payload.hours * 60,
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
    if (machine && machine.pcState !== 'off') mockFail('MACHINE_NOT_OFF', 'Máy đang bật — chỉ đặt được máy đang tắt')
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

export function cancelBooking(payload: { bookId: number; reason: string }): Promise<Booking> {
  if (USE_MOCK) {
    const booking = mockBookings.find((b) => b.bookId === payload.bookId)
    if (!booking) mockFail('BAD_STATUS', 'Không tìm thấy đơn')
    if (booking.status !== 'confirmed') mockFail('BAD_STATUS', 'Chỉ huỷ được đơn đã xác nhận, chưa login')
    const staff = currentStaff()
    booking.status = 'cancelled'
    booking.cancelledBy = staff
    booking.cancelReason = payload.reason
    return mockDelay({ ...booking })
  }
  return apiPost<Booking, { bookId: number; reason: string }>('/onlinebook/cancel', payload)
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
  if (next.time.max_ahead > next.station.lock_window) {
    errors.push({ row: 'time', key: 'max_ahead', message: 'Không được lớn hơn "Khoá đăng nhập trước giờ đặt"' })
  }
  if (next.setting.approval_mode === 1 && next.time.min_lead < next.time.approval_timeout) {
    errors.push({ row: 'time', key: 'min_lead', message: 'Duyệt tay: phải ≥ "Hết hạn chờ duyệt"' })
  }
  if (next.station.early_login > next.time.min_lead) {
    errors.push({ row: 'station', key: 'early_login', message: 'Không được lớn hơn "Không đặt sát giờ"' })
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
