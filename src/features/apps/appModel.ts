import type { AppEntry, AppListType } from '../../api/apps.ts'

export type RestrictMode = 'name' | 'hash'

export const APP_SOURCE_SYSTEM = 1
export const APP_SOURCE_USER = 0

export function canMutateApp(entry: AppEntry) {
  return entry.addedBy === APP_SOURCE_USER
}

export function decodeRestrictType(value: number) {
  return {
    mode: ((value >> 4) & 1) === 1 ? ('hash' as const) : ('name' as const),
    applyToAvailable: (value & 1) === 1,
  }
}

export function encodeRestrictType(
  mode: RestrictMode,
  applyToAvailable: boolean,
) {
  return (mode === 'hash' ? 16 : 0) | (applyToAvailable ? 1 : 0)
}

export function matchesApp(entry: AppEntry, search: string) {
  const normalized = search.trim().toLocaleLowerCase('vi')
  if (!normalized) return true
  return (
    entry.name.toLocaleLowerCase('vi').includes(normalized) ||
    entry.description.toLocaleLowerCase('vi').includes(normalized) ||
    entry.hash.toLocaleLowerCase('vi').includes(normalized)
  )
}

export function findCrossListConflict(
  name: string,
  type: AppListType,
  lists: Record<AppListType, AppEntry[]>,
) {
  const normalized = name.trim().toLocaleLowerCase('vi')
  if (!normalized) return null
  const otherType: AppListType = type === 'allow' ? 'restrict' : 'allow'
  return (
    lists[otherType].find(
      (entry) => entry.name.trim().toLocaleLowerCase('vi') === normalized,
    ) ?? null
  )
}

export function validateAppDraft(draft: {
  type: AppListType
  name: string
  description: string
  mode: RestrictMode
  hash: string
}) {
  if (!draft.name.trim()) return 'Tên ứng dụng không được để trống.'
  if (draft.name.length > 100) return 'Tên ứng dụng tối đa 100 ký tự.'
  if (draft.description.length > 200) return 'Mô tả tối đa 200 ký tự.'
  if (
    draft.type === 'restrict' &&
    draft.mode === 'hash' &&
    !/^[a-fA-F0-9]{32}$/.test(draft.hash.trim())
  ) {
    return 'MD5 phải gồm đúng 32 ký tự hệ 16.'
  }
  return null
}
