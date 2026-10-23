import type { VoucherLog } from '../../api/logs.ts'
import { PAYMENT_TYPES } from './transactionModel.ts'

// Giao dịch KHÁCH TỰ THANH TOÁN (QR / FZone / chuyển khoản online) -- không phải thu ngân bấm thu. Dùng để
// báo nhanh ở mục "Giao dịch" của menu trái khi có tiền vào (useSelfPaymentFlash).

export type SelfPaymentKind = 'deposit' | 'combo' | 'service' | 'booking'

export const SELF_PAYMENT_LABEL: Record<SelfPaymentKind, string> = {
  deposit: 'Nạp tiền',
  combo: 'Bán combo',
  service: 'Dịch vụ',
  booking: 'Đặt máy',
}

/** Tiền tố số phiếu của phiếu nạp QR đặt máy (FzoneDeposit.h BOOKING_VOUCHER_PREFIX) -- cùng PaymentType với nạp ví. */
export const BOOKING_VOUCHER_PREFIX = 'fzbook_'

/** Hiện thông báo 1 phút; có tín hiệu mới trong lúc đó thì thay bằng tín hiệu mới (hiện lại đủ 1 phút). */
export const SELF_PAYMENT_FLASH_MS = 60_000

/**
 * Phân loại 1 phiếu: null = không phải giao dịch tự thanh toán (tiền mặt, cấn trừ, hoàn tiền...).
 *   - nạp ví 20 (online) / 26 (QR): phiếu có số "fzbook_..." là nạp cho đơn đặt máy, còn lại là nạp tiền;
 *   - combo 23 (online) / 25 (QR); dịch vụ 27 (online) / 28 (QR).
 */
export function classifySelfPayment(voucher: Pick<VoucherLog, 'paymentType' | 'voucherNo'>): SelfPaymentKind | null {
  switch (voucher.paymentType) {
    case PAYMENT_TYPES.MEMBER_RECHARGE_ONLINE:
    case PAYMENT_TYPES.MEMBER_RECHARGE_QR:
      return (voucher.voucherNo ?? '').startsWith(BOOKING_VOUCHER_PREFIX) ? 'booking' : 'deposit'
    case PAYMENT_TYPES.COMBO_ONLINE:
    case PAYMENT_TYPES.COMBO_QR:
      return 'combo'
    case PAYMENT_TYPES.SERVICE_ONLINE:
    case PAYMENT_TYPES.SERVICE_QR:
      return 'service'
    default:
      return null
  }
}

export type SelfPaymentHit = { kind: SelfPaymentKind; amount: number; voucherId: number }

/**
 * Từ danh sách phiếu mới tải về, lấy giao dịch tự thanh toán MỚI NHẤT có voucherId > baseline.
 * Trả thêm `maxId` (kể cả phiếu không thuộc loại này) để cập nhật mốc, lần sau không xét lại.
 */
export function pickLatestSelfPayment(
  items: VoucherLog[],
  baseline: number,
): { hit: SelfPaymentHit | null; maxId: number } {
  let maxId = baseline
  let hit: SelfPaymentHit | null = null
  for (const voucher of items) {
    if (voucher.voucherId > maxId) maxId = voucher.voucherId
    if (voucher.voucherId <= baseline) continue
    const kind = classifySelfPayment(voucher)
    if (!kind) continue
    if (!hit || voucher.voucherId > hit.voucherId) {
      hit = { kind, amount: Math.abs(voucher.amount), voucherId: voucher.voucherId }
    }
  }
  return { hit, maxId }
}

export function formatSelfPaymentAmount(amount: number) {
  return `${new Intl.NumberFormat('vi-VN').format(amount)}đ`
}
