import type {
  WorkstationRuntime,
  WorkstationRuntimeSession,
} from '../../api/workstations'
import type { StatusTone } from '../../design-system/components'

export const WORKSTATION_STATUS = {
  INIT_INFO: 0,
  AVAILABLE: 1,
  DISCONNECT: 2,
  ONLINE: 3,
  WARNING: 4,
} as const

// Mirror enum LOGIN_TYPE (FNetProtocol.h:175-185) -- gia tri KHONG tuan tu don gian
// 0/1, tung bi nham loginType===0 la "vang lai" (that ra 0 la LOGIN_TYPE_INVALID).
export const LOGIN_TYPE = {
  INVALID: 0,
  ADMIN: 1,
  MEMBER: 2,
  ANONYM_PREPAID: 3,
  ANONYM_PAY_LATER: 4,
  COMBO_CARD: 5,
  COMBO_BOOK: 6,
  MEMBER_USE_COMBO: 7,
} as const

export const WORKSTATION_FLAGS = {
  USER_UNDER18: 0x00000001,
  SERVICE_ORDER: 0x00000002,
  SERVICE_ACCEPT: 0x00000004,
  HAVE_NOT_PAID: 0x00000008,
  CLIENT_PAUSE: 0x00000010,
  CLIENT_LOCK: 0x00000020,
  CHANGING_PC: 0x00000040,
  AUTO_RELOGIN_SESSION: 0x00000080,
  TRANSFER_PAYMENT: 0x00000100,
  QR_PAYMENT: 0x00000200,
} as const

export type WorkstationFilter =
  | 'connected'
  | 'playing'
  | 'available'
  | 'debt'
  | 'warning'
  | 'serviceDebt'
  | 'disconnected'
  | 'all'

export type WorkstationStatusView = {
  label: string
  tone: StatusTone
}

export function getWorkstationStatus(machine: WorkstationRuntime): WorkstationStatusView {
  if (machine.lockLogin || machine.flagMask & WORKSTATION_FLAGS.CLIENT_LOCK) {
    return { label: 'Giữ máy', tone: 'danger' }
  }
  if (machine.status === WORKSTATION_STATUS.ONLINE && machine.userId === 0) {
    return { label: 'ADMIN', tone: 'warning' }
  }

  switch (machine.status) {
    case WORKSTATION_STATUS.AVAILABLE:
      return { label: 'Sẵn sàng', tone: 'success' }
    case WORKSTATION_STATUS.DISCONNECT:
      return { label: 'Mất kết nối', tone: 'danger' }
    case WORKSTATION_STATUS.ONLINE:
      return { label: 'Đang sử dụng', tone: 'info' }
    case WORKSTATION_STATUS.WARNING:
      return { label: 'Cảnh báo', tone: 'warning' }
    case WORKSTATION_STATUS.INIT_INFO:
      return { label: 'Đang khởi tạo', tone: 'neutral' }
    default:
      return { label: `Không rõ (${machine.status})`, tone: 'neutral' }
  }
}

// LicenseStatus cua WMI SoftwareLicensingProduct. Nhan theo cach nhan vien quan
// phong doc duoc, khong dung nguyen thuat ngu Microsoft.
const WIN_LICENSE_LABELS: Record<number, { label: string; tone: StatusTone }> = {
  0: { label: 'Chưa kích hoạt', tone: 'danger' },
  1: { label: 'Đã kích hoạt', tone: 'success' },
  2: { label: 'Dùng thử', tone: 'warning' },
  3: { label: 'Hết hạn dùng thử', tone: 'warning' },
  4: { label: 'Bản không chính hãng', tone: 'warning' },
  5: { label: 'Đang thông báo', tone: 'warning' },
  6: { label: 'Gia hạn tạm', tone: 'warning' },
}

// Chi cac trang thai an han moi co so phut con lai co nghia. Retail perpetual da
// activate tra ve 0/null -> hien "het han" o day la SAI nghiep vu.
const WIN_LICENSE_GRACE_STATUSES = [2, 3, 4, 6]

export type WinLicenseView = {
  label: string
  tone: StatusTone
  /** 5 ky tu cuoi product key, rong neu WMI khong tra */
  pkey: string
  /** Retail / OEM:DM / Volume:GVLK..., rong neu khong co */
  channel: string
  /** "Còn 12 ngày" — null khi khong ap dung */
  graceText: string | null
}

