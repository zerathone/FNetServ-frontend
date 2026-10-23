import type {
  OperationNotification,
  OperationNotificationSnapshot,
} from '../../api/notifications'

export function mergeNotificationEvent(
  snapshot: OperationNotificationSnapshot | undefined,
  notification: OperationNotification,
) {
  if (!snapshot) return snapshot
  const byId = new Map(snapshot.items.map((item) => [item.id, item]))
  byId.set(notification.id, notification)
  return {
    ...snapshot,
    seq: Math.max(snapshot.seq, notification.seq),
    items: [...byId.values()].sort((left, right) => left.seq - right.seq),
  }
}

// Task 6.6 (user chốt 2026-09-08): mấy `type` này là "đã xong rồi, đọc để biết" — KHÔNG phải
// việc cần làm ⇒ để ngoài tab "Cần xử lý". Lý do: `qr_payment_success` là loại tần suất cao
// nhất và mỗi đơn 1 bản ghi (dedupeKey theo `orderid` nên không gộp), nên ở tiệm đông **mỗi
// lần nạp tiền thành công lại đẩy thông báo LỖI TIỀN xuống dưới** — đúng thứ hộp thông báo
// sinh ra để bắt. Cùng luật với panel Qt (6.5): doc thiết kế §1 cũng bắt nó lọc
// `payment_recorded`. Cả 2 type vẫn hiện đủ ở tab "Tất cả".
//
// ⚠️ Đây chỉ là nửa HIỂN THỊ. Nửa còn lại — ring 1024 drop-oldest có thể đẩy thông báo lỗi ra
// khỏi RAM server — **không sửa được ở FE** (FE chỉ đọc được cái còn trong buffer); xem
// `PROGRESS.md` mục "🔎 Review 6.1 + 6.2" và `FNetHttp/NotificationStore.h`.
const INFORMATIONAL_TYPES = new Set(['payment_recorded', 'qr_payment_success'])

export function notificationNeedsAction(notification: OperationNotification) {
  if (notification.state === 'resolved') return false
  return !INFORMATIONAL_TYPES.has(notification.type)
}

// --- Timeline từ nhật ký hệ thống (`GET /logs/system`) -----------------------------------------
// KHÔNG dùng cho hộp thông báo (thông báo chỉ đọc /operations/notifications, user chốt
// 2026-10-23 để khỏi tăng tải truy vấn nhật ký). Chỉ dùng cho hộp thoại "Hoạt động gần đây" của
// máy trạm (features/workstations/MachineActivityDialog.tsx), gọi theo yêu cầu của người dùng.
export type TimelineTone = 'info' | 'attention' | 'urgent' | 'ok'

export type TimelineEvent = {
  id: string
  atMs: number
  label: string
  tone: TimelineTone
}

type SystemLogRow = {
  id: number
  machineName: string
  userName: string
  enterDate: string
  enterTime: string
  status: string
}

function logTone(status: string): TimelineTone {
  const s = status.toLowerCase()
  if (s.includes('mất kết nối') || s.includes('tắt')) return 'urgent'
  if (s.includes('cảnh báo')) return 'attention'
  if (s.includes('sẵn sàng')) return 'ok'
  return 'info'
}

