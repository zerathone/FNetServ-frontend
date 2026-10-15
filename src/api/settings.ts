import { apiGet, apiPost, apiPut } from './client'

export interface CafeInfo {
  cafeName: string
  cafeAddress: string
  cafePhone: string
  cafePage: string
  cafeEmail: string
}

export interface RetentionSettings {
  systemLogDays: number
  voucherDays: number
  webDays: number
  backupDays: number
  serverLogRecords: number
  usingLogDays: number
  warningLogDays: number
}

export interface RoundingMoneySettings {
  roundingUnit: number
  roundingType: number
}

export const getCafeInfo = () => apiGet<CafeInfo>('/settings/cafeinfo')
export const updateCafeInfo = (data: Partial<CafeInfo>) => apiPost<void, Partial<CafeInfo>>('/settings/cafeinfo', data)

export const getRetentionSettings = () => apiGet<RetentionSettings>('/settings/retention')
export const updateRetentionSettings = (data: Partial<RetentionSettings>) => apiPost<void, Partial<RetentionSettings>>('/settings/retention', data)

export const getRoundingMoney = () => apiGet<RoundingMoneySettings>('/setting/roundingmoney')
export const updateRoundingMoney = (data: Partial<RoundingMoneySettings>) => apiPost<void, Partial<RoundingMoneySettings>>('/setting/roundingmoney', data)

export interface WorkstationGeneralSettings {
  autoRelogin: boolean
  lockScreenStation: boolean
  firstLoginChangePwd: boolean
  chatHistoryStatus: boolean
}

export const getWorkstationGeneral = () => apiGet<WorkstationGeneralSettings>('/settings/workstation-general')
export const updateWorkstationGeneral = (data: Partial<WorkstationGeneralSettings>) => apiPost<void, Partial<WorkstationGeneralSettings>>('/settings/workstation-general', data)

export interface ShutdownAvailablePcSettings {
  timeOffPcAvailable: number
}

export const getShutdownAvailablePc = () => apiGet<ShutdownAvailablePcSettings>('/settings/shutdown-available-pc')
export const updateShutdownAvailablePc = (data: Partial<ShutdownAvailablePcSettings>) => apiPost<void, Partial<ShutdownAvailablePcSettings>>('/settings/shutdown-available-pc', data)

export interface CloseAppAvailablePcSettings {
  minutes: number
}

export const getCloseAppAvailablePc = () =>
  apiGet<CloseAppAvailablePcSettings>('/settings/close-app-available-pc')
export const updateCloseAppAvailablePc = (data: CloseAppAvailablePcSettings) =>
  apiPost<void, CloseAppAvailablePcSettings>('/settings/close-app-available-pc', data)

export interface PriceMinAmountSettings {
  priceMin: number
  priceMinForMember: number
  showPriceMin: boolean
  giveBackMoneyOnline: boolean
  giveBackMoneyNotOnline: boolean
  chargeMemberWarning: boolean
  userDeductPriceMin: number
}

export const getPriceMinAmount = () => apiGet<PriceMinAmountSettings>('/setting/priceminamount')
export const updatePriceMinAmount = (data: Partial<PriceMinAmountSettings>) => apiPost<void, Partial<PriceMinAmountSettings>>('/setting/priceminamount', data)

export interface SettingOptionValue {
  value: string
  active: number
}

export interface SettingsOptionsResult {
  items: Record<string, SettingOptionValue>
  unknown: string[]
  denied: string[]
}

export const getSettingsOptions = (keys: string[] = []) => {
  const query = keys.length > 0
    ? `?keys=${encodeURIComponent(keys.join(','))}`
    : ''
  return apiGet<SettingsOptionsResult>(`/settings/options${query}`)
}

/**
 * Ghi dòng "Ghi chú" cố định của phiếu nạp tiền vào option 139 (parity hộp thoại cấu hình in phiếu của MFC).
 * Đã có cấu hình ⇒ chỉ đổi `note`. Chưa có ⇒ server tạo mới từ `printer` + `paperType` (bảng MFC: A4=0,
 * POS58=1, POS80=2) + `cafeInfo`. Máy chủ giới hạn `note` ≤ 40 ký tự.
 */
export const saveDepositReceiptNote = (payload: {
  note: string
  printer?: string
  paperType?: number
  cafeInfo?: boolean
}) => apiPut<void, typeof payload>('/settings/deposit-receipt-note', payload)
