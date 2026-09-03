import assert from 'node:assert/strict'
import test from 'node:test'
import type { PendingOrder } from '../src/api/orders.ts'
import {
  checkoutAmount,
  checkoutItems,
  checkoutPaymentMethod,
  groupCheckoutOrders,
  matchesCheckoutOrder,
} from '../src/features/checkout/checkoutModel.ts'

function order(patch: Partial<PendingOrder> = {}): PendingOrder {
  return {
    serviceDetailId: 1,
    userId: 42,
    userName: 'member01',
    serviceName: 'Mì bò',
    quantity: 1,
    price: 30_000,
    amount: 30_000,
    servicePaid: 4,
    hostName: 'PC-01',
    serviceDate: '2026-07-30',
    serviceTime: '10:00:00',
    parentId: 0,
    ...patch,
  }
}

test('checkout groups toppings under their main service and preserves the server amounts', () => {
  const grouped = groupCheckoutOrders([
    order(),
    order({
      serviceDetailId: 2,
      serviceName: 'Trứng',
      quantity: 2,
      price: 5_000,
      amount: 10_000,
      parentId: 1,
    }),
  ])

  assert.equal(grouped.length, 1)
  assert.equal(grouped[0].children.length, 1)
  assert.equal(checkoutAmount(grouped[0]), 40_000)
  assert.deepEqual(checkoutItems(grouped[0]), [
    { detailId: 1, quantity: 1, amount: 30_000 },
    { detailId: 2, quantity: 2, amount: 10_000 },
  ])
})

test('checkout search matches customer, machine and topping without exposing raw IDs', () => {
  const [grouped] = groupCheckoutOrders([
    order(),
    order({ serviceDetailId: 2, serviceName: 'Trứng', parentId: 1 }),
  ])

  assert.equal(matchesCheckoutOrder(grouped, 'MEMBER'), true)
  assert.equal(matchesCheckoutOrder(grouped, 'pc-01'), true)
  assert.equal(matchesCheckoutOrder(grouped, 'trứng'), true)
  assert.equal(matchesCheckoutOrder(grouped, '999999'), false)
})

test('walk-in counter orders use the guest revenue channel from the Qt machine marker', () => {
  const [guest] = groupCheckoutOrders([
    order({ hostName: 'KHACH_TAI_QUAY', userName: 'KHACHVANGLAI' }),
  ])
  const [member] = groupCheckoutOrders([order()])

  assert.equal(checkoutPaymentMethod(guest), 'guest')
  assert.equal(checkoutPaymentMethod(member), 'cash')
})
