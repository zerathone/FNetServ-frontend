import type { WebBlockItem, WebBlockWriteBody } from '../../api/webblock.ts'

export const MASTER_SOURCE = 3

export function canMutateWebBlock(item: WebBlockItem) {
  return item.addedBy !== MASTER_SOURCE
}

export function matchesProtectedDomain(url: string, protectedHosts: string[]) {
  const normalized = url.trim().toLocaleLowerCase('en')
  if (!normalized) return false
  return protectedHosts.some((host) => {
    const normalizedHost = host.trim().toLocaleLowerCase('en')
    if (!normalizedHost) return false
    return (
      normalized.includes(normalizedHost) ||
      normalizedHost.includes(normalized.replace(/^https?:\/\//, '').split('/')[0])
    )
  })
}

export function validateWebBlock(
  draft: WebBlockWriteBody,
  protectedHosts: string[] = [],
) {
  if (!draft.url.trim()) return 'Địa chỉ website không được để trống.'
  if (draft.url.length > 250) return 'Địa chỉ website tối đa 250 ký tự.'
  if (draft.title.length > 250) return 'Tên website tối đa 250 ký tự.'
  if (draft.description.length > 250) return 'Mô tả tối đa 250 ký tự.'
  if (matchesProtectedDomain(draft.url, protectedHosts)) {
    return 'Không thể chặn địa chỉ máy chủ đang vận hành WebUI.'
  }
  return null
}
