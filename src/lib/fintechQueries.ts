import type { QueryClient } from '@tanstack/react-query'

export const MONEY_QUERY_ROOTS = [
  ['users'],
  ['user-detail'],
  ['workstations'],
  ['workstation-user'],
  ['payment-wait'],
  ['logs', 'voucher'],
  ['revenue-summary'],
  ['dynamic-report'],
] as const

export function invalidateMoneyQueries(queryClient: QueryClient) {
  return Promise.all(
    MONEY_QUERY_ROOTS.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey: [...queryKey] }),
    ),
  )
}

export function invalidateNotificationDomain(
  queryClient: QueryClient,
  notification: { type: string; domain: string },
) {
  switch (notification.domain) {
    case 'payment':
      return invalidateMoneyQueries(queryClient)
    case 'order':
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['pending-orders'] }),
        queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] }),
      ])
    case 'workstation':
      return Promise.all([
        queryClient.invalidateQueries({ queryKey: ['workstations'] }),
        queryClient.invalidateQueries({ queryKey: ['payment-wait'] }),
      ])
    case 'chat':
      return queryClient.invalidateQueries({ queryKey: ['workstations'] })
    default:
      return Promise.resolve([])
  }
}
