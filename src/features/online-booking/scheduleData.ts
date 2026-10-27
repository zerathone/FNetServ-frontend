import {
  getBookingList,
  type BoardResponse,
  type Booking,
  type BookingStatus,
  type PcState,
} from '../../api/onlineBooking'
import type { WorkstationRuntime } from '../../api/workstations'

// Dữ liệu + quy tắc dùng chung cho hai view của mục Lịch theo máy: Sơ đồ (MachineScheduleMap) và Timeline.

/** Server giới hạn limit ≤ 200 mỗi lần; khoảng đông khách thì lấy nhiều trang (tối đa MAX_PAGES). */
export const PAGE_LIMIT = 200
export const MAX_PAGES = 10

/** Tình trạng màu: free = máy chưa có đơn; còn lại theo trạng thái đơn. Dùng chung cho thẻ, khối giờ, chấm và chú giải. */
export type ScheduleTone = 'free' | 'pending' | 'active' | 'past' | 'closed'

export type MachineCell = { pc: string; bookings: Booking[] }
export type MachineGroupRow = { name: string; machines: MachineCell[] }

export async function fetchScheduleBookings(
  fromDate: string,
  toDate: string,
): Promise<{ items: Booking[]; truncated: boolean }> {
  const items: Booking[] = []
  let total = 0
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await getBookingList({ fromDate, toDate, limit: PAGE_LIMIT, offset: page * PAGE_LIMIT })
    total = result.total
    items.push(...result.items)
    if (result.items.length === 0 || items.length >= total) break
  }
  return { items, truncated: items.length < total }
}

/** Màu của TỪNG đơn — cùng bảng màu với thẻ máy và chú giải, để một đơn không lệch màu so với thẻ chứa nó. */
export const BOOKING_TONE: Record<BookingStatus, Exclude<ScheduleTone, 'free'>> = {
  pending: 'pending',
  wait_approval: 'pending',
  confirmed: 'active',
  in_use: 'active',
  done: 'past',
  no_show: 'past',
  cancelled: 'closed',
  rejected: 'closed',
}

export const SCHEDULE_LEGEND: Array<{ tone: ScheduleTone; label: string }> = [
  { tone: 'free', label: 'Trống' },
  { tone: 'pending', label: 'Chờ duyệt' },
  { tone: 'active', label: 'Đã duyệt / đang dùng' },
  { tone: 'past', label: 'Đã xong / không đến' },
  { tone: 'closed', label: 'Huỷ / từ chối' },
]

/** Gom máy theo nhóm (thứ tự theo /board); máy có đơn nhưng không còn trong /board (đã tắt đặt online, đã đổi máy…) vẫn hiện. */
export function groupMachines(board: BoardResponse | undefined, bookings: Booking[]): MachineGroupRow[] {
  const groups = new Map<string, Map<string, MachineCell>>()
  const cellOf = (groupName: string, pc: string): MachineCell => {
    const name = groupName.trim() || 'Khác'
    let machines = groups.get(name)
    if (!machines) {
      machines = new Map()
      groups.set(name, machines)
    }
    let cell = machines.get(pc)
    if (!cell) {
      cell = { pc, bookings: [] }
      machines.set(pc, cell)
    }
    return cell
  }

  for (const machine of board?.machines ?? []) cellOf(machine.machineGroup, machine.pc)

  // Đơn gắn vào máy theo tên máy; nhóm lấy từ /board nếu có, ngược lại từ chính đơn.
  const groupOfPc = new Map((board?.machines ?? []).map((m) => [m.pc.toLowerCase(), m.machineGroup]))
  for (const booking of bookings) {
    cellOf(groupOfPc.get(booking.pc.toLowerCase()) ?? booking.machineGroup, booking.pc).bookings.push(booking)
  }

  return Array.from(groups, ([name, machines]) => ({
    name,
    machines: Array.from(machines.values()).map((cell) => ({
      ...cell,
      bookings: cell.bookings.sort((a, b) => a.from.localeCompare(b.from)),
    })),
  }))
}

// ===== Trạng thái máy trạm + người đang dùng (chỉ cho Timeline) =====

