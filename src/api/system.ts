import { apiGet, apiPost } from './client'

export type ServerInfo = {
  ver: string
  rd: string
  /** License đã mã hoá (dùng cho check third-party) — không tự giải mã/hiển thị ở FE. */
  meta: string
}

// GET /system/version (FNetHttp/SystemHandlers.cpp: ServerVersionRequestHandler) — LoopbackOnly
// (mặc định: loopback HOẶC Bearer token hợp lệ từ LAN), trả đúng khuôn {status,message,data}.
// Trả đầy đủ field như /fninf (ver, rd, meta) để tái dùng cho các màn hình sau này.
export function getServerInfo() {
  return apiGet<ServerInfo>('/system/version')
}

export type LicenseState = 'vip' | 'active' | 'expiring' | 'error' | 'locked' | 'none'

export type LicenseInfo = {
  state: LicenseState
  statusCode: number
  flag: number
  fn1: boolean
  netId: string
  /** Chuỗi message gốc của license (luôn có, có thể rỗng) — fallback khi tách chuỗi hỏng. */
  message: string
  product: string
  /** Giữ nguyên dạng dd-mm-yyyy của server, không tự đổi định dạng / không tự tính số ngày còn lại. */
  expiry: string
  shopName: string
  phone: string
  email: string
  ver: string
  rd: string
}

// GET /system/license (SystemHandlers.cpp: LicenseInfoRequestHandler) — trạng thái license của lần
// Scheduler emit WM_DISPLAY_MESSAGE_LICENSE cuối, cùng nguồn với status bar + nút Thông tin MFC.
export function getLicenseInfo() {
  return apiGet<LicenseInfo>('/system/license')
}

// POST /system/license/url — URL trang profile/about do server dựng (giống nút Thông tin MFC). URL có
// ts + token nên phải xin mới mỗi lần bấm. Phiên sysadmin bị server từ chối.
export function getLicenseUrl() {
  return apiPost<{ url: string }, Record<string, never>>('/system/license/url', {})
}
