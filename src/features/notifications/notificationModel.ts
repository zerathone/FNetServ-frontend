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

export function notificationTarget(notification: OperationNotification) {
  switch (notification.type) {
    case 'service_request':
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
    case 'qr_no_signal':
    case 'charge_request':
      return '/workstations'
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
      return 'Máy trạm cần chú ý'
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
      return 'Có cập nhật vận hành mới'
  }
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