/** Tra ve null khi CHUA CO du lieu -> cot de TRONG (khong phai "chua kich hoat"). */
export function getWinLicenseView(machine: WorkstationRuntime): WinLicenseView | null {
  const lic = machine.winLicense
  if (!lic) return null

  const known = WIN_LICENSE_LABELS[lic.status]
  const base = known ?? { label: `Không rõ (${lic.status})`, tone: 'neutral' as StatusTone }

  let graceText: string | null = null
  if (
    WIN_LICENSE_GRACE_STATUSES.includes(lic.status) &&
    lic.graceMinutes !== null &&
    lic.graceMinutes > 0
  ) {
    const days = Math.floor(lic.graceMinutes / (60 * 24))
    graceText = days >= 1 ? `Còn ${days} ngày` : `Còn ${Math.floor(lic.graceMinutes / 60)} giờ`
  }

  return {
    label: base.label,
    tone: base.tone,
    pkey: lic.pkey ?? '',
    channel: lic.channel ?? '',
    graceText,
  }
}

/** Icon dùng khi flag row có >= 2 mục (tránh chữ dài chồng lên nhau). */
export type FlagIconKey = 'graduationCap' | 'warning' | 'pause' | 'arrowsLeftRight' | 'receipt'

/**
 * hideServiceAccept: bỏ badge "Đã nhận món" khi đã biết chắc máy hết nợ dịch vụ (xem
 * `useServiceAcceptCleared`) — server bật cờ này vô điều kiện cho máy còn giữ user của khách trước.
 */
