import { apiGet, apiPost, apiPut } from './client'

export type Workstation = {
  hostName: string
  ip: string
  status: number | string
  userId: number
  userGroupType: number
  machineGroupId: number
  flagMask: number
  version: string
  userName?: string
  comboName?: string
  startTime?: string
  usedTime?: string
  remainTime?: string
  totalAmount?: number
  machineGroupName?: string
  userGroupName?: string
  note?: string
}

export function getWorkstations() {
  return apiGet<Workstation[]>('/workstations')
}

// ---- task 2.23: snapshot runtime (GET /workstations/runtime) ----
// Mirror dung shape backend (WorkstationHandlers.cpp, WorkstationsRuntimeRequestHandler):
// thoi gian = GIAY (integer), tien = integer, field khong ap dung = null (KHONG phai 0).
// Field nao server LUON tra thi de required; chi `| null` cho field server co the tra null.
export type WorkstationRuntimeSession = {
  sessionId: number
  loginType: number
  prepaid: boolean
  /** "YYYY-MM-DD HH:MM:SS" theo gio server, hoac null khi khong xac dinh duoc */
  startedAt: string | null
  usedSeconds: number | null
  remainingSeconds: number | null
  /** ANONYM tra sau: tien tam tinh; MEMBER: max(moneyUsed, moneyUsedMin). ANONYM tra truoc = null */
  totalAmount: number | null
  /** chi MEMBER moi co so du; ANONYM = null */
  remainingMoney: number | null
  comboName: string | null
}

// Ban quyen Windows may tram. `null` ca nhanh = CHUA CO du lieu (client cu, co `hwm`
// tat, hoac Server.exe vua restart) -> UI de TRONG. KHAC HAN status 0 = may that su
// chua activate.
export type WorkstationWinLicense = {
  /** LicenseStatus cua WMI: 1=Licensed, 0=Unlicensed, 2/3/4/6=Grace, 5=Notification */
  status: number
  /** PartialProductKey - 5 ky tu cuoi, dung cai `slmgr /dlv` hien */
  pkey: string | null
  /** Retail / OEM:DM / Volume:GVLK ... */
  channel: string | null
  /** SO PHUT con lai, KHONG phai moc het han. Retail perpetual da activate = null */
  graceMinutes: number | null
}

export type WorkstationRuntime = {
  hostName: string
  ip: string
  status: number
  flagMask: number
  version: string
  machineGroupId: number
  machineGroupName: string | null
  /** INVALID_ID -> 0 (giu convention /workstations) */
  userId: number
  userName: string | null
  userGroupType: number
  note: string | null
  /** usertb.Status == 0 -> may bi khoa dang nhap ("Giu may") */
  lockLogin: boolean
  /** null khi may khong co phien (AVAILABLE/DISCONNECT) */
  session: WorkstationRuntimeSession | null
  /** null khi chua co du lieu ban quyen Windows */
  winLicense: WorkstationWinLicense | null
  updatedAtMs: number
}

export type WorkstationsRuntimeSnapshot = {
  /** moc neo de client noi suy dong ho tung giay (khong tang so request) */
  serverTimeMs: number
  items: WorkstationRuntime[]
}

export function getWorkstationsRuntime() {
  return apiGet<WorkstationsRuntimeSnapshot>('/workstations/runtime')
}

export function getOnlineWorkstations() {
  return apiGet<Workstation[]>('/workstations/online')
}

// ---- L4B Workstation Controls ----

export interface WsControlResult {
  hostName: string
  ok: boolean
  reason: string
  lockScreenSent?: boolean
}

export function updateWorkstationNote(data: { hostNames: string[], note?: string, lockLogin?: boolean, showLockScreen?: boolean }) {
  return apiPost<{results: WsControlResult[], fn1: boolean}, typeof data>('/workstations/note', data)
}

export function changeWorkstationGroup(data: { hostName: string, machineGroupId: number }) {
  return apiPost<void, typeof data>('/workstations/change-group', data)
}

export function bulkChangeWorkstationGroup(data: { hostNames: string[], machineGroupId: number }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/bulk-change-group', data)
}

export function logoutWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/logout', data)
}

