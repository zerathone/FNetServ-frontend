import type {
  OperationNotification,
  OperationNotificationSeverity,
} from '../../api/notifications'

// Thiết lập thông báo — CHỈ ảnh hưởng thông báo nổi (toast) + âm báo trên trình duyệt này.
// Mọi thông báo vẫn nằm đủ trong hộp thông báo (chuông) bất kể công tắc nào: đó là nơi thu ngân
// lần lại việc còn treo, tắt toast không được làm mất dấu một thông báo tiền.
//
// File thuần (không import react/zustand) để `node --test` chạy được — xem
// tests/notification-prefs-model.test.ts.

export type NotificationTypeDef = {
  type: string
  label: string
  hint: string
  /** Mức server có thể gửi cho loại này (xem NotificationBridge / PaymentManager / OnlineBookService). */
  severities: OperationNotificationSeverity[]
}

export type NotificationGroupDef = {
  id: string
  label: string
  hint: string
  types: NotificationTypeDef[]
}

export const NOTIFICATION_GROUPS: NotificationGroupDef[] = [
  {
    id: 'payment',
    label: 'Thanh toán & tiền',
    hint: 'Nạp QR, giao dịch ghi sổ, khách nợ, xin nạp tiền',
    types: [
      { type: 'qr_payment_failed', label: 'Giao dịch QR bị lỗi', hint: 'Tín hiệu QR về nhưng xử lý lỗi — có thể đã ghi một phần', severities: ['urgent', 'critical'] },
      { type: 'qr_no_signal', label: 'Đơn QR không có tín hiệu về', hint: 'Đơn QR quá hạn mà cổng thanh toán chưa báo', severities: ['attention'] },
      { type: 'service_debit', label: 'Khách rời máy còn nợ dịch vụ', hint: 'Dịch vụ đã duyệt nhưng chưa thu tiền', severities: ['urgent'] },
      { type: 'charge_request', label: 'Khách xin nạp tiền', hint: 'Khách bấm xin nạp tiền từ máy trạm', severities: ['attention'] },
      { type: 'qr_payment_success', label: 'Nạp QR thành công', hint: 'Tần suất cao — thường nên tắt', severities: ['info'] },
      { type: 'qr_manual_confirmed', label: 'QR xác nhận thủ công', hint: 'Thu ngân đã xác nhận nhận tiền bằng tay', severities: ['info'] },
      { type: 'payment_recorded', label: 'Có giao dịch mới được ghi sổ', hint: 'Tin gộp mọi giao dịch ghi phiếu, kể cả tiền mặt', severities: ['info'] },
    ],
  },
  {
    id: 'workstation',
    label: 'Máy trạm & khách',
    hint: 'Cảnh báo máy, mất kết nối, tin nhắn từ khách',
    types: [
      { type: 'workstation_warning', label: 'Cảnh báo', hint: 'Máy trạm gửi cảnh báo', severities: ['urgent'] },
      { type: 'client_message', label: 'Khách gửi tin nhắn', hint: 'Tin nhắn từ máy trạm', severities: ['attention'] },
      { type: 'workstation_offline', label: 'Máy trạm ngắt kết nối', hint: 'Máy vừa tắt, cần dọn chỗ ngồi', severities: ['info'] },
    ],
  },
  {
    id: 'order',
    label: 'Đơn dịch vụ',
    hint: 'Yêu cầu dịch vụ từ máy trạm',
    types: [
      { type: 'service_request', label: 'Có yêu cầu dịch vụ', hint: 'Đơn dịch vụ mới đang chờ duyệt', severities: ['attention'] },
    ],
  },
  {
    id: 'booking',
    label: 'Đặt máy online',
    hint: 'Đơn đặt máy, đặt hộ, đối soát tiền đặt máy',
    types: [
      { type: 'online_booking_money_anomaly', label: 'Bất thường tiền đặt máy', hint: 'Cần đối soát ví hội viên và phiếu trừ', severities: ['urgent'] },
      { type: 'online_booking_deposit_kept', label: 'Đặt máy QR không hoàn tất', hint: 'Tiền nạp đang nằm trong ví hội viên', severities: ['urgent'] },
      { type: 'online_booking_wait_approval', label: 'Đơn đặt máy chờ duyệt', hint: 'Cần thu ngân duyệt hoặc huỷ', severities: ['attention'] },
      { type: 'online_booking_notify_failed', label: 'Không gửi được kết quả cho iCafe', hint: 'Kết quả đặt máy chưa tới đối tác', severities: ['attention'] },
      { type: 'online_booking_member_mismatch', label: 'Đặt hộ nhập sai hội viên nhiều lần', hint: 'Có thể là gõ nhầm hoặc dò tài khoản', severities: ['attention'] },
      { type: 'online_booking_confirmed', label: 'Đơn đặt máy đã xác nhận', hint: 'Đọc để biết', severities: ['info'] },
      { type: 'online_booking_cancelled', label: 'Đơn đặt máy đã huỷ', hint: 'Đọc để biết', severities: ['info'] },
    ],
  },
  {
    id: 'system',
    label: 'Đối tác',
    hint: 'Tin do đối tác gửi vào',
    types: [
      // `fnet_system` (bảo trì, license sắp hết) CỐ Ý chưa có ở đây: server chưa có nơi nào phát loại
      // này (kiểm 2026-10-22). Thêm lại cùng lúc với nguồn phát để công tắc không đứng không.
      { type: 'partner_notice', label: 'Thông báo từ đối tác', hint: 'Đối tác tự chọn mức khi gửi', severities: ['info', 'attention', 'urgent', 'critical'] },
    ],
  },
]

