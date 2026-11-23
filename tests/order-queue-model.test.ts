import assert from 'node:assert/strict'
import test from 'node:test'
import type { PendingOrder } from '../src/api/orders.ts'
import {
  acceptedUnpaidSelectKey,
  canChangeQuantity,
  clampQuantity,
  clearAcceptedVouchers,
  countAcceptedUnpaidWithoutVoucher,
  customerInfoOf,
  groupAcceptedUnpaidOrders,
  groupCompletedOrders,
  describeInventoryWarnings,
  describeProcessedCount,
  groupOrders,
  groupQrOrders,
  isPriceBelowList,
  lineAmount,
  orderAmount,
  qrAcceptItems,
  qrCancelItems,
  qtyLockedReason,
  serviceCancelItems,
  serviceItems,
} from '../src/features/orders/orderQueueModel.ts'
import { isOverDangerWait, waitTone } from '../src/features/orders/orderWaitTime.ts'

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

test('Q-SEC2-1 isPriceBelowList: uu tien co BE, fallback so unitPrice < price, khai cao hon / bang khong canh bao', () => {
  // co BE quyet dinh (ke ca khi so lieu FE tu so ra khac)
  assert.equal(isPriceBelowList(line({ priceBelowList: true, unitPrice: 5000, price: 3500 })), true)
  assert.equal(isPriceBelowList(line({ priceBelowList: false, unitPrice: 1000, price: 3500 })), false)
  // BE cu khong co co: tu so
  assert.equal(isPriceBelowList(line({ unitPrice: 1000, price: 3500 })), true)
  assert.equal(isPriceBelowList(line({ unitPrice: 3500, price: 3500 })), false)
  assert.equal(isPriceBelowList(line({ unitPrice: 5000, price: 3500 })), false)
  // khong co unitPrice (goi khong includePaid) / bang gia 0 => khong canh bao
  assert.equal(isPriceBelowList(line({ unitPrice: undefined, price: 3500 })), false)
  assert.equal(isPriceBelowList(line({ unitPrice: 1000, price: 0 })), false)
})

test('completed: gom theo phieu, sap theo gio THU TIEN (khong theo gio goi mon), lay hinh thuc tu dong dau', () => {
  const rows = [
    // phieu 70: goi som (08:00) nhung thu muon nhat (20:00) -> phai len dau
    line({ serviceDetailId: 1, voucherId: 70, serviceTime: '08:00:00', paidDate: '2026-10-07', paidTime: '20:00:00', paymentMethod: 'cash', serviceAmount: 3000 }),
    line({ serviceDetailId: 2, voucherId: 70, serviceTime: '08:00:00', paidDate: '2026-10-07', paidTime: '20:00:00', paymentMethod: 'cash', serviceAmount: 2000 }),
    // phieu 71: goi muon (19:00), thu 19:30
    line({ serviceDetailId: 3, voucherId: 71, serviceTime: '19:00:00', paidDate: '2026-10-07', paidTime: '19:30:00', paymentMethod: 'qr', serviceAmount: 7000 }),
    // phieu 72/73 cung gio thu -> phieu sau (id lon) truoc
    line({ serviceDetailId: 4, voucherId: 72, paidDate: '2026-10-07', paidTime: '10:00:00', paymentMethod: 'deduct' }),
    line({ serviceDetailId: 5, voucherId: 73, paidDate: '2026-10-07', paidTime: '10:00:00', paymentMethod: 'transfer' }),
    // thieu voucherId -> bo qua (khong doan phieu)
    line({ serviceDetailId: 6, voucherId: 0, paidDate: '2026-10-07', paidTime: '23:00:00', paymentMethod: 'cash' }),
  ]
  const groups = groupCompletedOrders(rows)
  assert.deepEqual(groups.map((g) => g.voucherId), [70, 71, 73, 72])
  assert.equal(groups[0].paidTotal, 5000)
  assert.equal(groups[0].paymentMethod, 'cash')
  assert.equal(groups[0].paidTime, '20:00:00')
  assert.equal(groups[1].paymentMethod, 'qr')
  assert.equal(groups[2].paymentMethod, 'transfer')
})

test('completed: BE cu chua tra paidTime -> paymentMethod null, xep cuoi, khong vo', () => {
  const groups = groupCompletedOrders([
    line({ serviceDetailId: 1, voucherId: 80 }),
    line({ serviceDetailId: 2, voucherId: 81, paidDate: '2026-10-07', paidTime: '09:00:00', paymentMethod: 'online' }),
  ])
  assert.deepEqual(groups.map((g) => g.voucherId), [81, 80])
  assert.equal(groups[1].paymentMethod, null)
  assert.equal(groups[1].paidAtMs, 0)
})

