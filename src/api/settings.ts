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

/**
 * Hình thức thanh toán combo trên máy trạm (`/settings/combo-payment`, option -10006 dạng bitmask).
 * `fn1 = false` ⇒ license chưa bật FN1: máy chủ luôn cho máy trạm hiện đủ 3 hình thức, cấu hình lưu được nhưng chưa có hiệu lực.
 * `locked` ⇒ giá trị âm trong DB (khóa hết) — chỉ cấu hình tay; lưu lại ở đây sẽ gỡ khóa.
 */
export interface ComboPaymentSettings {
  qr: boolean
  cash: boolean
  deduct: boolean
  locked: boolean
  fn1: boolean
}

export const getComboPaymentSettings = () => apiGet<ComboPaymentSettings>('/settings/combo-payment')
/** Chỉ ADMIN. Phải bật ít nhất một hình thức. */
export const updateComboPaymentSettings = (data: Pick<ComboPaymentSettings, 'qr' | 'cash' | 'deduct'>) =>
  apiPut<void, Pick<ComboPaymentSettings, 'qr' | 'cash' | 'deduct'>>('/settings/combo-payment', data)

/**
 * Hình thức thanh toán MENU ORDER (dịch vụ) trên máy trạm (`/settings/service-payment`, option -2005 'services' của iCafe,
 * cùng bitmask với combo). Chưa có dòng cấu hình hoặc giá trị sai ⇒ máy chủ trả mặc định CHỈ Tiền mặt, `isDefault = true`.
 * Menu do iCafe hiển thị nên chỉ có hiệu lực với iCafe 2.1.88 trở lên; FNet không chặn ở `/order`.
 * `raw` = giá trị gốc trong DB (để soi khi `isDefault` mà DB có giá trị lạ).
 */
export interface ServicePaymentSettings {
  qr: boolean
  cash: boolean
  deduct: boolean
  isDefault: boolean
  raw: string
}

export const getServicePaymentSettings = () => apiGet<ServicePaymentSettings>('/settings/service-payment')
/** Chỉ ADMIN. Phải bật ít nhất một hình thức. Tạo dòng cấu hình nếu chưa có. */
export const updateServicePaymentSettings = (data: Pick<ServicePaymentSettings, 'qr' | 'cash' | 'deduct'>) =>
  apiPut<void, Pick<ServicePaymentSettings, 'qr' | 'cash' | 'deduct'>>('/settings/service-payment', data)

/** Hiện đơn giá / thời gian còn lại trên máy trạm (`/settings/client-display`). Có hiệu lực ở lần đăng nhập kế tiếp. */
export interface ClientDisplaySettings {
  showPrice: boolean
  showRemainTime: boolean
  fn1: boolean
}

export const getClientDisplaySettings = () => apiGet<ClientDisplaySettings>('/settings/client-display')
export const updateClientDisplaySettings = (data: Pick<ClientDisplaySettings, 'showPrice' | 'showRemainTime'>) =>
  apiPut<void, Pick<ClientDisplaySettings, 'showPrice' | 'showRemainTime'>>('/settings/client-display', data)

/**
 * task settings-opts — 7 route thiết lập bổ sung (additive). GET: mọi nhân viên; PUT: CHỈ quản trị viên (máy chủ trả
 * "forbidden" cho người khác). PUT gửi TỪNG PHẦN (trường vắng = giữ nguyên) và trả lại đúng shape của GET.
 * Máy chủ chưa cập nhật ⇒ 404 (nơi dùng hiển thị "cần cập nhật Server").
 */

/** Kiểu lịch sao lưu: 0 tắt / 1 mỗi giờ / 2 mỗi ngày / 3 mỗi tuần (khớp `Scheduler.h`). */
export type BackupScheduleType = 0 | 1 | 2 | 3

/**
 * `/settings/backup-schedule`. `time` dạng "HH:MM" (mỗi giờ: máy chủ chỉ so PHÚT). `day` là thứ thật 0..6 =
 * Chủ nhật..Thứ bảy (máy chủ tự đổi sang chỉ số MFC), `null` = giá trị đang lưu không hợp lệ ⇒ phải chọn lại.
 * `mysqlDataDir` chỉ đọc, rỗng = máy chủ không dò được thư mục dữ liệu MySQL.
 */
export interface BackupScheduleSettings {
  type: BackupScheduleType
  time: string
  day: number | null
  compress: boolean
  backupPath: string
  mysqlDataDir: string
}

/** PUT từng phần. Tắt lịch = `{ type: 0 }` — KHÔNG xoá `backupPath`. `type ≠ 0` cần `time` + `backupPath` (+ `day` nếu mỗi tuần). */
export type BackupScheduleUpdate = Partial<Pick<BackupScheduleSettings, 'type' | 'time' | 'compress' | 'backupPath'>> & {
  day?: number
}

export const getBackupSchedule = () => apiGet<BackupScheduleSettings>('/settings/backup-schedule')
export const updateBackupSchedule = (data: BackupScheduleUpdate) =>
  apiPut<BackupScheduleSettings, BackupScheduleUpdate>('/settings/backup-schedule', data)

/** `/settings/webblock-auto`: mỗi giờ máy chủ tự tải danh sách chặn web đã ký số từ máy chủ FNet. */
export interface WebBlockAutoSettings {
  autoUpdate: boolean
}

export const getWebBlockAuto = () => apiGet<WebBlockAutoSettings>('/settings/webblock-auto')
export const updateWebBlockAuto = (data: WebBlockAutoSettings) =>
  apiPut<WebBlockAutoSettings, WebBlockAutoSettings>('/settings/webblock-auto', data)

