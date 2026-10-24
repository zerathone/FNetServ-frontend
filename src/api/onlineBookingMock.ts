// Dữ liệu GIẢ cho trang Đặt máy online — sửa thoải mái ở đây rồi xem kết quả trên UI.
//
// Bật mock (chỉ chạy `npm run dev`, không bao giờ vào bản build):
//   tạo `fnet-web/.env.development.local` (file *.local không commit) với dòng
//     VITE_OB_MOCK=1
//   rồi khởi động lại `npm run dev`. Bỏ dòng đó (hoặc đặt 0) để quay về server thật.
//
// Khi bật, MỌI endpoint /onlinebook/* (board, list, quote, create, approve, reject, cancel, config,
// máy cho đặt) đều trả dữ liệu trong file này, thao tác Duyệt/Từ chối/Huỷ/Đặt hộ/Lưu cấu hình chạy trong
// bộ nhớ trình duyệt — tải lại trang (F5) là dữ liệu về lại như file này. Không ghi gì xuống server.
//
// Mốc thời gian đều tính TƯƠNG ĐỐI so với lúc mở trang (vd `at(+45)` = 45 phút nữa) nên đơn luôn "còn mới".

import type {
  AdminMachine,
  Booking,
  BookingStatus,
  ConfigResponse,
  MachinePrice,
  PcState,
} from './onlineBooking'

export const MIN = 60_000
export const HOUR = 3_600_000

/** Gốc thời gian của mock: lúc nạp module. */
export const MOCK_NOW = Date.now()