export function getWorkstationFlags(machine: WorkstationRuntime, options: { hideServiceAccept?: boolean } = {}) {
  // `id` = cờ dịch vụ (UI hiện thành nút bấm). `iconKey` = icon cho chế độ icon-only (flags.length >= 2).
  // `kind` = loại cờ mà icon phụ của máy (tiền / học sinh) cũng thể hiện — để cột Trạng thái bỏ icon trùng (getStatusExtraIcons).
  const flags: Array<{ label: string; tone: StatusTone; id?: 'service_order' | 'service_accept'; iconKey?: FlagIconKey; kind?: 'debt' | 'minor' }> = []
  if (machine.flagMask & WORKSTATION_FLAGS.HAVE_NOT_PAID) {
    flags.push({ label: 'Còn nợ', tone: 'danger', iconKey: 'warning', kind: 'debt' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.SERVICE_ORDER) {
    flags.push({ label: 'Có gọi món', tone: 'warning', id: 'service_order' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.SERVICE_ACCEPT && !options.hideServiceAccept) {
    flags.push({ label: 'Đã nhận món', tone: 'info', id: 'service_accept' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.TRANSFER_PAYMENT) {
    flags.push({ label: 'Đợi chuyển phí', tone: 'warning', iconKey: 'receipt' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.CLIENT_PAUSE) {
    flags.push({ label: 'Tạm dừng', tone: 'neutral', iconKey: 'pause' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.CHANGING_PC) {
    flags.push({ label: 'Đang chuyển máy', tone: 'info', iconKey: 'arrowsLeftRight' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.USER_UNDER18) {
    flags.push({ label: 'Dưới 18 tuổi', tone: 'warning', iconKey: 'graduationCap', kind: 'minor' })
  }
  return flags
}

// ---------------------------------------------------------------------------------------------
// Icon trạng thái máy (task ws-status-icons) — thay cho dải bitmap IDB_LIST_WORKSTATION của MFC.
// Cây quyết định bám WorkstationList.cpp (AddRowToList): Admin → Hội viên → Trả trước → Trả sau; client dưới
// minclientver ghi đè MÀN HÌNH của mọi trạng thái (CLIENT_MINVER_EXPIRED). Khác MFC ở 2 kênh tách riêng:
//   - `screen` (thân màn hình) = trạng thái máy;  - `bar` (thanh chân đế) = loại khách đang dùng.
// ---------------------------------------------------------------------------------------------

/** UGTYPE (DBUtils.h): 1=ANONYM 2=MEMBER 3=ADMIN 4=STAFF 5=COMBOCARD. */
const USER_GROUP_TYPE_MEMBER = 2
const USER_GROUP_TYPE_COMBO_CARD = 5

/**
 * Khách vào máy bằng THẺ COMBO (không phải hội viên dùng combo — người đó vẫn là hội viên). Thẻ combo là tiền trả TRƯỚC, nhưng
 * server chỉ gán cờ `PrePaid` cho khách vãng lai nên phiên thẻ combo có `session.prepaid = false` ⇒ nếu cứ theo cờ sẽ ra màu TRẢ SAU.
 * Nhận diện theo nhóm người dùng (5) hoặc loại đăng nhập của phiên (COMBO_CARD / COMBO_BOOK).
 */
export function isComboCardLogin(machine: WorkstationRuntime): boolean {
  const loginType = machine.session?.loginType
  return (
    machine.userGroupType === USER_GROUP_TYPE_COMBO_CARD ||
    loginType === LOGIN_TYPE.COMBO_CARD ||
    loginType === LOGIN_TYPE.COMBO_BOOK
  )
}

export type IconScreen = 'available' | 'admin' | 'inUse' | 'offline' | 'warning' | 'minVer'
/** Loại khách đang dùng máy — chỉ có ý nghĩa khi screen = 'inUse'. 'none' = không rõ (chưa có phiên). */
export type IconBar = 'none' | 'member' | 'prepaid' | 'postpaid'
/**
 * justOff = máy VỪA tắt trong phiên đang xem (viền đỏ); warning = mất kết nối TCP nhưng ping còn thông (viền cam nháy);
 * minor = người dùng dưới 18 tuổi (viền vàng, kèm icon học sinh). Ưu tiên: justOff > warning > minor — khi trùng,
 * icon học sinh vẫn hiện nên không mất thông tin dưới 18.
 */
export type IconRim = 'none' | 'justOff' | 'warning' | 'minor'
/** reserved = có đơn đặt chỗ sắp tới; late = khách đặt chỗ đã quá giờ bắt đầu mà chưa vào máy. */
export type IconReservation = 'reserved' | 'late'

/**
 * Hoạt động / trạng thái phụ của máy — ĐỒNG BỘ với các cờ ở cột Trạng thái của bảng Chi tiết (getWorkstationFlags) + `Giữ máy`.
 * Thứ tự khai báo = thứ tự hiện trên ô (khi hết chỗ, các mục sau gộp vào chip `+N`).
 */
export type IconActivity = 'lock' | 'order' | 'accept' | 'transfer' | 'pause' | 'changing'

/** Nhãn từng hoạt động (tooltip / aria-label / chú giải) — cùng chữ với cột Trạng thái của bảng Chi tiết. */
export const ICON_ACTIVITY_LABEL: Record<IconActivity, string> = {
  lock: 'Giữ máy',
  order: 'Có gọi món',
  accept: 'Đã nhận món, chờ thu tiền',
  transfer: 'Đợi chuyển phí',
  pause: 'Tạm dừng',
  changing: 'Đang chuyển máy',
}

export type WorkstationIconView = {
  screen: IconScreen
  bar: IconBar
  rim: IconRim
  debt: boolean
  /** Dưới 18 tuổi (cờ USER_UNDER18 của server: tuổi tính từ ngày sinh của tài khoản đang chơi). */
  minor: boolean
  reservation: IconReservation | null
  /** Hoạt động phụ (gọi món, chờ thu tiền, tạm dừng…) — chip nhỏ ở mép dưới ô. Rỗng = không có. */
  activities: IconActivity[]
  /** Mô tả đầy đủ cho tooltip / aria-label: màu không được là kênh thông tin duy nhất. */
  description: string
}

export type WorkstationIconContext = {
  /** Máy vừa chuyển sang mất kết nối trong phiên xem hiện tại (store `useRecentlyOffStore`). */
  justOff?: boolean
  reservation?: IconReservation | null
  /** Máy đã biết chắc hết nợ dịch vụ ⇒ bỏ chip "Đã nhận món" (cờ server còn sót) — giống `hideServiceAccept` của cột Trạng thái. */
  serviceAcceptCleared?: boolean
}

const ICON_BAR_LABEL: Record<IconBar, string | null> = {
  none: null,
  member: 'Hội viên',
  prepaid: 'Vãng lai trả trước',
  postpaid: 'Vãng lai trả sau',
}

export function getWorkstationIconView(
  machine: WorkstationRuntime,
  context: WorkstationIconContext = {},
): WorkstationIconView {
  let screen: IconScreen
  let bar: IconBar = 'none'

  switch (machine.status) {
    case WORKSTATION_STATUS.AVAILABLE:
      screen = 'available'
      break
    case WORKSTATION_STATUS.ONLINE:
      if (machine.userId === 0) {
        screen = 'admin'
      } else {
        screen = 'inUse'
        if (machine.userGroupType === USER_GROUP_TYPE_MEMBER) bar = 'member'
        else if (isComboCardLogin(machine)) bar = 'prepaid' // thẻ combo dùng màu "vãng lai trả trước"
        else if (machine.session?.prepaid) bar = 'prepaid'
        else if (machine.session) bar = 'postpaid'
      }
      break
    case WORKSTATION_STATUS.WARNING:
      screen = 'warning'
      break
    default:
      // DISCONNECT, INIT_INFO và mã lạ: máy tối (không có viền, trừ khi vừa tắt — xem rim bên dưới).
      screen = 'offline'
  }

  const minVer = Boolean(machine.minVerExpired)
  if (minVer) screen = 'minVer'

  const minor = Boolean(machine.flagMask & WORKSTATION_FLAGS.USER_UNDER18)

  let rim: IconRim = 'none'
  if (machine.status === WORKSTATION_STATUS.WARNING) rim = 'warning'
  else if (machine.status === WORKSTATION_STATUS.DISCONNECT && context.justOff) rim = 'justOff'
  else if (minor) rim = 'minor'

  const debt = hasDebt(machine)
  const reservation = context.reservation ?? null
  const activities = getIconActivities(machine, context)

  const parts: string[] = [getWorkstationStatus(machine).label]
  const barLabel = bar === 'prepaid' && isComboCardLogin(machine) ? 'Thẻ combo' : ICON_BAR_LABEL[bar]
  if (barLabel) parts.push(barLabel)
  if (minVer) parts.push('Client dưới phiên bản bắt buộc')
  if (rim === 'justOff') parts.push('Vừa mất kết nối')
  if (minor) parts.push('Dưới 18 tuổi')
  if (debt) parts.push('Còn nợ')
  if (reservation === 'reserved') parts.push('Có đặt chỗ')
  if (reservation === 'late') parts.push('Khách đặt chỗ đến trễ')
  // `Giữ máy` đã là nhãn trạng thái ở đầu mô tả nên không nhắc lại.
  for (const activity of activities) if (activity !== 'lock') parts.push(ICON_ACTIVITY_LABEL[activity])

  return { screen, bar, rim, debt, minor, reservation, activities, description: parts.join(' · ') }
}

/**
 * So sánh THEO NỘI DUNG hai `WorkstationIconView` (hàm trên luôn trả object + mảng `activities` mới nên so `===`
 * luôn khác). Lặp trên `Object.keys` thay vì liệt kê tay: thêm trường vào kiểu sau này không bị bỏ sót im lặng.
 * Mảng so từng phần tử; giá trị còn lại so `Object.is`.
 */
export function iconViewsEqual(a: WorkstationIconView, b: WorkstationIconView): boolean {
  if (a === b) return true
  const left = a as Record<string, unknown>
  const right = b as Record<string, unknown>
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  for (const key of keys) {
    const x = left[key]
    const y = right[key]
    if (Array.isArray(x) && Array.isArray(y)) {
      if (x.length !== y.length || x.some((item, index) => !Object.is(item, y[index]))) return false
    } else if (!Object.is(x, y)) {
      return false
    }
  }
  return true
}

/** Hai Map đặt chỗ cùng nội dung (cùng size, mọi cặp key → giá trị bằng nhau)? */
export function reservationMapsEqual(
  a: ReadonlyMap<string, IconReservation>,
  b: ReadonlyMap<string, IconReservation>,
): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [key, value] of a) {
    if (b.get(key) !== value) return false
  }
  return true
}

/** Cùng điều kiện với cột Trạng thái (getWorkstationStatus / getWorkstationFlags) để hai chế độ xem không lệch nhau. */
function getIconActivities(machine: WorkstationRuntime, context: WorkstationIconContext): IconActivity[] {
  const mask = machine.flagMask
  const activities: IconActivity[] = []
  if (machine.lockLogin || mask & WORKSTATION_FLAGS.CLIENT_LOCK) activities.push('lock')
  if (mask & WORKSTATION_FLAGS.SERVICE_ORDER) activities.push('order')
  if (mask & WORKSTATION_FLAGS.SERVICE_ACCEPT && !context.serviceAcceptCleared) activities.push('accept')
  if (mask & WORKSTATION_FLAGS.TRANSFER_PAYMENT) activities.push('transfer')
  if (mask & WORKSTATION_FLAGS.CLIENT_PAUSE) activities.push('pause')
  if (mask & WORKSTATION_FLAGS.CHANGING_PC) activities.push('changing')
  return activities
}

export type StatusExtraIcon = 'debt' | 'minor' | 'reserved' | 'late'

/**
 * Icon phụ của máy hiện ở cột TRẠNG THÁI (bảng Chi tiết) — KHÔNG đặt cạnh tên máy vì chen mất chỗ của tên.
 * Icon nào cột Trạng thái đã thể hiện sẵn bằng cờ (Còn nợ, Dưới 18 tuổi) thì BỎ để khỏi lặp; chỉ còn lại thứ cột đó
 * chưa có: đặt chỗ (vé xanh = có đặt chỗ, vé đỏ = khách đến trễ).
 */
export function getStatusExtraIcons(
  view: Pick<WorkstationIconView, 'debt' | 'minor' | 'reservation'>,
  flags: ReadonlyArray<{ kind?: 'debt' | 'minor' }>,
): StatusExtraIcon[] {
  const represented = new Set(flags.map((flag) => flag.kind).filter(Boolean))
  const icons: StatusExtraIcon[] = []
  if (view.debt && !represented.has('debt')) icons.push('debt')
  if (view.minor && !represented.has('minor')) icons.push('minor')
  if (view.reservation) icons.push(view.reservation)
  return icons
}

export function isConnected(machine: WorkstationRuntime) {
  return machine.status !== WORKSTATION_STATUS.DISCONNECT
}

export function hasDebt(machine: WorkstationRuntime) {
  return Boolean(machine.flagMask & WORKSTATION_FLAGS.HAVE_NOT_PAID)
}

/**
 * Khách ĐÃ RỜI máy mà còn dịch vụ đã nhận nhưng chưa thu tiền: máy sẵn sàng / ngắt kết nối có cờ SERVICE_ACCEPT (server bật cờ này cho
 * máy còn giữ khách trước hoặc còn nợ dịch vụ). Cùng tình huống MFC rung chuông order_exit.wav và service_debit.
 * isCleared (tuỳ chọn) = hàm biết chắc máy đã thu hết nợ (useServiceAcceptCleared) để bỏ cờ còn sót — giống cột Trạng thái.
 * Máy đang chơi (ONLINE) không tính: khách còn ngồi đó, chưa phải 'rời đi'.
 */
export function hasLeftServiceDebt(machine: WorkstationRuntime, isCleared?: (machine: WorkstationRuntime) => boolean) {
  const left = machine.status === WORKSTATION_STATUS.AVAILABLE || machine.status === WORKSTATION_STATUS.DISCONNECT
  return left && Boolean(machine.flagMask & WORKSTATION_FLAGS.SERVICE_ACCEPT) && !isCleared?.(machine)
}

export function matchesWorkstationFilter(
  machine: WorkstationRuntime,
  filter: WorkstationFilter,
  options: { isServiceAcceptCleared?: (machine: WorkstationRuntime) => boolean } = {},
) {
  if (filter === 'debt') return hasDebt(machine)
  if (filter === 'warning') return machine.status === WORKSTATION_STATUS.WARNING
  if (filter === 'serviceDebt') return hasLeftServiceDebt(machine, options.isServiceAcceptCleared)
  if (filter === 'connected') return isConnected(machine)
  if (filter === 'playing') return machine.status === WORKSTATION_STATUS.ONLINE
  if (filter === 'available') return machine.status === WORKSTATION_STATUS.AVAILABLE
  if (filter === 'disconnected') return machine.status === WORKSTATION_STATUS.DISCONNECT
  return true
}

export function interpolateSession(
  machine: WorkstationRuntime,
  elapsedSeconds: number,
): { used: number | null; remaining: number | null } {
  const session = machine.session
  if (!session) return { used: null, remaining: null }

  const running =
    machine.status === WORKSTATION_STATUS.ONLINE &&
    (machine.flagMask & WORKSTATION_FLAGS.CLIENT_PAUSE) === 0
  const elapsed = running ? Math.max(0, Math.floor(elapsedSeconds)) : 0

  return {
    used: session.usedSeconds === null ? null : session.usedSeconds + elapsed,
    remaining:
      session.remainingSeconds === null
        ? null
        : Math.max(0, session.remainingSeconds - elapsed),
  }
}

export function formatDuration(seconds: number | null | undefined, precision: 'seconds' | 'minutes' = 'seconds') {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—'
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  if (precision === 'minutes') {
    return [hours, minutes].map((value) => String(value).padStart(2, '0')).join(':')
  }
  const remainder = total % 60
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function formatStartedAt(value: string | null | undefined, precision: 'seconds' | 'minutes' = 'seconds') {
  if (!value) return '—'
  const [, time] = value.split(' ')
  if (!time) return value
  return precision === 'minutes' ? time.slice(0, 5) : time
}

export function sessionLabel(session: WorkstationRuntimeSession | null) {
  if (!session) return 'Không có phiên'
  if (session.loginType === LOGIN_TYPE.MEMBER_USE_COMBO) return 'Hội viên (combo)'
  if (session.prepaid) return 'Trả trước'
  switch (session.loginType) {
    case LOGIN_TYPE.MEMBER:
      return 'Hội viên'
    case LOGIN_TYPE.ANONYM_PAY_LATER:
      return 'Vãng lai trả sau'
    case LOGIN_TYPE.COMBO_CARD:
      return 'Thẻ combo'
    case LOGIN_TYPE.COMBO_BOOK:
      return 'Combo đặt trước'
    case LOGIN_TYPE.ADMIN:
      return 'ADMIN'
    default:
      return 'Không xác định'
  }
}

// ---- gom máy theo NHÓM MÁY (chế độ Biểu tượng của thu ngân) ----

export type MachineGroupSection<T> = { groupId: number; name: string; machines: T[] }

/**
 * Gom máy theo nhóm: nhóm theo thứ tự danh sách `groups` (thứ tự quán đặt), nhóm không có trong danh sách xếp sau theo id,
 * máy chưa gán nhóm (id ≤ 0) xếp cuối. Trong mỗi nhóm GIỮ NGUYÊN thứ tự máy đầu vào; nhóm không có máy thì bỏ.
 */
export function groupMachines<T extends { machineGroupId: number; machineGroupName: string | null }>(
  machines: readonly T[],
  groups: readonly { id: number; name: string }[],
): MachineGroupSection<T>[] {
  const byGroup = new Map<number, T[]>()
  for (const machine of machines) {
    const id = machine.machineGroupId > 0 ? machine.machineGroupId : 0
    const list = byGroup.get(id)
    if (list) list.push(machine)
    else byGroup.set(id, [machine])
  }

  const sections: MachineGroupSection<T>[] = []
  const used = new Set<number>()
  for (const group of groups) {
    const list = byGroup.get(group.id)
    if (!list || used.has(group.id)) continue
    used.add(group.id)
    sections.push({ groupId: group.id, name: group.name, machines: list })
  }
  const rest = [...byGroup.keys()].filter((id) => id !== 0 && !used.has(id)).sort((a, b) => a - b)
  for (const id of rest) {
    const list = byGroup.get(id) as T[]
    sections.push({ groupId: id, name: list[0].machineGroupName || `Nhóm ${id}`, machines: list })
  }
  const unassigned = byGroup.get(0)
  if (unassigned) sections.push({ groupId: 0, name: 'Chưa gán nhóm', machines: unassigned })
  return sections
}
