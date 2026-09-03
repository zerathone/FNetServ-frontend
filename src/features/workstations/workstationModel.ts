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
      return { label: 'Đang chơi', tone: 'info' }
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

export function getWorkstationFlags(machine: WorkstationRuntime) {
  const flags: Array<{ label: string; tone: StatusTone }> = []
  if (machine.flagMask & WORKSTATION_FLAGS.HAVE_NOT_PAID) {
    flags.push({ label: 'Còn nợ', tone: 'danger' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.SERVICE_ORDER) {
    flags.push({ label: 'Có gọi món', tone: 'warning' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.SERVICE_ACCEPT) {
    flags.push({ label: 'Đã nhận món', tone: 'info' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.TRANSFER_PAYMENT) {
    flags.push({ label: 'Đợi chuyển phí', tone: 'warning' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.CLIENT_PAUSE) {
    flags.push({ label: 'Tạm dừng', tone: 'neutral' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.CHANGING_PC) {
    flags.push({ label: 'Đang chuyển máy', tone: 'info' })
  }
  if (machine.flagMask & WORKSTATION_FLAGS.USER_UNDER18) {
    flags.push({ label: 'Dưới 18 tuổi', tone: 'warning' })
  }
  return flags
}

export function isConnected(machine: WorkstationRuntime) {
  return machine.status !== WORKSTATION_STATUS.DISCONNECT
}

export function hasDebt(machine: WorkstationRuntime) {
  return Boolean(machine.flagMask & WORKSTATION_FLAGS.HAVE_NOT_PAID)
}

export function matchesWorkstationFilter(
  machine: WorkstationRuntime,
  filter: WorkstationFilter,
) {
  if (filter === 'debt') return hasDebt(machine)
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

export function formatDuration(seconds: number | null | undefined) {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—'
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return [hours, minutes, remainder].map((value) => String(value).padStart(2, '0')).join(':')
}

export function formatMoney(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

export function formatStartedAt(value: string | null | undefined) {
  if (!value) return '—'
  const [, time] = value.split(' ')
  return time || value
}

export function sessionLabel(session: WorkstationRuntimeSession | null) {
  if (!session) return 'Không có phiên'
  if (session.prepaid) return 'Trả trước'
  return session.loginType === 0 ? 'Vãng lai trả sau' : 'Hội viên'
}
