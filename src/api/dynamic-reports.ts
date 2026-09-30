import { API_BASE_URL } from './client'
import { useAuthStore } from '../store/auth'

/** Tham số phụ của /rptv2 — server chỉ nhận số nguyên (tối đa 9 chữ số). Chỉ gửi khi có giá trị. */
export type DynamicReportExtra = {
  /** type 41: 0 hằng ngày, 1 hằng tuần, 2 hằng tháng. */
  time_display?: number
  /** type 41: 0 tất cả, 1 nạp hội viên, 2 khách vãng lai, 3 combo, 4 thẻ nạp tiền, 5 dịch vụ FNet, 7 công nợ. */
  revenue_source?: number
  /** type 41: 0 tất cả, 1 tiền mặt, 2 chuyển khoản, 3 QR. */
  payment_method?: number
  /** type 32/33: 0 tất cả, 1 tiền mặt, 2 thẻ, 3 online, 4 QR. */
  payment_type?: number
  /** type 31: phút sử dụng tối thiểu (server bắt buộc có cả time_used lẫn money_used). */
  time_used?: number
  /** type 31: số tiền sử dụng tối thiểu. */
  money_used?: number
}

export type DynamicReportRequest = {
  type: number
  from_date: string
  to_date: string
  from_time?: string
  to_time?: string
  staffid?: number
} & DynamicReportExtra

const EXTRA_KEYS: (keyof DynamicReportExtra)[] = [
  'time_display',
  'revenue_source',
  'payment_method',
  'payment_type',
  'time_used',
  'money_used',
]

export async function fetchDynamicReport(payload: DynamicReportRequest) {
  const params = new URLSearchParams()
  params.append('type', payload.type.toString())
  params.append('from_date', payload.from_date)
  params.append('to_date', payload.to_date)
  if (payload.from_time) params.append('from_time', payload.from_time)
  if (payload.to_time) params.append('to_time', payload.to_time)
  params.append('staffid', payload.staffid?.toString() || '0')
  for (const key of EXTRA_KEYS) {
    const value = payload[key]
    if (value !== undefined) params.append(key, String(value))
  }
  params.append('ts', Math.floor(Date.now() / 1000).toString())

  const token = useAuthStore.getState().token
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
  }
  if (token) {
    headers['Authorization'] = `Bearer ${token}`
  }

  const response = await fetch(`${API_BASE_URL}/rptv2`, {
    method: 'POST',
    headers,
    body: params.toString()
  })

  if (response.status === 401) {
    useAuthStore.getState().logout()
    throw new Error('Phiên đăng nhập đã hết hạn, vui lòng đăng nhập lại')
  }

  if (response.status === 403) {
    throw new Error('Bạn không có quyền xem báo cáo này (403)')
  }

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`)
  }

  const result = await response.json()
  if (result.status !== '1') {
    throw new Error(result.message || result.err || 'Request failed')
  }

  return result.data === '' ? [] : result.data
}
