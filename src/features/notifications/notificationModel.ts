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

export function notificationTarget(notification: OperationNotification) {
  switch (notification.type) {
    case 'service_request':
      return '/orders'
    case 'payment_recorded':
      return '/logs/voucher'
    case 'client_message':
    case 'workstation_warning':
    case 'workstation_offline':
      return '/workstations'
    default:
      return null
  }
}

export function notificationTitle(notification: OperationNotification) {
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
    default:
      return 'Có cập nhật vận hành mới'
  }
}

export function notificationDescription(notification: OperationNotification) {
  const target = notification.hostName ? ` tại ${notification.hostName}` : ''
  const repeated = notification.count > 1 ? ` · lặp ${notification.count} lần` : ''
  return `${notificationTitle(notification)}${target}${repeated}`
}
