import { API_BASE_URL } from './client'
import { useAuthStore } from '../store/auth'

export type DynamicReportRequest = {
  type: number
  from_date: string
  to_date: string
  from_time?: string
  to_time?: string
  staffid?: number
}

export async function fetchDynamicReport(payload: DynamicReportRequest) {
  const params = new URLSearchParams()
  params.append('type', payload.type.toString())
  params.append('from_date', payload.from_date)
  params.append('to_date', payload.to_date)
  if (payload.from_time) params.append('from_time', payload.from_time)
  if (payload.to_time) params.append('to_time', payload.to_time)
  params.append('staffid', payload.staffid?.toString() || '0')
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
