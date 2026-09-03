import { apiGet, apiPost } from './client'

export type ComboMachineGroup = {
  machineGroupId: number
  name: string
  fromTime: number
  toTime: number
  usageState?: 'usable' | 'starts_later' | 'closed_today' | 'inactive'
  usableNow?: boolean
  nextUsableAtMs?: number | null
  nextTransitionAtMs?: number | null
}

export type ComboDonate = {
  serviceId: number
  name: string
  quantity: number
  unit: string
  provider: string
  product: string
  code: string
}

export type Combo = {
  comboId: number
  name: string
  price: number
  type: 1 | 2
  preAlias: string
  status: number
  order: number
  numOfDay: number
  weekday: number
  include: string
  duration: number
  saleFrom: string
  saleTo: string
  display: number
  salableNow: boolean
  usageMode?: 'fixed_window' | 'duration'
  machineGroups: ComboMachineGroup[]
  donates: ComboDonate[]
}

export type ComboCatalog = {
  serverTimeMs: number
  receivedAtMs: number
  items: Combo[]
}

export type ComboSavePayload = Omit<
  Combo,
  'salableNow' | 'usageMode' | 'machineGroups' | 'donates'
> & {
  staffId: number
  machineGroups: Array<{ machineGroupId: number; fromTime: number; toTime: number }>
  donates: Array<{ serviceId: number; quantity: number; provider: string; product: string; code: string }>
}

export type ComboSaleResult = {
  comboId: number
  userId: number
  paymentId: number
  comboDetailId: number
  idem: string
  username: string
  password: string
}

export type ComboSalePayload = {
  paymentMethod: 'cash' | 'online'
  combos: Array<{ comboId: number; quantity: number; idem: string }>
}

export type ComboQrStartResult = {
  orderId: string
  img: string
  bankUser: string
  bankAccount: string
  bankShortName: string
  bankName: string
  exprSec: number
  value: number
}

export type ComboQrStatusResult = {
  state: 'pending' | 'processing' | 'done' | 'error' | 'failed' | 'expired'
  results?: ComboSaleResult[]
}

export async function getComboCatalog(status: 'active' | 'all' = 'active') {
  const result = await apiGet<{ serverTimeMs: number; items: Combo[] }>(`/combos?status=${status}`)
  return { ...result, receivedAtMs: Date.now() } satisfies ComboCatalog
}

export function saveCombo(payload: ComboSavePayload) {
  return apiPost<{ comboId?: number }, ComboSavePayload>('/combo/save', payload)
}

export function deleteCombo(payload: { staffId: number; comboId: number }) {
  return apiPost<{ softDeleted?: boolean }, typeof payload>('/combo/delete', payload)
}

export function sellCombos(payload: ComboSalePayload) {
  return apiPost<{ results: ComboSaleResult[] }, ComboSalePayload>('/combo/sell', payload)
}

export function startComboQr(payload: Omit<ComboSalePayload, 'paymentMethod'> & { orderName: string }) {
  return apiPost<ComboQrStartResult, typeof payload>('/combo/sell/qr/start', payload)
}

export function getComboQrStatus(orderId: string) {
  return apiPost<ComboQrStatusResult, { orderId: string }>('/combo/sell/qr/status', { orderId })
}