export type NotificationPrefs = {
  /** Công tắc tổng — tắt thì không còn toast/âm báo (trừ mức nghiêm trọng). */
  enabled: boolean
  /** Phát âm báo cho tin từ mức "cần để ý" trở lên. Mặc định TẮT để không đổi hành vi máy đang chạy. */
  sound: boolean
  /** Công tắc nhóm. Khoá vắng mặt = bật. */
  groups: Record<string, boolean>
  /** Công tắc từng loại. Khoá vắng mặt = bật (loại mới server thêm sau tự được hiện). */
  types: Record<string, boolean>
}

export const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  enabled: true,
  sound: false,
  groups: {},
  types: {},
}

export function groupOfType(type: string) {
  return NOTIFICATION_GROUPS.find((group) => group.types.some((item) => item.type === type))
}

export function isGroupOn(prefs: NotificationPrefs, groupId: string) {
  return prefs.groups[groupId] !== false
}

export function isTypeOn(prefs: NotificationPrefs, type: string) {
  return prefs.types[type] !== false
}

export function groupSummary(prefs: NotificationPrefs, group: NotificationGroupDef) {
  const on = group.types.filter((item) => isTypeOn(prefs, item.type)).length
  return { on, total: group.types.length }
}

/**
 * Luật duy nhất cho toast VÀ âm báo: master && nhóm && loại.
 * `critical` (mất tiền / đã ghi một phần) LUÔN báo — công tắc không tắt được, vì đây đúng là thứ
 * hộp thông báo sinh ra để bắt. Loại chưa có trong catalog chỉ phụ thuộc công tắc tổng.
 */
export function shouldAlert(prefs: NotificationPrefs, notification: OperationNotification) {
  if (notification.severity === 'critical') return true
  if (!prefs.enabled) return false
  const group = groupOfType(notification.type)
  if (group && !isGroupOn(prefs, group.id)) return false
  return isTypeOn(prefs, notification.type)
}

export function shouldPlaySound(prefs: NotificationPrefs, notification: OperationNotification) {
  if (!prefs.sound) return false
  if (notification.severity === 'info') return false
  return shouldAlert(prefs, notification)
}

export const SEVERITY_LABEL: Record<OperationNotificationSeverity, string> = {
  info: 'Thông tin',
  attention: 'Cần để ý',
  urgent: 'Khẩn',
  critical: 'Nghiêm trọng',
}

export function severityBadgeTone(severity: OperationNotificationSeverity) {
  if (severity === 'critical' || severity === 'urgent') return 'danger' as const
  if (severity === 'attention') return 'warning' as const
  return 'info' as const
}