test('accepted-unpaid: gom theo (phieu, hinh thuc khach chon); 4 => chi tien mat, 5 => chi can tru', () => {
  const rows = [
    line({ serviceDetailId: 1, voucherId: 50, servicePaid: 0, serviceAmount: 6000 }),
    line({ serviceDetailId: 2, voucherId: 50, servicePaid: 4, serviceAmount: 3000 }),
    line({ serviceDetailId: 3, voucherId: 50, servicePaid: 0, serviceAmount: 1000 }),
    line({ serviceDetailId: 4, voucherId: 51, servicePaid: 5, serviceAmount: 2000 }),
    line({ serviceDetailId: 5, voucherId: 0, servicePaid: 0 }),
  ]
  const groups = groupAcceptedUnpaidOrders(rows)
  assert.equal(groups.length, 3)
  const g50free = groups.find((g) => g.voucherId === 50 && g.servicePaid === 0)
  const g50cash = groups.find((g) => g.voucherId === 50 && g.servicePaid === 4)
  const g51 = groups.find((g) => g.voucherId === 51)
  assert.deepEqual(g50free?.lines.map((l) => l.serviceDetailId), [1, 3])
  assert.equal(g50free?.total, 7000)
  assert.equal(g50free?.lockedMethod, null)
  assert.equal(g50cash?.lockedMethod, 'cash')
  assert.equal(g51?.lockedMethod, 'deduct')
  // dong thieu phieu khong vao nhom nao nhung duoc dem de bao cho thu ngan
  assert.equal(countAcceptedUnpaidWithoutVoucher(rows), 1)
  // 2 card cung phieu co key khac nhau
  assert.notEqual(acceptedUnpaidSelectKey(g50free!), acceptedUnpaidSelectKey(g50cash!))
})

test('accepted-unpaid: huy hang loat gop cac card cung phieu thanh 1 entry', () => {
  const rows = [
    line({ serviceDetailId: 1, voucherId: 50, servicePaid: 0 }),
    line({ serviceDetailId: 2, voucherId: 50, servicePaid: 4 }),
    line({ serviceDetailId: 4, voucherId: 51, servicePaid: 5 }),
  ]
  const vouchers = clearAcceptedVouchers(groupAcceptedUnpaidOrders(rows))
  assert.deepEqual(
    vouchers.map((v) => ({ voucherId: v.voucherId, detailIds: [...v.detailIds].sort() })),
    [
      { voucherId: 50, detailIds: [1, 2] },
      { voucherId: 51, detailIds: [4] },
    ],
  )
})

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

test('topping-kho R1: qtyLocked line (recipe/topping/material) cannot change quantity; null/absent keeps old rule', () => {
  const locked = groupOrders([line({ qtyLocked: true })])[0]
  assert.equal(canChangeQuantity(locked), false)
  assert.equal(qtyLockedReason(locked), 'Món có topping/công thức — muốn đổi số lượng hãy đặt đơn khác')
  assert.equal(canChangeQuantity(groupOrders([line({ qtyLocked: false })])[0]), true)
  assert.equal(canChangeQuantity(groupOrders([line({ qtyLocked: null })])[0]), true)
  assert.equal(qtyLockedReason(groupOrders([line({})])[0]), null)
})

test('topping-kho W1: wait tone follows configured thresholds; 0 disables a level', () => {
  const now = Date.parse('2026-11-15T10:30:00')
  const at = (minutesAgo: number) => now - minutesAgo * 60_000
  assert.equal(waitTone(at(9), now), 'info')
  assert.equal(waitTone(at(10), now), 'warning')
  assert.equal(waitTone(at(20), now), 'danger')
  const cfg = { warn: 15, danger: 30 }
  assert.equal(waitTone(at(20), now, cfg), 'warning')
  assert.equal(waitTone(at(30), now, cfg), 'danger')
  assert.equal(waitTone(at(500), now, { warn: 0, danger: 0 }), 'info')
  assert.equal(waitTone(at(50), now, { warn: 30, danger: 0 }), 'warning')
  assert.equal(isOverDangerWait(at(30), now, cfg), true)
  assert.equal(isOverDangerWait(at(29), now, cfg), false)
  assert.equal(isOverDangerWait(at(999), now, { warn: 10, danger: 0 }), false)
  assert.equal(isOverDangerWait(0, now), false)
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

test('inventory warnings become one toast line, none when empty', () => {
  assert.equal(describeInventoryWarnings([]), null)
  assert.equal(describeInventoryWarnings(undefined), null)
  assert.equal(
    describeInventoryWarnings([{ serviceName: 'Sting', inventory: 3 }]),
    'Sắp hết hàng: Sting còn 3.',
  )
})

test('zero processed rows never reports success (KNOWLEDGE 47)', () => {
  assert.equal(describeProcessedCount(0, 'chấp nhận').tone, 'info')
  assert.equal(describeProcessedCount(2, 'chấp nhận').tone, 'success')
})