// YYYY-MM-DD theo giờ địa phương (khớp `enterDate` Server ghi), không dùng toISOString (UTC).
export function toLocalDate(value: number) {
  const d = new Date(value)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// User chốt 2026-10-23: sự kiện nhật ký cách nhau trong 3-5 phút thì gom chung 1 card, xa hơn
// tách card ⇒ lấy 5 phút. (Chỉ cho hộp thoại "Hoạt động gần đây", không dùng cho hộp thông báo.)
export const ACTIVITY_GROUP_GAP_MS = 5 * 60_000

// `events` đã sắp cũ → mới. Hai sự kiện liền kề cách > GAP thì cắt thành 2 chuỗi (nối chuỗi,
// không so với mốc đầu ⇒ chuỗi mỗi sự kiện cách 4 phút vẫn là 1 card).
export function chainEvents(events: TimelineEvent[], gapMs = ACTIVITY_GROUP_GAP_MS) {
  const chains: TimelineEvent[][] = []
  for (const event of events) {
    const current = chains[chains.length - 1]
    if (current && event.atMs - current[current.length - 1].atMs <= gapMs) current.push(event)
    else chains.push([event])
  }
  return chains
}

// `enterDate`/`enterTime` là giờ địa phương của Server ("2026-10-23" + "15:38:16").
export function parseLogTime(enterDate: string, enterTime: string) {
  const ms = new Date(`${enterDate}T${enterTime}`).getTime()
  return Number.isFinite(ms) ? ms : null
}

// Server lọc tên máy kiểu LIKE '%PC01%' (trùng cả PC010) ⇒ lọc lại khớp tên tuyệt đối.
export function logEventsForHost(hostName: string, rows: SystemLogRow[]): TimelineEvent[] {
  const host = hostName.toLowerCase()
  const events: TimelineEvent[] = []
  for (const row of rows) {
    if (row.machineName.toLowerCase() !== host) continue
    const atMs = parseLogTime(row.enterDate, row.enterTime)
    if (atMs === null || !row.status) continue
    events.push({
      id: `log_${row.id}`,
      atMs,
      label: row.userName ? `${row.status} · ${row.userName}` : row.status,
      tone: logTone(row.status),
    })
  }
  return events.sort((left, right) => left.atMs - right.atMs || left.id.localeCompare(right.id))
}

export type NotificationSearchField = 'host' | 'user'

export function notificationMatchesSearch(
  notification: OperationNotification,
  field: NotificationSearchField,
  term: string,
) {
  const needle = term.trim().toLowerCase()
  if (!needle) return true
  const value = field === 'host' ? notification.hostName : notification.userName
  return (value ?? '').toLowerCase().includes(needle)
}

// --- Thông báo `qr_no_signal`: nút "Đã nhận được tiền" / "Hủy đơn" (cùng luật panel Qt, task 6.3/6.5b)
export const QR_ACTION_CONFIRM = 'qr_confirm_manual'
export const QR_ACTION_CANCEL = 'qr_cancel_order'

export type QrOrderMeta = {
  orderId: string
  pcname: string
  uname: string
  openedAt: string
  value: number
}

function metaString(meta: Record<string, unknown> | undefined, key: string) {
  const value = meta?.[key]
  return typeof value === 'string' ? value : ''
}

// `meta` do server sinh (PendingQrBook.cpp): orderid/pcname/uname/openedAt/lane/value/expSec.
// `value` là SỐ thô trong JSON; chỉ dùng để HIỂN THỊ cho thu ngân đối chiếu — số tiền ghi sổ
// do server tự lấy từ đơn.
export function qrOrderMeta(notification: OperationNotification): QrOrderMeta {
  const meta = notification.meta
  const rawValue = Number(meta?.value)
  return {
    orderId: metaString(meta, 'orderid'),
    pcname: metaString(meta, 'pcname'),
    uname: metaString(meta, 'uname'),
    openedAt: metaString(meta, 'openedAt'),
    value: Number.isFinite(rawValue) ? rawValue : 0,
  }
}

// `qr_manual_confirmed` là tín hiệu chắc chắn: server chỉ phát SAU KHI đã ghi tiền, nên thấy
// card này thì đơn đó đã xác nhận — kể cả do thu ngân khác hoặc panel Qt bấm.
export function handledQrOrders(items: OperationNotification[]) {
  const handled = new Map<string, string>()
  for (const item of items) {
    if (item.type !== 'qr_manual_confirmed') continue
    const orderId = metaString(item.meta, 'orderid')
    if (orderId) handled.set(orderId, 'Đơn này đã được xác nhận')
  }
  return handled
}

// Mã giao dịch ngân hàng: bắt buộc, tối đa 50 ký tự [A-Za-z0-9._-] (khớp isValidTid ở server).
export function isValidBankTid(tid: string) {
  return /^[A-Za-z0-9._-]{1,50}$/.test(tid)
}

export function notificationTarget(notification: OperationNotification) {
  switch (notification.type) {
    case 'service_request':
    // Khách rời máy còn nợ dịch vụ đã duyệt: tới đơn dịch vụ, và NotificationCenter tự lọc sẵn
    // theo máy nợ (xem openTarget).
    case 'service_debit':
      return '/orders'
    case 'payment_recorded':
    // Task 6.6: giao dịch ĐÃ được ghi ⇒ tra được ở nhật ký phiếu.
    case 'qr_payment_success':
    case 'qr_manual_confirmed':
      return '/logs/voucher'
    case 'client_message':
    case 'workstation_warning':
    case 'workstation_offline':
    // Task 6.6: chưa có phiếu để tra — việc cần làm là tới chỗ máy khách đang ngồi.
    case 'qr_payment_failed':
    case 'charge_request':
      return '/workstations'
    // `qr_no_signal` tự có nút xử lý riêng (xác nhận tiền / hủy đơn) ⇒ không có trang đích.
    case 'qr_no_signal':
      return null
    // `fnet_system` / `partner_notice` là tin đọc-để-biết, không có trang đích ⇒ null
    // (card vẫn hiện, chỉ không có nút "Mở chi tiết").
    default:
      return null
  }
}

export function notificationTitle(notification: OperationNotification) {
  // Task 6.6: server (6.2 trở đi) gửi `title` đã có sẵn máy · số tiền · tài khoản — thông tin
  // mà FE KHÔNG suy ra được từ `type`. Ưu tiên nó, và như vậy mọi `type` thêm về sau tự hiển
  // thị đúng mà không phải sửa file này nữa. Bảng dưới chỉ còn là fallback cho các `type` cũ
  // (2.26) và cho Server.exe bản cũ chưa có field `title`.
  const serverTitle = notification.title?.trim()
  if (serverTitle) return serverTitle

  switch (notification.type) {
    case 'client_message':
      return 'Khách gửi tin nhắn'
    case 'service_request':
      return 'Có yêu cầu dịch vụ'
    case 'workstation_warning':
      return 'Cảnh báo'
    case 'service_debit':
      return 'Khách rời máy còn nợ dịch vụ'
    case 'workstation_offline':
      return 'Máy trạm vừa ngắt kết nối'
    case 'payment_recorded':
      return 'Có giao dịch mới được ghi nhận'
    case 'qr_payment_failed':
      return 'Giao dịch QR bị lỗi'
    case 'qr_payment_success':
      return 'Nạp tiền QR thành công'
    case 'qr_no_signal':
      return 'Đơn QR không có tín hiệu về'
    case 'qr_manual_confirmed':
      return 'Giao dịch QR đã xác nhận thủ công'
    case 'charge_request':
      return 'Khách xin nạp tiền'
    case 'fnet_system':
      return 'Thông báo từ FNet'
    case 'partner_notice':
      return 'Thông báo từ đối tác'
    default:
      return ''
  }
}

// Loại FE không biết VÀ server không gửi `title` thì không có gì để nói với thu ngân — ẩn đi
// thay vì hiện chữ chung chung (user chốt 2026-10-23). Đồng bộ với bảng trong notificationTitle.
export function notificationIsDisplayable(notification: OperationNotification) {
  return notificationTitle(notification) !== ''
}

export function notificationDescription(notification: OperationNotification) {
  const repeated = notification.count > 1 ? ` · lặp ${notification.count} lần` : ''

  // Task 6.6: có `body` từ server thì dùng — đó là "lỗi ở bước nào", thứ duy nhất giúp thu
  // ngân xử lý mà không phải mở Sentry. Chỉ thêm tên máy khi `body` chưa nhắc tới nó.
  const serverBody = notification.body?.trim()
  if (serverBody) {
    const host =
      notification.hostName && !serverBody.includes(notification.hostName)
        ? ` · ${notification.hostName}`
        : ''
    return `${serverBody}${host}${repeated}`
  }

  const target = notification.hostName ? ` tại ${notification.hostName}` : ''
  return `${notificationTitle(notification)}${target}${repeated}`
}
