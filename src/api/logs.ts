import { apiGet, apiPost } from './client'

export interface SystemLog {
  id: number
  machineName: string
  userId: number
  userName: string
  enterDate: string
  enterTime: string
  status: string
  timeUsed: number
  note: string
}

export interface ServerLog {
  id: number
  status: string
  recordDate: string
  recordTime: string
  note: string
}

export interface WebHistoryLog {
  id: number
  machine: string
  url: string
  recordDate: string
  userId: number
  userName: string
  anonymousId: number
}

export interface VoucherLog {
  voucherId: number
  userId: number
  userName?: string
  voucherNo: string
  voucherDate: string
  voucherTime: string
  amount: number
  autoAmount: number
  paymentType: number
  servicePaid: number
  staffId: number
  staffName?: string
  machineName: string
  note: string
}

export interface VoucherDetailLog {
  serviceDetailId: number
  serviceName: string
  serviceDate: string
  serviceTime: string
  quantity: number
  amount: number
}

export interface VoucherTransferLog {
  id: number
  fromUserId: number
  fromUserName: string
  toUserId: number
  toUserName: string
  transferDate: string
  transferTime: string
}

export interface VoucherChangePCLog {
  id: number
  machineName: string
  beginDateTime: string
  changePCDate: string
  changePCTime: string
  timeUsed: number
  moneyUsed: number
  logType: number
  note: string
}

export interface PagedResult<T> {
  total: number
  items: T[]
  viewAllVoucher?: boolean
}

// APIs
export const getSystemLogs = (from: string, to: string, limit: number = 200, offset: number = 0, filterType?: number, filterText?: string) => {
  let url = `/logs/system?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
  if (filterType !== undefined && filterText) {
    url += `&filterType=${filterType}&filterText=${encodeURIComponent(filterText)}`;
  }
  return apiGet<PagedResult<SystemLog>>(url);
}

export const getServerLogs = (from: string, to: string, limit: number = 200, offset: number = 0, filterType?: number, filterText?: string) => {
  let url = `/logs/server?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
  if (filterType !== undefined && filterText) {
    url += `&filterType=${filterType}&filterText=${encodeURIComponent(filterText)}`;
  }
  return apiGet<ServerLog[]>(url);
}

export const getWebHistoryLogs = (from: string, to: string, limit: number = 200, offset: number = 0, filterType?: number, filterText?: string) => {
  let url = `/logs/webhistory?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
  if (filterType !== undefined && filterText) {
    url += `&filterType=${filterType}&filterText=${encodeURIComponent(filterText)}`;
  }
  return apiGet<PagedResult<WebHistoryLog>>(url);
}

// Server returns { total, items, viewAllVoucher } but we only care about PagedResult
export const getVoucherLogs = (from: string, to: string, limit: number = 200, offset: number = 0, filterType?: number, filterText?: string) => {
  let url = `/logs/voucher?from=${from}&to=${to}&limit=${limit}&offset=${offset}`;
  if (filterType !== undefined && filterText) {
    url += `&filterType=${filterType}&filterText=${encodeURIComponent(filterText)}`;
  }
  return apiGet<PagedResult<VoucherLog>>(url);
}

export const getVoucherDetailLogs = (voucherId: number) =>
  apiGet<VoucherDetailLog[]>(
    `/logs/voucher/detail?voucherId=${encodeURIComponent(voucherId)}`,
  )

export const getTransferLogs = (voucherId: number) =>
  apiGet<VoucherTransferLog[]>(
    `/logs/voucher/transfer?voucherId=${encodeURIComponent(voucherId)}`,
  )

export const getChangePCLogs = (voucherId: number) =>
  apiGet<{ items: VoucherChangePCLog[]; sumMoneyUsed: number }>(
    `/logs/voucher/changepc?voucherId=${encodeURIComponent(voucherId)}`,
  )

export type PaymentWaitLog = {
  id: number
  machineName: string
  beginTime: string
  endTime: string
  totalTimeUsed: number
  totalTimeFee: number
  timeFee: number
  timeUsed: number
  remainTime: number
  timePaid: number
  freeTime: number
  note: string
}

export const getPaymentWaitLogs = () =>
  apiGet<PaymentWaitLog[]>('/logs/paymentwait')

// Truncate APIs
export const truncateSystemLogs = () => apiPost<any, any>('/logs/system/truncate', {})
export const truncateServerLogs = () => apiPost<any, any>('/logs/server/truncate', {})
export const truncateWebHistoryLogs = () => apiPost<any, any>('/logs/webhistory/truncate', {})
export const truncateVoucherLogs = () => apiPost<any, any>('/logs/voucher/truncate', {})
