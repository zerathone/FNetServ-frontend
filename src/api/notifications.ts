import { apiGet, apiPost } from './client'

export type OperationNotificationState =
  | 'new'
  | 'acknowledged'
  | 'claimed'
  | 'resolved'

export type OperationNotificationSeverity =
  | 'info'
  | 'attention'
  | 'urgent'
  | 'critical'

export type OperationNotificationAction = {
  id: string
  label: string
  requiredRight: number
}

export type OperationNotification = {
  id: string
  seq: number
  type: string
  domain: string
  severity: OperationNotificationSeverity
  createdAtMs: number
  updatedAtMs: number
  hostName: string
  memberId: number
  dedupeKey: string
  state: OperationNotificationState
  count: number
  claimedByStaffId: number
  actions: OperationNotificationAction[]
  // Task 6.1 (N1) them 5 field nay o server. Khai bao OPTIONAL co y: WebUI phai chay duoc
  // ca voi Server.exe ban CU (chua co 6.1) — 90% khach dung path cu.
  source?: string
  title?: string
  body?: string
  meta?: Record<string, unknown>
  cleared?: boolean
}

export type OperationNotificationPage = {
  bootId: string
  seq: number
  oldestSeq: number
  dropped: boolean
  // Task 6.1 (N3): tong so muc chua doc toan buffer (khong phu thuoc limit/after).
  // Optional vi Server.exe ban cu khong tra field nay.
  unreadCount?: number
  items: OperationNotification[]
}

export type OperationNotificationSnapshot = Omit<OperationNotificationPage, 'dropped'> & {
  dropped: boolean
}

const PAGE_LIMIT = 200
const MAX_PAGES = 8

export const OPERATIONS_NOTIFICATIONS_QUERY_KEY = ['operations-notifications'] as const

export function listOperationNotifications(after = 0, limit = PAGE_LIMIT) {
  return apiGet<OperationNotificationPage>(
    `/operations/notifications?after=${after}&limit=${limit}`,
  )
}

export async function getOperationNotificationSnapshot() {
  let after = 0
  let bootId = ''
  let items: OperationNotification[] = []
  let lastPage: OperationNotificationPage | null = null
  let restartCount = 0

  for (let pageIndex = 0; pageIndex < MAX_PAGES; pageIndex += 1) {
    const page = await listOperationNotifications(after)
    if ((bootId && page.bootId !== bootId) || (after > 0 && page.dropped)) {
      if (restartCount >= 1) return { ...page, items: page.items }
      restartCount += 1
      pageIndex = -1
      after = 0
      bootId = ''
      items = []
      lastPage = null
      continue
    }

    bootId = page.bootId
    lastPage = page
    items = [...items, ...page.items]
    const newest = page.items.at(-1)?.seq ?? after
    if (newest >= page.seq || page.items.length < PAGE_LIMIT) break
    after = newest
  }

  return {
    bootId: lastPage?.bootId ?? '',
    seq: lastPage?.seq ?? 0,
    oldestSeq: lastPage?.oldestSeq ?? 0,
    dropped: lastPage?.dropped ?? false,
    items,
  } satisfies OperationNotificationSnapshot
}

export function updateOperationNotificationState(
  action: 'ack' | 'claim' | 'resolve',
  ids: string[],
) {
  const body = ids.length === 1 ? { id: ids[0] } : { ids }
  return apiPost<
    { state: OperationNotificationState; updated: string[]; notFound: string[] },
    { id?: string; ids?: string[] }
  >(`/operations/notifications/${action}`, body)
}