/** Chuỗi giờ dạng server (+07:00, giờ địa phương máy dev). */
export function isoOffset(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}+07:00`
  )
}

/** `at(+45)` = 45 phút sau, `at(-90)` = 90 phút trước (so với MOCK_NOW). */
const at = (minutes: number) => isoOffset(MOCK_NOW + minutes * MIN)

// ===== Hội viên (đặt hộ chỉ nhận cặp username + số điện thoại khớp một dòng ở đây) =====

export type MockMember = { userId: number; username: string; phone: string; name: string }

export const MOCK_MEMBERS: MockMember[] = [
  { userId: 501, username: 'hoivien01', phone: '0901234567', name: 'Nguyễn Văn An' },
  { userId: 502, username: 'tuanpro', phone: '0912345678', name: 'Trần Minh Tuấn' },
  { userId: 503, username: 'linhgamer', phone: '0923456789', name: 'Lê Thuỳ Linh' },
  { userId: 504, username: 'hoangnam', phone: '0934567890', name: 'Phạm Hoàng Nam' },
  { userId: 505, username: 'baotran', phone: '0945678901', name: 'Trần Gia Bảo' },
  { userId: 506, username: 'minhkhoi', phone: '0956789012', name: 'Võ Minh Khôi' },
  { userId: 507, username: 'thuhang', phone: '0967890123', name: 'Đặng Thu Hằng' },
  { userId: 508, username: 'quocdat', phone: '0978901234', name: 'Bùi Quốc Đạt' },
  { userId: 509, username: 'ngocanh', phone: '0989012345', name: 'Hồ Ngọc Anh' },
  { userId: 510, username: 'vietcuong', phone: '0990123456', name: 'Đỗ Việt Cường' },
]

function member(index: number) {
  const m = MOCK_MEMBERS[index]
  return { userId: m.userId, username: m.username }
}

// ===== Máy + bảng giá (nhóm VIP / Thường / Streaming) =====

export type MockBoardMachine = {
  pc: string
  machineGroupId: number
  machineGroup: string
  pcState: PcState
  prices: MachinePrice[]
}

const PRICES_VIP: MachinePrice[] = [
  { userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 12000 },
  { userGroupId: 4, userGroup: 'Hội viên VIP', pricePerHour: 10000 },
]
const PRICES_STD: MachinePrice[] = [{ userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 7000 }]
const PRICES_STREAM: MachinePrice[] = [
  { userGroupId: 3, userGroup: 'Hội viên', pricePerHour: 15000 },
  { userGroupId: 4, userGroup: 'Hội viên VIP', pricePerHour: 13000 },
]

/** pcState: 'off' = đang tắt (đặt được) · 'on_idle' = bật chưa ai ngồi · 'in_use' = có khách · 'unknown'. */
export function createMockBoardMachines(): MockBoardMachine[] {
  const m = (pc: string, machineGroupId: number, machineGroup: string, pcState: PcState, prices: MachinePrice[]) => ({
    pc,
    machineGroupId,
    machineGroup,
    pcState,
    prices,
  })
  return [
    m('VIP-01', 1, 'VIP', 'off', PRICES_VIP),
    m('VIP-02', 1, 'VIP', 'on_idle', PRICES_VIP),
    m('VIP-03', 1, 'VIP', 'off', PRICES_VIP),
    m('VIP-04', 1, 'VIP', 'in_use', PRICES_VIP),
    m('PC-01', 2, 'Thường', 'off', PRICES_STD),
    m('PC-02', 2, 'Thường', 'in_use', PRICES_STD),
    m('PC-03', 2, 'Thường', 'off', PRICES_STD),
    m('PC-04', 2, 'Thường', 'off', PRICES_STD),
    m('PC-05', 2, 'Thường', 'unknown', PRICES_STD),
    m('PC-06', 2, 'Thường', 'off', PRICES_STD),
    m('PC-07', 2, 'Thường', 'on_idle', PRICES_STD),
    m('PC-08', 2, 'Thường', 'off', PRICES_STD),
    m('ST-01', 3, 'Streaming', 'off', PRICES_STREAM),
    m('ST-02', 3, 'Streaming', 'off', PRICES_STREAM),
    m('ST-03', 3, 'Streaming', 'in_use', PRICES_STREAM),
  ]
}

/** Danh sách "Máy cho đặt online" ở trang cấu hình — `enabled` là máy đang được tích cho đặt. */
export function createMockAdminMachines(board: MockBoardMachine[]): AdminMachine[] {
  const disabled = new Set(['VIP-04', 'PC-02', 'PC-05', 'ST-03'])
  return board.map((m, index) => ({
    machineId: 101 + index,
    pc: m.pc,
    machineGroupId: m.machineGroupId,
    machineGroup: m.machineGroup,
    enabled: !disabled.has(m.pc),
    prices: m.prices,
  }))
}

// ===== Cấu hình =====

export function createMockConfig(): ConfigResponse {
  return {
    setting: { v: 1, enabled: 1, fee: 2000, approval_mode: 1 },
    // task OB-R8: mặc định mới — đặt trước 1 ngày, tối thiểu 1 giờ/đơn, bắt máy tắt khi đặt trong vòng 4 giờ.
    time: {
      v: 1,
      max_ahead: 1440,
      max_hours: 6,
      min_hours: 1,
      min_lead: 15,
      buffer: 10,
      approval_timeout: 15,
      require_off_within: 240,
    },
    station: { v: 1, lock_window: 180, early_login: 10, late_hold: 30 },
    corrupt: [],
  }
}

// ===== Đơn đặt máy =====

type SeedExtra = Partial<
  Pick<
    Booking,
    | 'channel'
    | 'failCode'
    | 'createdAt'
    | 'approvalDeadline'
    | 'loginAt'
    | 'createdBy'
    | 'approvedBy'
    | 'cancelledBy'
    | 'cancelReason'
    | 'payMethod'
    | 'cancelCredit'
    | 'cancelCreditAmount'
    | 'fee'
  >
>

const STAFF_LAN = { staffId: 2, name: 'Thu ngân Lan' }
const MANAGER = { staffId: 1, name: 'Quản lý' }

export function createMockBookings(board: MockBoardMachine[], fee: number): Booking[] {
  let nextId = 1
  /**
   * @param code      mã đơn hiển thị
   * @param memberIdx chỉ số trong MOCK_MEMBERS
   * @param pc        tên máy (phải có trong createMockBoardMachines)
   * @param startMin  giờ bắt đầu, phút so với bây giờ (+ = tương lai, - = quá khứ)
   * @param hours     số giờ đặt
   * @param status    trạng thái đơn
   */
  const make = (
    code: string,
    memberIdx: number,
    pc: string,
    startMin: number,
    hours: number,
    status: BookingStatus,
    extra: SeedExtra = {},
  ): Booking => {
    const machine = board.find((b) => b.pc === pc)
    if (!machine) throw new Error(`Mock: không có máy ${pc}`)
    const pricePerHour = machine.prices[0]?.pricePerHour ?? 0
    const orderFee = extra.fee ?? fee
    const id = nextId++
    const channel = extra.channel ?? 'fzone'
    return {
      bookId: id,
      bookCode: code,
      zOid: channel === 'staff' ? `STAFF-${STAFF_LAN.staffId}-${code.toLowerCase()}` : `FZ-MOCK-${String(id).padStart(4, '0')}`,
      channel,
      member: member(memberIdx),
      pc,
      machineGroup: machine.machineGroup,
      pcState: machine.pcState,
      from: at(startMin),
      to: at(startMin + hours * 60),
      minutes: hours * 60,
      pricePerHour,
      fee: orderFee,
      total: pricePerHour * hours + orderFee,
      status,
      failCode: extra.failCode ?? null,
      createdAt: extra.createdAt ?? at(Math.min(startMin, 0) - 20),
      approvalDeadline: extra.approvalDeadline ?? null,
      loginAt: extra.loginAt ?? null,
      createdBy: extra.createdBy ?? (channel === 'staff' ? STAFF_LAN : null),
      approvedBy: extra.approvedBy ?? null,
      cancelledBy: extra.cancelledBy ?? null,
      cancelReason: extra.cancelReason ?? null,
      payMethod: extra.payMethod ?? 'wallet', // đơn đặt hộ luôn là ví
      cancelCredit: extra.cancelCredit,
      cancelCreditAmount: extra.cancelCreditAmount,
    }
  }

  return [
    // ---- CHỜ DUYỆT (hiện ở khối "Chờ duyệt", có nút Duyệt / Từ chối) ----
    make('DM7K3QX', 0, 'VIP-01', +45, 2, 'wait_approval', {
      createdAt: at(-3),
      approvalDeadline: at(+12),
    }),
    make('DM2QRPAY', 1, 'PC-04', +30, 3, 'wait_approval', {
      createdAt: at(-6),
      approvalDeadline: at(+9),
      payMethod: 'qr', // khách trả QR: tiền đã nạp vào ví lúc đặt
    }),
    make('DM9B2LK', 2, 'PC-06', +20, 1, 'wait_approval', {
      createdAt: at(-14),
      approvalDeadline: at(-1), // đã quá hạn duyệt → badge đỏ "Đã hết hạn duyệt"
    }),
    make('DM8ST01', 3, 'ST-01', +60, 4, 'wait_approval', {
      createdAt: at(-1),
      approvalDeadline: at(+14),
    }),

    // ---- ĐÃ DUYỆT, chờ khách đến (có nút Huỷ) ----
    make('DM1A4PX', 4, 'VIP-03', +120, 2, 'confirmed', {
      channel: 'staff',
      createdAt: at(-60),
      approvedBy: STAFF_LAN,
    }),
    make('DM5QRCF', 5, 'PC-01', +90, 2, 'confirmed', {
      createdAt: at(-40),
      approvedBy: MANAGER,
      payMethod: 'qr',
    }),
    make('DM6WLT2', 6, 'PC-03', +150, 3, 'confirmed', {
      createdAt: at(-25),
      approvedBy: STAFF_LAN,
    }),
    make('DM3ST22', 7, 'ST-02', +200, 2, 'confirmed', {
      createdAt: at(-10),
      approvedBy: MANAGER,
    }),

    // ---- ĐANG DÙNG ----
    make('DM5Q8ZZ', 8, 'PC-08', -55, 2, 'in_use', {
      createdAt: at(-120),
      loginAt: at(-52),
      approvedBy: MANAGER,
    }),
    make('DM4VIP9', 9, 'VIP-04', -20, 3, 'in_use', {
      channel: 'staff',
      createdAt: at(-90),
      loginAt: at(-18),
      approvedBy: STAFF_LAN,
    }),

    // ---- ĐÃ DÙNG XONG / KHÔNG ĐẾN ----
    make('DM3C6YY', 0, 'PC-07', -360, 2, 'done', {
      createdAt: at(-480),
      loginAt: at(-358),
      approvedBy: MANAGER,
    }),
    make('DM0DONE', 1, 'VIP-02', -300, 1, 'done', {
      channel: 'staff',
      createdAt: at(-420),
      loginAt: at(-295),
      approvedBy: STAFF_LAN,
    }),
    make('DM2V1WW', 2, 'PC-04', -240, 1, 'no_show', {
      createdAt: at(-330),
      approvedBy: MANAGER,
    }),

    // ---- ĐÃ HUỶ (đủ 4 kiểu hoàn tiền: không hoàn / đã cộng / đang cộng / lỗi cần đối soát) ----
    make('DM4N0VV', 3, 'VIP-01', -600, 1, 'cancelled', {
      channel: 'staff',
      createdAt: at(-700),
      approvedBy: STAFF_LAN,
      cancelledBy: MANAGER,
      cancelReason: 'Khách gọi báo không đến được nữa',
      cancelCredit: 'none',
    }),
    make('DM7CRED', 4, 'PC-03', -500, 2, 'cancelled', {
      createdAt: at(-620),
      approvedBy: MANAGER,
      cancelledBy: STAFF_LAN,
      cancelReason: 'Khách xin đổi lịch, hoàn lại ví',
      cancelCredit: 'credited',
      cancelCreditAmount: 16000,
      payMethod: 'qr',
    }),
    make('DM8PEND', 5, 'ST-01', -450, 1, 'cancelled', {
      createdAt: at(-560),
      approvedBy: MANAGER,
      cancelledBy: MANAGER,
      cancelReason: 'Máy hỏng đột xuất',
      cancelCredit: 'pending',
      cancelCreditAmount: 17000,
    }),
    make('DM9FAIL', 6, 'PC-01', -420, 1, 'cancelled', {
      createdAt: at(-540),
      approvedBy: STAFF_LAN,
      cancelledBy: MANAGER,
      cancelReason: 'Khách đổi ý',
      cancelCredit: 'failed',
      cancelCreditAmount: 9000,
    }),

    // ---- BỊ TỪ CHỐI / HẾT HẠN DUYỆT ----
    make('DM6R7UU', 7, 'VIP-02', -1800, 1, 'rejected', {
      createdAt: at(-1860),
      approvalDeadline: at(-1845),
      failCode: 'APPROVAL_TIMEOUT',
    }),
    make('DM1NOBAL', 8, 'PC-06', -200, 1, 'rejected', {
      createdAt: at(-230),
      approvalDeadline: at(-215),
      failCode: 'REJECTED_BY_STAFF',
      cancelReason: 'Máy đã có người đặt trước',
    }),
  ]
}
