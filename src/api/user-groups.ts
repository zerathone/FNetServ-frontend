import { apiDelete, apiGet, apiPost, apiPut } from './client'

export type UserGroupType =
  | 'anonym'
  | 'member'
  | 'admin'
  | 'staff'
  | 'combo'

export type UserGroupTypeCode = 1 | 2 | 3 | 4 | 5

const TYPE_INT_TO_STR: Record<UserGroupTypeCode, UserGroupType> = {
  1: 'anonym',
  2: 'member',
  3: 'admin',
  4: 'staff',
  5: 'combo',
}

export interface UserGroup {
  id: number
  name: string
  type: UserGroupType
  typeCode: UserGroupTypeCode
  active: boolean
  prices: Record<number, number>
}

export interface UserGroupWriteBody {
  name: string
  type: UserGroupTypeCode
  active: boolean
  prices: Record<number, number>
}

interface ApiUserGroup {
  id: number
  name: string
  type: UserGroupTypeCode
  active: boolean
  prices: Record<string, number> | '' | null
}

function fromApi(row: ApiUserGroup): UserGroup {
  const rawPrices =
    row.prices && typeof row.prices === 'object' ? row.prices : {}
  const prices: Record<number, number> = {}
  for (const [machineGroupId, price] of Object.entries(rawPrices)) {
    prices[Number(machineGroupId)] = price
  }
  return {
    id: row.id,
    name: row.name,
    type: TYPE_INT_TO_STR[row.type] ?? 'member',
    typeCode: row.type,
    active: row.active,
    prices,
  }
}

export async function getUserGroups() {
  const rows = await apiGet<ApiUserGroup[]>('/usergroup')
  return (rows ?? []).map(fromApi)
}

export function createUserGroup(data: UserGroupWriteBody) {
  return apiPost<{ id: number }, UserGroupWriteBody>('/usergroup', data)
}

export async function updateUserGroup(
  id: number,
  data: UserGroupWriteBody,
) {
  await apiPut<void, UserGroupWriteBody>(`/usergroup?id=${id}`, data)
}

export async function deleteUserGroup(id: number) {
  await apiDelete<void>(`/usergroup?id=${id}`)
}