/** Nhãn ngắn trạng thái máy (thẻ hẹp). */
export const SCHEDULE_PC_STATE_SHORT: Record<PcState, string> = {
  off: 'Tắt',
  on_idle: 'Chờ đăng nhập',
  in_use: 'Đang dùng',
  unknown: 'Không rõ',
}

export type LiveUserKind = 'member' | 'anonym' | 'combo' | 'admin'

const LIVE_USER_KIND_LABEL: Record<LiveUserKind, string> = {
  member: 'Hội viên',
  anonym: 'Vãng lai',
  combo: 'Combo',
  admin: 'Admin',
}

// Giống trang Máy trạm (WorkstationWorkspace): userId 0 = admin, còn lại theo userGroupType.
const USER_GROUP_TYPE = { anonym: 1, member: 2, combo: 5 } as const

export type LiveUser = {
  /** "Hội viên hoang123", "Vãng lai", "Combo Giờ vàng", "Admin tên"… */
  label: string
  /** Thời điểm phiên dự kiến hết (ms, giờ máy chủ) — null khi không biết (vãng lai trả sau, admin). */
  endsAtMs: number | null
}

/** Người đang dùng máy theo /workstations/runtime; null khi máy không có phiên. */
export function liveUserOf(workstation: WorkstationRuntime | undefined, serverTimeMs: number): LiveUser | null {
  const session = workstation?.session
  if (!workstation || !session) return null
  let kind: LiveUserKind | null = null
  if (workstation.userId === 0) kind = 'admin'
  else if (workstation.userGroupType === USER_GROUP_TYPE.member) kind = 'member'
  else if (workstation.userGroupType === USER_GROUP_TYPE.anonym) kind = 'anonym'
  else if (workstation.userGroupType === USER_GROUP_TYPE.combo) kind = 'combo'
  const name = kind === 'combo' ? (session.comboName ?? workstation.userName) : workstation.userName
  return {
    label: [kind ? LIVE_USER_KIND_LABEL[kind] : 'Đang dùng', name].filter(Boolean).join(' '),
    endsAtMs: session.remainingSeconds != null ? serverTimeMs + session.remainingSeconds * 1000 : null,
  }
}

/** Khi khoá guard login chưa có số liệu từ server cũ. */
export const DEFAULT_LOCK_WINDOW_MIN = 180

/**
 * Cảnh báo "máy chưa trống cho người đặt": đơn ĐÃ DUYỆT (chủ đơn chưa vào máy), đã vào cửa sổ khoá
 * (`từ − lockWindow`, hoặc đã qua giờ bắt đầu) mà máy VẪN có người dùng. Guard login chỉ chặn người mới vào,
 * không đá người đang chơi — nên đây là chỗ nhân viên cần xử lý.
 * Người đang dùng dự kiến hết TRƯỚC giờ bắt đầu (hội viên còn ít thời gian) thì không cảnh báo;
 * không biết giờ hết (vãng lai trả sau, admin) thì luôn cảnh báo. Trả lý do, hoặc null nếu không cần cảnh báo.
 */
export function bookingAttention(
  booking: Booking,
  pcState: PcState,
  user: LiveUser | null,
  lockWindowMin: number,
  nowMs: number,
): string | null {
  if (booking.status !== 'confirmed' || pcState !== 'in_use') return null
  const from = Date.parse(booking.from)
  const to = Date.parse(booking.to)
  if (!Number.isFinite(from) || !Number.isFinite(to)) return null
  if (nowMs < from - lockWindowMin * 60_000 || nowMs >= to) return null
  if (user?.endsAtMs != null && user.endsAtMs <= from) return null
  return 'Sắp tới giờ đặt nhưng máy vẫn đang có người dùng — có thể không trống đúng giờ cho người đặt.'
}
/** Chú thích nút "Chi tiết" trên thẻ đơn (Theo thời gian / Theo máy). */
export const DETAIL_HINT = {
  wait_approval: 'Chi tiết — xem đơn trong danh sách chờ duyệt',
  confirmed: 'Chi tiết — xem đơn trong danh sách để đổi máy hoặc huỷ',
} as const