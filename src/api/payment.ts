import { apiPost } from './client'

export type PayRequestPayload = {
  staffId: number
  userId: number
  hostName: string
  idem: string
  paymentMethod: 'cash' | 'deduct' | 'guest'
  items: Array<{ detailId: number; quantity: number; amount: number }>
  /**
   * task service-payrequest-core: nhánh opt-in của WebUI. BE tự làm việc phụ (VAT / FN2 / trừ ví / báo
   * máy trạm) và bắt buộc Bearer + `idem` ≤ 50 ký tự. Bỏ trống = hành vi cũ (Qt/MFC) — web luôn gửi true.
   */
  fullCore?: boolean
}

/**
 * Response `fullCore`. `paymentId`/`paid` giữ nguyên như bản cũ; phần còn lại additive.
 * ⚠️ `needsManualFix` / `deductApplied:false` đi kèm `status=1` (phiếu ĐÃ ghi) — KHÔNG phải lỗi HTTP,
 * FE phải tự kiểm cờ (KNOWLEDGE §47) chứ không coi "không ném lỗi" là đã trừ ví.
 */
export type PayRequestResponse = {
  paymentId?: number
  paid?: number
  fullCore?: boolean
  /** Tổng BE tính lại từ DB (không phải số FE gửi). */
  total?: number
  /** Cấn trừ: số đã ghi vào phiếu khi chạy `fcApplyDeduct`. */
  amount?: number
  duplicated?: boolean
  /** true = lần "Thử trừ ví lại" (trạng thái a) — KHÔNG đồng nghĩa duplicated. */
  retried?: boolean
  deductApplied?: boolean
  needsManualFix?: boolean
  /** deduct_failed (thử lại được) | deduct_incomplete (trừ dở — không tự chạy lại) | member_offline */
  code?: string
  step?: string
  logId?: number
  stampId?: number
  remainTime?: number
  walletMainAfter?: number
}

export async function payRequest(payload: PayRequestPayload) {
  return apiPost<PayRequestResponse, PayRequestPayload>('/service/payrequest', payload)
}

export type PayRequestDryRunPayload = Omit<PayRequestPayload, 'idem' | 'fullCore'>

/**
 * `dryRun`: BE chạy toàn bộ kiểm tra (quyền, FN2, online, kiểm dòng, nợ, số dư) và KHÔNG ghi gì.
 * Luôn `status=1` kể cả `ok:false` (đó là "báo cáo", không phải lỗi) — lỗi request (thiếu quyền 9224,
 * userId/items sai…) mới ném `ApiError`.
 */
export type PayRequestDryRunResponse = {
  ok: boolean
  dryRun?: boolean
  /** deduct_limited | member_offline | invalid_lines | deduct_check_failed */
  code?: string
  message?: string
  total?: number
  /** Chỉ có khi `deduct`. */
  walletMain?: number
  debit?: number
  minBalance?: number
  memberName?: string
  invalidIds?: number[]
}

export function payRequestDryRun(payload: PayRequestDryRunPayload) {
  const body = { ...payload, fullCore: true, dryRun: true }
  return apiPost<PayRequestDryRunResponse, typeof body>('/service/payrequest', body)
}

export type ComboSellLine = {
  comboId: number
  username: string
  password: string
  price: number
  fromDate: string
  fromTime: string
  toDate: string
  toTime: string
  zone: string
  comboType: number
  duration: number
  weekday: number
  exprDaycount: number
  idem: string
}

export type ComboSellPayload = {
  staffId: number
  paymentMethod: 'cash' | 'online'
  combos: ComboSellLine[]
}

export async function comboSell(payload: ComboSellPayload) {
  return apiPost<
    {
      sold: number
      results: Array<{
        comboId: number
        paymentId: number
        comboDetailId: number
        userId: number
        username: string
        password: string
        idem: string
      }>
    },
    ComboSellPayload
  >('/combo/sell', payload)
}

export type ServicePayPayload = {
  staffId: number
  paymentMethod: 'cash' | 'deduct'
  vouchers: Array<{
    voucherId: number
    detailIds: number[]
    idem: string
    hostName: string
  }>
}

export async function servicePay(payload: ServicePayPayload) {
  return apiPost<
    {
      processed: number
      results: Array<{ voucherId: number; paidVoucherId: number; amount: number }>
    },
    ServicePayPayload
  >('/service/pay', payload)
}

export type ClearAcceptedPayload = {
  staffId: number
  vouchers: Array<{ voucherId: number; detailIds: number[] }>
}

/**
 * Hủy món trên 1 phiếu ĐÃ DUYỆT (Accept=1) -- KHÁC `/service/cancel` (chỉ nhận đơn Accept=0 còn
 * chờ duyệt). Tự tính lại tiền còn lại trên phiếu; hết tiền thì xoá luôn phiếu (`voucherDeleted`).
 */
export async function clearAcceptedService(payload: ClearAcceptedPayload) {
  return apiPost<
    {
      processed: number
      results: Array<{
        voucherId: number
        cancelledAmount: number
        remain: number
        voucherDeleted: boolean
      }>
    },
    ClearAcceptedPayload
  >('/service/clearaccepted', payload)
}

export type ComboSellQrStartPayload = {
  staffId: number
  orderName?: string
  combos: ComboSellLine[]
}

export type ComboSellQrStartResponse = {
  orderId: string
  img: string
  bankUser: string
  bankAccount: string
  bankShortName: string
  bankName: string
  exprSec: number
  value: number
}

export function comboSellQrStart(payload: ComboSellQrStartPayload) {
  return apiPost<ComboSellQrStartResponse, ComboSellQrStartPayload>(
    '/combo/sell/qr/start',
    payload,
  )
}

export type ComboSellQrState =
  | 'pending'
  | 'processing'
  | 'done'
  | 'error'
  | 'failed'
  | 'expired'

export function comboSellQrStatus(orderId: string) {
  return apiPost<
    {
      state: ComboSellQrState
      results?: Array<{
        comboId: number
        paymentId: number
        comboDetailId: number
        userId: number
        username: string
        password: string
        idem: string
      }>
    },
    { orderId: string }
  >('/combo/sell/qr/status', { orderId })
}

export type RefundPaymentPayload = {
  voucherId: number
  method: 'cash' | 'online'
  idem: string
}

export async function refundPayment(payload: RefundPaymentPayload) {
  return apiPost<
    {
      refundId: number
      value: number
      remainTime: number
      loggedOut: boolean
    },
    RefundPaymentPayload
  >('/payment/refund', payload)
}
