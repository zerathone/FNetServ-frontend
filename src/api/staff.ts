import { apiGet } from './client'

export type Staff = {
  id: number
  username: string
  /** Chỉ có khi gọi với includeInactive: false = nhân viên bị khoá (Status != 1). */
  active?: boolean
}

export function getStaffList(options: { includeInactive?: boolean } = {}) {
  return apiGet<Staff[]>(options.includeInactive ? '/staff?include_inactive=1' : '/staff')
}
