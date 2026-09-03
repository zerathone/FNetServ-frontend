import type {
  UserGroup,
  UserGroupType,
  UserGroupTypeCode,
} from '../../api/user-groups.ts'

export const EDITABLE_USER_GROUP_TYPES = new Set<UserGroupTypeCode>([1, 2])

export const USER_GROUP_TYPE_ORDER: UserGroupType[] = [
  'anonym',
  'member',
  'admin',
  'staff',
  'combo',
]

export function userGroupTypeLabel(type: UserGroupType) {
  const labels: Record<UserGroupType, string> = {
    anonym: 'Khách vãng lai',
    member: 'Hội viên',
    admin: 'Quản trị hệ thống',
    staff: 'Nhân viên',
    combo: 'Thẻ combo',
  }
  return labels[type]
}

export function groupUserGroupsByType(groups: UserGroup[]) {
  return USER_GROUP_TYPE_ORDER.map((type) => ({
    type,
    label: userGroupTypeLabel(type),
    groups: groups.filter((group) => group.type === type),
  })).filter((section) => section.groups.length > 0)
}

export function canManageUserGroup(group: UserGroup) {
  return supportsUserGroupPricingAndPromotion(group)
}

export function supportsUserGroupPricingAndPromotion(group: UserGroup) {
  return EDITABLE_USER_GROUP_TYPES.has(group.typeCode)
}

export function canRequestUserGroupDelete(group: UserGroup) {
  return canManageUserGroup(group) && group.active
}

export function matchesUserGroup(group: UserGroup, search: string) {
  const normalized = search.trim().toLocaleLowerCase('vi')
  if (!normalized) return true
  return (
    group.name.toLocaleLowerCase('vi').includes(normalized) ||
    userGroupTypeLabel(group.type).toLocaleLowerCase('vi').includes(normalized)
  )
}

export function validateUserGroupDraft(draft: {
  name: string
  prices: Record<number, number | null>
  machineGroupIds: number[]
}) {
  if (!draft.name.trim()) return 'Tên nhóm khách hàng không được để trống.'
  if (draft.name.length > 22) return 'Tên nhóm tối đa 22 ký tự.'
  for (const machineGroupId of draft.machineGroupIds) {
    const price = draft.prices[machineGroupId]
    if (price === null || price === undefined) {
      return 'Cần nhập giá cho tất cả nhóm máy.'
    }
    if (!Number.isInteger(price) || price < 0 || price > 999_999) {
      return 'Mỗi mức giá phải là số nguyên từ 0 đến 999.999 đồng.'
    }
  }
  return null
}

export function zeroPriceMachineGroupIds(
  prices: Record<number, number | null>,
  machineGroupIds: number[],
) {
  return machineGroupIds.filter((id) => prices[id] === 0)
}
