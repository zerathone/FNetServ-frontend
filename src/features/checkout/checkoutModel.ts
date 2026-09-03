import type { PendingOrder } from '../../api/orders.ts'

export type CheckoutOrder = PendingOrder & {
  children: PendingOrder[]
  createdAtMs: number
}

function parseCreatedAt(date?: string, time?: string) {
  if (!date || !time) return 0
  const parsed = new Date(`${date}T${time}`).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function groupCheckoutOrders(orders: PendingOrder[]): CheckoutOrder[] {
  const mainIds = new Set(
    orders
      .filter((order) => !order.parentId || order.parentId === 0)
      .map((order) => order.serviceDetailId),
  )
  const mains = orders.filter(
    (order) => !order.parentId || order.parentId === 0 || !mainIds.has(order.parentId),
  )
  const toppings = orders.filter(
    (order) => order.parentId && order.parentId > 0 && mainIds.has(order.parentId),
  )

  return mains
    .map((main) => ({
      ...main,
      children: toppings.filter((item) => item.parentId === main.serviceDetailId),
      createdAtMs: parseCreatedAt(main.serviceDate, main.serviceTime),
    }))
    .sort((left, right) => {
      if (!left.createdAtMs) return 1
      if (!right.createdAtMs) return -1
      return left.createdAtMs - right.createdAtMs
    })
}

export function checkoutItems(order: CheckoutOrder) {
  return [
    {
      detailId: order.serviceDetailId,
      quantity: order.quantity,
      amount: order.amount,
    },
    ...order.children.map((child) => ({
      detailId: child.serviceDetailId,
      quantity: child.quantity,
      amount: child.amount,
    })),
  ]
}

export function checkoutAmount(order: CheckoutOrder) {
  return checkoutItems(order).reduce((sum, item) => sum + item.amount, 0)
}

export function checkoutPaymentMethod(order: CheckoutOrder): 'cash' | 'guest' {
  return order.hostName?.trim().toLocaleUpperCase('vi') === 'KHACH_TAI_QUAY'
    ? 'guest'
    : 'cash'
}

export function matchesCheckoutOrder(order: CheckoutOrder, search: string) {
  const normalized = search.trim().toLocaleLowerCase('vi')
  if (!normalized) return true
  return [
    order.userName,
    order.hostName ?? '',
    order.serviceName,
    ...order.children.map((child) => child.serviceName),
  ].some((value) => value.toLocaleLowerCase('vi').includes(normalized))
}
