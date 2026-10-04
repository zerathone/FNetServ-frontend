import assert from 'node:assert/strict'
import test from 'node:test'
import type { PendingOrder } from '../src/api/orders.ts'
import {
  canChangeQuantity,
  clampQuantity,
  customerInfoOf,
  describeProcessedCount,
  groupOrders,
  groupQrOrders,
  lineAmount,
  orderAmount,
  qrAcceptItems,
  qrCancelItems,
  serviceCancelItems,
  serviceItems,
} from '../src/features/orders/orderQueueModel.ts'

function line(partial: Partial<PendingOrder>): PendingOrder {
  return {
    serviceDetailId: 1,
    userId: 3,
    userName: 'an',
    serviceName: 'Cafe',
    quantity: 2,
    price: 3500,
    amount: 6000,
    servicePaid: 0,
    hostName: 'PC01',
    serviceDate: '2026-10-04',
    serviceTime: '10:00:00',
    parentId: 0,
    topping: 0,
    voucherId: 0,
    serviceAmount: 6000,
    unitPrice: 3000,
    ...partial,
  }
}

test('QR rows are split out of the normal queue and grouped per voucher', () => {
  const rows = [
    line({ serviceDetailId: 1 }),
    line({ serviceDetailId: 2, servicePaid: 1, voucherId: 77, serviceAmount: 4000, amount: 4000 }),
    line({ serviceDetailId: 3, servicePaid: 1, voucherId: 77, serviceAmount: 3000, amount: 3000 }),
  ]
  const normal = groupOrders(rows)
  assert.deepEqual(normal.map((o) => o.serviceDetailId), [1])
  const qr = groupQrOrders(rows)
  assert.equal(qr.length, 1)
  assert.equal(qr[0].voucherId, 77)
  assert.equal(qr[0].paidTotal, 7000)
  assert.deepEqual(
    qrAcceptItems(qr[0]).map((i) => [i.detailId, i.alreadyPaid]),
    [[2, true], [3, true]],
  )
})

test('amount uses snapshot unit price, not the current service price', () => {
  const order = groupOrders([line({})])[0]
  assert.equal(lineAmount(order, {}), 6000) // unchanged qty -> stored ServiceAmount
  assert.equal(lineAmount(order, { 1: 3 }), 9000) // 3 x 3000 (not 3 x 3500)
  assert.equal(orderAmount(order, { 1: 3 }), 9000)
  const items = serviceItems(order, { 1: 3 })
  assert.deepEqual(items, [{ detailId: 1, quantity: 3, amount: 9000, alreadyPaid: false }])
})

test('quantity is clamped to 1..99 and only standalone 0/4/5 lines are editable', () => {
  assert.equal(clampQuantity(0), 1)
  assert.equal(clampQuantity(150), 99)
  assert.equal(clampQuantity(Number.NaN), 1)
  const [withTopping] = groupOrders([
    line({ serviceDetailId: 1 }),
    line({ serviceDetailId: 2, parentId: 1, topping: 1 }),
  ])
  assert.equal(canChangeQuantity(withTopping), false)
  assert.equal(canChangeQuantity(groupOrders([line({ servicePaid: 4 })])[0]), true)
  assert.equal(canChangeQuantity(groupOrders([line({ servicePaid: 5 })])[0]), true)
})

test('cancel payload carries machine/customer/service/qty/amount for the audit log', () => {
  const order = groupOrders([line({})])[0]
  assert.deepEqual(serviceCancelItems(order), [
    {
      type: 'service',
      id: 1,
      machineName: 'PC01',
      customerInfo: 'Tài khoản an',
      serviceName: 'Cafe',
      quantity: 2,
      amount: 6000,
    },
  ])
  assert.equal(customerInfoOf(''), 'Khách vãng lai')
  const qr = groupQrOrders([line({ serviceDetailId: 9, servicePaid: 1, voucherId: 5, serviceAmount: 4000 })])[0]
  assert.equal(qrCancelItems(qr)[0].amount, 4000)
})

test('zero processed rows never reports success (KNOWLEDGE 47)', () => {
  assert.equal(describeProcessedCount(0, 'chấp nhận').tone, 'info')
  assert.equal(describeProcessedCount(2, 'chấp nhận').tone, 'success')
})
