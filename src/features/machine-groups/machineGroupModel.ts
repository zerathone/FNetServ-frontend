import type { MachineGroup } from '../../api/machine-groups.ts'

export function matchesMachineGroup(group: MachineGroup, search: string) {
  const normalized = search.trim().toLocaleLowerCase('vi')
  if (!normalized) return true
  return (
    group.name.toLocaleLowerCase('vi').includes(normalized) ||
    group.description.toLocaleLowerCase('vi').includes(normalized)
  )
}

export function canEditAnonymPrice(group: MachineGroup) {
  return !group.anonymPriceAmbiguous
}

export function canRequestMachineGroupDelete(group: MachineGroup) {
  return group.active > 0
}

export function validateMachineGroupDraft(draft: {
  name: string
  description: string
  anonymPrice: number | null
  priceEditable: boolean
}) {
  if (!draft.name.trim()) return 'Tên nhóm máy không được để trống.'
  if (draft.name.length > 25) return 'Tên nhóm máy tối đa 25 ký tự theo form MFC.'
  if (draft.description.length > 100) return 'Mô tả tối đa 100 ký tự theo form MFC.'
  if (
    draft.priceEditable &&
    draft.anonymPrice !== null &&
    (!Number.isInteger(draft.anonymPrice) ||
      draft.anonymPrice < 0 ||
      draft.anonymPrice > 999_999)
  ) {
    return 'Giá vãng lai phải là số nguyên từ 0 đến 999.999 đồng.'
  }
  return null
}

export function validateMachineGroupCreateDraft(draft: {
  name: string
  description: string
  priceGroupIds: number[]
  prices: Record<number, number | null>
}) {
  const baseError = validateMachineGroupDraft({
    name: draft.name,
    description: draft.description,
    anonymPrice: null,
    priceEditable: false,
  })
  if (baseError) return baseError
  if (draft.priceGroupIds.length === 0) {
    return 'Chưa có bảng giá vãng lai hoặc hội viên để tạo ma trận giá.'
  }
  for (const id of draft.priceGroupIds) {
    const price = draft.prices[id]
    if (
      price === null ||
      price === undefined ||
      !Number.isInteger(price) ||
      price < 0 ||
      price > 999_999
    ) {
      return 'Cần nhập giá nguyên từ 0 đến 999.999 đồng cho mọi bảng giá.'
    }
  }
  return null
}

export function zeroPriceUserGroupIds(
  prices: Record<number, number | null>,
  priceGroupIds: number[],
) {
  return priceGroupIds.filter((id) => prices[id] === 0)
}
