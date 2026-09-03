import { apiPostForm, apiPut } from './client'
import { getSettingsOptions } from './settings'
import { toDataURL } from 'qrcode'

export type DepositMoneyUnitSettings = {
  units: number[]
  allowWorkstationCustomAmount: boolean
}

export type UpdateDepositMoneyUnitSettings = {
  units: number[]
  allowWorkstationCustomAmount: boolean
}

export const getDepositMoneyUnitSettings = async () => {
  const result = await getSettingsOptions(['deposit_money_units'])
  const option = result.items.deposit_money_units
  if (!option) {
    const reason = result.denied.includes('deposit_money_units')
      ? 'Máy chủ từ chối đọc bảng mệnh giá.'
      : 'Máy chủ chưa đăng ký cấu hình bảng mệnh giá.'
    throw new Error(reason)
  }

  const parts = option.value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const units = parts.map(Number)

  if (
    units.length === 0 ||
    units.length > 12 ||
    units.some((unit) => !Number.isSafeInteger(unit) || unit <= 0)
  ) {
    throw new Error('Bảng mệnh giá trên máy chủ không hợp lệ (cần 1–12 số nguyên dương).')
  }

  return {
    units,
    allowWorkstationCustomAmount: option.active !== 2,
  } satisfies DepositMoneyUnitSettings
}

export const updateDepositMoneyUnitSettings = (
  data: UpdateDepositMoneyUnitSettings,
) =>
  apiPut<void, UpdateDepositMoneyUnitSettings>(
    '/settings/deposit-money-units',
    data,
  )

export type DepositQrState =
  | 'pending'
  | 'processing'
  | 'done'
  | 'failed'
  | 'expired'
  | 'cancelled'
  | 'sent_to_workstation'

export type DepositQrStartPayload = {
  userId: number
  chargeMoney: number
  idem: string
}

export type DepositQrStartResult = {
  orderId?: string
  state: DepositQrState
  presentation: 'counter' | 'workstation'
  hostName?: string
  qrImageDataUrl?: string
  bankUser?: string
  bankAccount?: string
  bankShortName?: string
  bankName?: string
  value?: number
  expiresInSeconds?: number
}

export type DepositQrStatusResult = {
  state: DepositQrState
}

type DepositQrStartApiResult = {
  presentation: 'counter' | 'workstation'
  hostname?: string
  orderid?: string
  img?: string
  bank_user?: string
  bank_account?: string
  bank_shortname?: string
  bank_name?: string
  exp_sec?: number
  value?: number
}

type DepositQrStatusApiResult = {
  state: 'pending' | 'processing' | 'done' | 'failed' | 'expired' | 'cancelled'
}

function safePngDataUrl(value: string | undefined) {
  const raw = value?.trim() ?? ''
  const prefix = 'data:image/png;base64,'
  const payload = raw.startsWith(prefix) ? raw.slice(prefix.length) : raw
  if (!payload.startsWith('iVBORw0KGgo') || !/^[A-Za-z0-9+/]+={0,2}$/.test(payload)) {
    return undefined
  }
  return `${prefix}${payload}`
}

function isVietQrPayload(value: string) {
  return /^000201[\x20-\x7E]{20,2048}6304[0-9A-F]{4}$/.test(value)
}

async function toQrImageDataUrl(value: string | undefined) {
  const pngDataUrl = safePngDataUrl(value)
  if (pngDataUrl) return pngDataUrl

  const payload = value?.trim() ?? ''
  if (!isVietQrPayload(payload)) return undefined

  return toDataURL(payload, {
    errorCorrectionLevel: 'M',
    margin: 1,
    width: 320,
  })
}

export const cancelDepositQr = async () => {
  const result = await apiPostForm<DepositQrStatusApiResult>('/pyqr', { m: 22 })
  return result satisfies DepositQrStatusResult
}

export const startDepositQr = async (data: DepositQrStartPayload) => {
  const result = await apiPostForm<DepositQrStartApiResult>('/pyqr', {
    m: 20,
    uid: data.userId,
    value: data.chargeMoney,
    idem: data.idem,
  })

  if (result.presentation === 'workstation') {
    return {
      presentation: 'workstation',
      hostName: result.hostname,
      state: 'sent_to_workstation',
    } satisfies DepositQrStartResult
  }

  if (!result.orderid) {
    throw new Error('Máy chủ không trả mã giao dịch QR.')
  }

  const qrImageDataUrl = await toQrImageDataUrl(result.img)
  if (!qrImageDataUrl) {
    try {
      await cancelDepositQr()
    } catch (error) {
      const reason = error instanceof Error ? ` (${error.message})` : ''
      throw new Error(`Máy chủ không trả ảnh QR hợp lệ và không dừng được phiên chờ${reason}.`)
    }
    throw new Error('Máy chủ không trả ảnh QR hợp lệ. Phiên chờ đã được dừng; hãy tạo lại mã QR.')
  }

  return {
    presentation: 'counter',
    orderId: result.orderid,
    state: 'pending',
    qrImageDataUrl,
    bankUser: result.bank_user,
    bankAccount: result.bank_account,
    bankShortName: result.bank_shortname,
    bankName: result.bank_name,
    value: result.value,
    expiresInSeconds: result.exp_sec,
  } satisfies DepositQrStartResult
}

export const getDepositQrStatus = async (orderId: string) => {
  const result = await apiPostForm<DepositQrStatusApiResult>('/pyqr', {
    m: 21,
    orderid: orderId,
  })
  return result satisfies DepositQrStatusResult
}
