import { apiPost } from './client'

export type PayRequestPayload = {
  staffId: number
  userId: number
  hostName: string
  idem: string
  paymentMethod: 'cash' | 'deduct' | 'guest'
  items: Array<{ detailId: number; quantity: number; amount: number }>
}

export async function payRequest(payload: PayRequestPayload) {
  return apiPost<{ paymentId: number; paid: number }, PayRequestPayload>(
    '/service/payrequest',
    payload,
  )
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
