import type { AnonymousCustomer } from '../../api/anonyms.ts'

export function maskIdCard(value: string) {
  const normalized = value.trim()
  if (!normalized) return '—'
  if (normalized.length <= 7) return normalized
  return `${normalized.slice(0, 3)}••••${normalized.slice(-4)}`
}

export function matchesAnonymous(customer: AnonymousCustomer, search: string) {
  const normalized = search.trim().toLocaleLowerCase('vi')
  if (!normalized) return true
  return (
    customer.name.toLocaleLowerCase('vi').includes(normalized) ||
    customer.idCard.toLocaleLowerCase('vi').includes(normalized) ||
    customer.address.toLocaleLowerCase('vi').includes(normalized)
  )
}

export function validateAnonymousDetail(detail: {
  name: string
  idCard: string
  address: string
}) {
  if (!detail.name.trim()) return 'Tên khách không được để trống.'
  if (!detail.idCard.trim()) return 'Số CCCD không được để trống.'
  if (
    detail.name.length > 255 ||
    detail.idCard.length > 255 ||
    detail.address.length > 255
  ) {
    return 'Mỗi trường tối đa 255 ký tự.'
  }
  return null
}