/** `/settings/refund`: thời hạn hoàn tiền (phút). GET trả đúng giá trị đang lưu kể cả ngoài 5..1440; PUT chỉ nhận 5..1440. */
export interface RefundSettings {
  timeoutMinutes: number
}

export const getRefundSettings = () => apiGet<RefundSettings>('/settings/refund')
export const updateRefundSettings = (data: RefundSettings) =>
  apiPut<RefundSettings, RefundSettings>('/settings/refund', data)

/**
 * `/settings/qr-flags`: hai cờ QR đọc TƯƠI từ DB (hiệu lực ≤ 30 giây). `manualEffective = pendingBook && manualConfirm`
 * (xác nhận thủ công chỉ chạy khi ghi sổ đơn QR đang bật).
 */
export interface QrFlagsSettings {
  pendingBook: boolean
  manualConfirm: boolean
  manualEffective: boolean
}

export type QrFlagsUpdate = Partial<Pick<QrFlagsSettings, 'pendingBook' | 'manualConfirm'>>

export const getQrFlags = () => apiGet<QrFlagsSettings>('/settings/qr-flags')
export const updateQrFlags = (data: QrFlagsUpdate) => apiPut<QrFlagsSettings, QrFlagsUpdate>('/settings/qr-flags', data)

/**
 * `/settings/notify`: thông báo trên MÁY CHỦ (khác tùy chọn chuông/âm báo lưu ở trình duyệt). `chargeReqKeywords` là chuỗi
 * từ khóa phân tách bằng dấu phẩy; PUT chuỗi rỗng ⇒ máy chủ đặt về `defaultChargeReqKeywords`.
 */
export interface NotifyServerSettings {
  enabled: boolean
  chargeReqKeywords: string
  defaultChargeReqKeywords: string
}

export type NotifyServerUpdate = Partial<Pick<NotifyServerSettings, 'enabled' | 'chargeReqKeywords'>>

export const getNotifyServerSettings = () => apiGet<NotifyServerSettings>('/settings/notify')
export const updateNotifyServerSettings = (data: NotifyServerUpdate) =>
  apiPut<NotifyServerSettings, NotifyServerUpdate>('/settings/notify', data)

/**
 * `/settings/client-runtime`: cờ máy trạm nhận qua cấu hình máy chủ. `pausedResetMinutes` chỉ nhận 0 (tắt) hoặc 3..60
 * nhưng GET trả đúng giá trị đang lưu kể cả 1/2/>60. Máy trạm áp dụng khi nhận lại cấu hình (không có đẩy realtime).
 */
export interface ClientRuntimeSettings {
  pausedResetMinutes: number
  hwMonitor: boolean
  hubWeb: boolean
  ipStrict: boolean
}

export type ClientRuntimeUpdate = Partial<ClientRuntimeSettings>

export const getClientRuntime = () => apiGet<ClientRuntimeSettings>('/settings/client-runtime')
export const updateClientRuntime = (data: ClientRuntimeUpdate) =>
  apiPut<ClientRuntimeSettings, ClientRuntimeUpdate>('/settings/client-runtime', data)

/**
 * `/settings/remote`: `wsServer` (WebSocket) và `wsVnc` (điều khiển màn hình máy trạm qua trình duyệt). Máy chủ từ chối
 * `wsVnc = true` khi `wsServer = false` — tắt `wsServer` phải gửi kèm `wsVnc: false`.
 */
export interface RemoteControlSettings {
  wsServer: boolean
  wsVnc: boolean
}

export type RemoteControlUpdate = Partial<RemoteControlSettings>

export const getRemoteControl = () => apiGet<RemoteControlSettings>('/settings/remote')
export const updateRemoteControl = (data: RemoteControlUpdate) =>
  apiPut<RemoteControlSettings, RemoteControlUpdate>('/settings/remote', data)

export const getSettingsOptions = (keys: string[] = []) => {
  const query = keys.length > 0
    ? `?keys=${encodeURIComponent(keys.join(','))}`
    : ''
  return apiGet<SettingsOptionsResult>(`/settings/options${query}`)
}

/**
 * task topping-kho W1 — object cấu hình ORDER dùng chung (INT_ORDER_CONFIG, `/settings/order`). Chia NHÓM để mở
 * rộng: thêm cấu hình order = thêm field vào nhóm sẵn có hoặc thêm nhóm mới — giữ khớp với
 * `core/orders/order_config.h` của Server (có hướng dẫn 4 bước). GET: mọi nhân viên; PUT: chỉ quản trị viên.
 */
export interface OrderQueueConfig {
  /** Số phút chờ → nhãn vàng. 0 = tắt mức này. */
  warn: number
  /** Số phút chờ → nhãn đỏ + dải cảnh báo đầu danh sách. 0 = tắt mức này. */
  danger: number
}

export interface OrderConfig {
  v: number
  queue: OrderQueueConfig
}

/** Gửi TỪNG PHẦN — chỉ nhóm/field đang sửa; server trộn vào object đang lưu, giữ nguyên phần còn lại. */
export type OrderConfigPatch = { queue?: Partial<OrderQueueConfig> }

/** Trần mỗi ngưỡng (phút) — cùng luật Server. Mặc định 10/20 nằm ở `features/orders/orderWaitTime.ts`. */
export const ORDER_QUEUE_MAX_MINUTES = 1440

export const getOrderConfig = () => apiGet<OrderConfig>('/settings/order')
export const updateOrderConfig = (patch: OrderConfigPatch) => apiPut<OrderConfig, OrderConfigPatch>('/settings/order', patch)

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
