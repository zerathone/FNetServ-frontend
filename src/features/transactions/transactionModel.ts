import type { VoucherLog } from '../../api/logs.ts'

export const PAYMENT_TYPES = {
  GUEST_SERVICE: 1,
  SERVICE_CASH: 2,
  SERVICE_DEDUCT: 3,
  TIME_FEE: 4,
  TRANSFER_SERVICE: 9,
  TRANSFER_FEE: 10,
  SERVICE_DONATE: 18,
  MEMBER_RECHARGE_ONLINE: 20,
  COMBO_ONLINE: 23,
  COMBO_QR: 25,
  MEMBER_RECHARGE_QR: 26,
  SERVICE_ONLINE: 27,
  SERVICE_QR: 28,
  REFUND_CASH: 33,
  REFUND_ONLINE: 34,
  REFUND_SERVICE_CASH: 36,
  REFUND_SERVICE_ONLINE: 37,
} as const

const SERVICE_PAID_CANCELED = 3

export function paymentTypeLabel(type: number) {
  switch (type) {
    case PAYMENT_TYPES.GUEST_SERVICE:
      return 'Dịch vụ khách tại quầy'
    case PAYMENT_TYPES.SERVICE_CASH:
      return 'Dịch vụ tiền mặt'
    case PAYMENT_TYPES.SERVICE_DEDUCT:
      return 'Cấn trừ dịch vụ'
    case PAYMENT_TYPES.TIME_FEE:
      return 'Thời gian sử dụng'
    case PAYMENT_TYPES.TRANSFER_SERVICE:
      return 'Chuyển phí dịch vụ'
    case PAYMENT_TYPES.TRANSFER_FEE:
      return 'Chuyển phí thời gian'
    case PAYMENT_TYPES.SERVICE_DONATE:
      return 'Dịch vụ tặng kèm'
    case PAYMENT_TYPES.MEMBER_RECHARGE_ONLINE:
      return 'Nạp hội viên online'
    case PAYMENT_TYPES.COMBO_ONLINE:
      return 'Bán combo online'
    case PAYMENT_TYPES.COMBO_QR:
      return 'Bán combo QR'
    case PAYMENT_TYPES.MEMBER_RECHARGE_QR:
      return 'Nạp hội viên QR'
    case PAYMENT_TYPES.SERVICE_ONLINE:
      return 'Dịch vụ online'
    case PAYMENT_TYPES.SERVICE_QR:
      return 'Dịch vụ QR'
    case PAYMENT_TYPES.REFUND_CASH:
    case PAYMENT_TYPES.REFUND_SERVICE_CASH:
      return 'Hoàn tiền mặt'
    case PAYMENT_TYPES.REFUND_ONLINE:
    case PAYMENT_TYPES.REFUND_SERVICE_ONLINE:
      return 'Hoàn online'
    default:
      return `Loại giao dịch ${type}`
  }
}

export function hasServiceDetails(type: number) {
  return [
    PAYMENT_TYPES.GUEST_SERVICE,
    PAYMENT_TYPES.SERVICE_CASH,
    PAYMENT_TYPES.SERVICE_DEDUCT,
    PAYMENT_TYPES.TRANSFER_SERVICE,
    PAYMENT_TYPES.SERVICE_DONATE,
  ].includes(type as never)
}

export function hasTransferDetails(type: number) {
  return type === PAYMENT_TYPES.TRANSFER_SERVICE || type === PAYMENT_TYPES.TRANSFER_FEE
}

export function mayHaveChangePCDetails(type: number) {
  return type === PAYMENT_TYPES.TIME_FEE || type === PAYMENT_TYPES.TRANSFER_FEE
}

export function isVoucherRefundable(voucher: VoucherLog) {
  if (voucher.amount <= 0 || voucher.voucherNo === 'recall') return false
  return (
    voucher.paymentType === PAYMENT_TYPES.TIME_FEE ||
    voucher.paymentType === PAYMENT_TYPES.MEMBER_RECHARGE_ONLINE ||
    voucher.paymentType === PAYMENT_TYPES.MEMBER_RECHARGE_QR ||
    (voucher.paymentType === PAYMENT_TYPES.SERVICE_QR &&
      voucher.servicePaid === SERVICE_PAID_CANCELED)
  )
}
