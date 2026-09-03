import { apiPost } from './client'
import type { Right } from '../store/auth'

export type LoginResponse = {
  token: string
  sessionId: string
  isAdmin: boolean
  staffId: number
  // Backend 2.16b đính rights[{code,name}] vào data khi login. staffName backend
  // hiện CHƯA trả → LoginPage tạm gán = username (không tự bịa field).
  rights: Right[]
}

export function login(username: string, password: string) {
  return apiPost<LoginResponse, { username: string; password: string }>('/auth/login', {
    username,
    password,
  })
}

export function logoutRequest() {
  return apiPost<unknown, Record<string, never>>('/auth/logout', {})
}

export type AdminChangePasswordPayload = {
  oldPassword: string
  newUsername: string
  newPassword: string
  confirmPassword: string
}

export function changeAdminPassword(payload: AdminChangePasswordPayload) {
  return apiPost<void, AdminChangePasswordPayload>('/admin/changepass', payload)
}

export type AdminWorkstationPasswordPayload = {
  username: string
  newPassword: string
  confirmPassword: string
}

export function changeAdminWorkstationPassword(
  payload: AdminWorkstationPasswordPayload,
) {
  return apiPost<void, AdminWorkstationPasswordPayload>(
    '/admin-ws/password',
    payload,
  )
}
