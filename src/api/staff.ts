import { apiGet } from './client'

export type Staff = {
  id: number
  username: string
}

export function getStaffList() {
  return apiGet<Staff[]>('/staff')
}