export function restartWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/restart', data)
}

export function shutdownWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/shutdown', data)
}

export function hibernateWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/hibernate', data)
}

export function closeAppWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/close-app', data)
}

// ---- 2.44-B5: chat -- gui tin nhan tu quay xuong may tram (§11.1-IMPL) ----
export function sendWorkstationMessage(data: { hostNames: string[], message: string }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/message', data)
}

export function adminLoginWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/admin-login', data)
}

export function updateWorkstationsVersion(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/update', data)
}

export function getShutdownAll() {
  return apiGet<{mode: 'off'|'once'|'daily', at: number}>('/workstations/shutdown-all')
}

export function updateShutdownAll(data: {mode: 'off'|'once'|'daily', at?: number}) {
  return apiPut<{mode: 'off'|'once'|'daily', at: number, secondsUntil?: number}, typeof data>('/workstations/shutdown-all', data)
}

export function shutdownAllNow() {
  return apiPost<void, Record<string, never>>('/workstations/shutdown-all/now', {})
}

export function wakeupWorkstations(data: { hostNames: string[] }) {
  return apiPost<{results: WsControlResult[]}, typeof data>('/workstations/wakeup', data)
}

export function getSystemFunctions() {
  return apiGet<{items: {resourceId: number, status: 0|1, name: string}[]}>('/workstations/system-functions')
}

export function updateSystemFunctions(data: {items: {resourceId: number, status: 0|1}[]}) {
  return apiPut<{
    updated: number
    items: Array<{resourceId: number, status: 0|1, ok: boolean, reason: string}>
  }, typeof data>('/workstations/system-functions', data)
}

// ---- L5 Money-core Workstation ----

export function payoutWorkstation(payload: { machine: string, realAmount?: number, note?: string, idem: string }) {
  return apiPost<any, typeof payload>('/workstation/payout', payload)
}

export function payoutPrepaidWorkstation(payload: { machine: string, note?: string, idem: string }) {
  return apiPost<any, typeof payload>('/workstation/payout/prepaid', payload)
}

export function payDebitWorkstation(payload: { userId: number, machine: string, note?: string, idem: string }) {
  return apiPost<any, typeof payload>('/workstation/paydebit', payload)
}

export function changeWorkstationPc(payload: { oldMachine: string, newMachine: string, mode: 'change' | 'swap', idem: string }) {
  return apiPost<any, typeof payload>('/workstations/change-pc', payload)
}

export function changeSessionToPrepaid(payload: { machine: string, chargeTime?: number, chargeMoney?: number, idem: string }) {
  return apiPost<any, typeof payload>('/session/change-to-prepaid', payload)
}

// ---- L5B Payment-wait ----

export type PaymentWaitPayoutResult = {
  paymentWaitId: number
  ok: boolean
  message?: string
  duplicated?: boolean
  machineId?: number
  machineName?: string
  voucherId?: number
  realAmount?: number
  computedRealAmount?: number
  autoAmount?: number
  realTimeFee?: number
  totalTimeFee?: number
  totalTimeUsed?: number
  serviceFee?: number
  timeFeeDebit?: number
  serviceFeeDebit?: number
  edited?: boolean
  overridden?: boolean
}

export type PaymentWaitPayoutResponse = {
  okCount: number
  failCount: number
  duplicatedCount: number
  transferUserId: number
  totalCollected: number
  results: PaymentWaitPayoutResult[]
}

export function payoutPaymentWait(payload: {
  paymentWaitIds: number[]
  transferUserId?: number
  realAmount?: number
  idem: string
}) {
  return apiPost<PaymentWaitPayoutResponse, typeof payload>(
    '/workstation/payment-wait/payout',
    payload,
  )
}

export function continuePaymentWait(payload: {
  paymentWaitId: number
  newHostName: string
  idem: string
}) {
  return apiPost<Record<string, unknown>, typeof payload>(
    '/workstation/payment-wait/continue',
    payload,
  )
}

export function suspendWorkstation(payload: {
  hostName: string
  note?: string
  idem: string
}) {
  return apiPost<Record<string, unknown>, typeof payload>(
    '/workstation/payment-wait/suspend',
    payload,
  )
}
