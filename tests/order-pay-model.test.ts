import assert from 'node:assert/strict'
import test from 'node:test'
import type { PendingOrder } from '../src/api/orders.ts'
import {
  MACHINE_STATUS,
  SERVICE_EXCEPT_RIGHT,
  USER_GROUP,
  classifyPayError,
  classifyPayResult,
  describeAlertReason,
  dryRunPayload,
  machineGate,
  payFingerprint,
  payGates,
  payItems,
  payPayload,
  removeAlert,
  upsertAlert,
  type DeductAlert,
  type MachineInfo,
} from '../src/features/orders/orderPayModel.ts'
import { groupOrders } from '../src/features/orders/orderQueueModel.ts'

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

function orderOf(partial: Partial<PendingOrder> = {}, toppings: Partial<PendingOrder>[] = []) {
  const rows = [line(partial), ...toppings.map((t, i) => line({ serviceDetailId: 100 + i, parentId: partial.serviceDetailId ?? 1, ...t }))]
  return groupOrders(rows)[0]
}

const member: MachineInfo = { status: MACHINE_STATUS.ONLINE, userId: 3, userGroupType: USER_GROUP.member }

test('machineGate: chua co du lieu may => khong chan (fail-open); AVAILABLE/DISCONNECT/WARNING => chan', () => {
  assert.equal(machineGate(undefined).enabled, true)
  assert.equal(machineGate(null).enabled, true)
  assert.equal(machineGate(member).enabled, true)
  for (const status of [MACHINE_STATUS.AVAILABLE, MACHINE_STATUS.DISCONNECT, MACHINE_STATUS.WARNING]) {
    const gate = machineGate({ ...member, status })
    assert.equal(gate.enabled, false)
    assert.ok(gate.reason)
  }
})

test('machineGate: loai tai khoan la (admin / none) => chan, vang lai/nhan vien/combo => cho', () => {
  assert.equal(machineGate({ ...member, userGroupType: USER_GROUP.admin }).enabled, false)
  assert.equal(machineGate({ ...member, userGroupType: 0 }).enabled, false)
  for (const g of [USER_GROUP.anonym, USER_GROUP.staff, USER_GROUP.combo]) {
    assert.equal(machineGate({ ...member, userGroupType: g }).enabled, true)
  }
})

test('payGates: ServicePaid=0 => ca hai; 4 => tat Can tru; 5 => tat Thanh toan (parity Qt)', () => {
  const zero = payGates(orderOf({ servicePaid: 0 }), member, true)
  assert.deepEqual([zero.accept.enabled, zero.cash.enabled, zero.deduct.enabled], [true, true, true])

  const cashAtMachine = payGates(orderOf({ servicePaid: 4 }), member, true)
  assert.equal(cashAtMachine.cash.enabled, true)
  assert.equal(cashAtMachine.deduct.enabled, false)

  const deductAtMachine = payGates(orderOf({ servicePaid: 5 }), member, true)
  assert.equal(deductAtMachine.cash.enabled, false)
  assert.equal(deductAtMachine.deduct.enabled, true)
})

test('payGates: Can tru can quyen 9224; Thanh toan tien mat KHONG can', () => {
  const gates = payGates(orderOf(), member, false)
  assert.equal(gates.cash.enabled, true)
  assert.equal(gates.deduct.enabled, false)
  assert.match(gates.deduct.reason ?? '', new RegExp(String(SERVICE_EXCEPT_RIGHT)))
})

test('payGates: Can tru chi cho hoi vien dang online dung may, dung nguoi', () => {
  const o = orderOf()
  assert.equal(payGates(o, { ...member, userGroupType: USER_GROUP.anonym }, true).deduct.enabled, false)
  assert.equal(payGates(o, { ...member, userGroupType: USER_GROUP.staff }, true).deduct.enabled, false)
  assert.equal(payGates(o, { ...member, userGroupType: USER_GROUP.combo }, true).deduct.enabled, false)
  assert.equal(payGates(o, { ...member, userId: 99 }, true).deduct.enabled, false)
  assert.equal(payGates(o, { ...member, status: MACHINE_STATUS.DISCONNECT }, true).deduct.enabled, false)
  assert.equal(payGates(o, null, true).deduct.enabled, false) // da tai danh sach nhung khong thay may
  assert.equal(payGates(o, undefined, true).deduct.enabled, true) // chua tai => de backend quyet dinh
})

test('payGates: may offline chan ca Chap nhan lan Thanh toan; khong co userId / hostName', () => {
  const offline = payGates(orderOf(), { ...member, status: MACHINE_STATUS.DISCONNECT }, true)
  assert.equal(offline.accept.enabled, false)
  assert.equal(offline.cash.enabled, false)
  const walkIn = payGates(orderOf({ userId: 0 }), member, true)
  assert.equal(walkIn.cash.enabled, false) // BE can userId > 0
  assert.equal(walkIn.deduct.enabled, false)
  const noHost = payGates(orderOf({ hostName: null }), undefined, true)
  assert.equal(noHost.cash.enabled, true) // tien mat khong bat buoc hostName
  assert.equal(noHost.deduct.enabled, false)
})

test('payGates: don da tra QR khong co Chap nhan / Thanh toan / Can tru', () => {
  const qr = payGates({ servicePaid: 1, userId: 3, hostName: 'PC01' }, member, true)
  assert.deepEqual([qr.accept.enabled, qr.cash.enabled, qr.deduct.enabled], [false, false, false])
})

test('payItems / payFingerprint: gom ca topping, doi so luong => fingerprint khac (idem moi)', () => {
  const o = orderOf({ serviceDetailId: 10, quantity: 1, amount: 3000, serviceAmount: 3000 }, [
    { quantity: 1, amount: 500, serviceAmount: 500, unitPrice: 500 },
  ])
  assert.deepEqual(
    payItems(o).map((i) => i.detailId),
    [10, 100],
  )
  const base = JSON.stringify(payFingerprint('cash', o))
  assert.equal(JSON.stringify(payFingerprint('cash', o)), base)
  assert.notEqual(JSON.stringify(payFingerprint('deduct', o)), base)
  assert.notEqual(JSON.stringify(payFingerprint('cash', o, { 10: 3 })), base)
  assert.equal(payItems(o, { 10: 3 })[0].quantity, 3)
})

test('payPayload: fullCore:true + idem; dryRunPayload KHONG co idem/fullCore', () => {
  const o = orderOf()
  const payload = payPayload('deduct', o, 7, 'order-pay-abc')
  assert.equal(payload.fullCore, true)
  assert.equal(payload.idem, 'order-pay-abc')
  assert.equal(payload.paymentMethod, 'deduct')
  assert.equal(payload.userId, 3)
  const dry = dryRunPayload('cash', o, 7)
  assert.equal('idem' in dry, false)
  assert.equal('fullCore' in dry, false)
})

test('classifyPayResult cash: paid>0 => success; paid=0 => info khong xoa key', () => {
  const ok = classifyPayResult('cash', { paymentId: 55, paid: 2, total: 6000 })
  assert.equal(ok.kind, 'success')
  const zero = classifyPayResult('cash', { paymentId: 55, paid: 0 })
  assert.equal(zero.kind, 'info')
  assert.equal(zero.kind === 'info' && zero.clearKey, false)
})

test('classifyPayResult: duplicated => info + xoa key (khong thu lan hai)', () => {
  const cash = classifyPayResult('cash', { paymentId: 55, paid: 0, duplicated: true })
  assert.equal(cash.kind, 'info')
  assert.equal(cash.kind === 'info' && cash.clearKey, true)
  const deduct = classifyPayResult('deduct', { paymentId: 55, paid: 0, duplicated: true, deductApplied: true })
  assert.equal(deduct.kind, 'info')
})

test('classifyPayResult deduct: CHI thanh cong khi deductApplied === true (KNOWLEDGE §47)', () => {
  assert.equal(classifyPayResult('deduct', { paymentId: 9, paid: 1, deductApplied: true }).kind, 'success')
  assert.equal(
    classifyPayResult('deduct', { paymentId: 9, paid: 1, deductApplied: true, retried: true }).kind,
    'success',
  )
  // thieu co => khong duoc coi la thanh cong
  assert.equal(classifyPayResult('deduct', { paymentId: 9, paid: 1 }).kind, 'manual-fix')
  assert.equal(classifyPayResult('deduct', { paymentId: 9, paid: 1, deductApplied: false }).kind, 'manual-fix')
  // needsManualFix thang deductApplied
  assert.equal(
    classifyPayResult('deduct', { paymentId: 9, deductApplied: true, needsManualFix: true }).kind,
    'manual-fix',
  )
})

test('classifyPayResult deduct: chi deduct_failed moi duoc "Thu tru vi lai"', () => {
  const failed = classifyPayResult('deduct', { paymentId: 9, deductApplied: false, needsManualFix: true, code: 'deduct_failed' })
  assert.equal(failed.kind === 'manual-fix' && failed.retryable, true)
  const offline = classifyPayResult('deduct', { paymentId: 9, deductApplied: false, needsManualFix: true, code: 'member_offline' })
  assert.equal(offline.kind === 'manual-fix' && offline.retryable, false)
  const incomplete = classifyPayResult('deduct', { paymentId: 9, deductApplied: false, needsManualFix: true, code: 'deduct_incomplete' })
  assert.equal(incomplete.kind === 'manual-fix' && incomplete.retryable, false)
  const noCode = classifyPayResult('deduct', { paymentId: 9, deductApplied: false })
  assert.equal(noCode.kind === 'manual-fix' && noCode.retryable, false)
})

test('classifyPayResult: duplicated nhung chua tru vi (c) van la manual-fix, khong "da cap tru truoc do"', () => {
  const outcome = classifyPayResult('deduct', { paymentId: 9, duplicated: true, deductApplied: false, needsManualFix: true, code: 'deduct_incomplete' })
  assert.equal(outcome.kind, 'manual-fix')
})

test('classifyPayError: invalid_lines/nothing_paid => tai lai; idem_mismatch => doi key; con lai khong dung gi', () => {
  assert.deepEqual(classifyPayError('invalid_lines'), { refetch: true, resetKey: false })
  assert.deepEqual(classifyPayError('nothing_paid'), { refetch: true, resetKey: false })
  assert.deepEqual(classifyPayError('idem_mismatch'), { refetch: true, resetKey: true })
  assert.deepEqual(classifyPayError('member_offline'), { refetch: false, resetKey: false })
  assert.deepEqual(classifyPayError(undefined), { refetch: false, resetKey: false })
})

test('upsertAlert / removeAlert: moi phieu mot banner; cap nhat thay the', () => {
  const request = payPayload('deduct', orderOf(), 7, 'order-pay-1')
  const alert = (paymentId: number, code: string): DeductAlert => ({
    paymentId,
    hostName: 'PC01',
    customerLabel: 'an',
    amount: 6000,
    code,
    retryable: code === 'deduct_failed',
    retry: { endpoint: 'payrequest', request },
  })
  let alerts: DeductAlert[] = []
  alerts = upsertAlert(alerts, alert(9, 'deduct_failed'))
  alerts = upsertAlert(alerts, alert(10, 'member_offline'))
  alerts = upsertAlert(alerts, alert(9, 'member_offline')) // thu lai van loi, doi nguyen nhan
  assert.equal(alerts.length, 2)
  assert.equal(alerts.find((a) => a.paymentId === 9)?.code, 'member_offline')
  assert.deepEqual(removeAlert(alerts, 9).map((a) => a.paymentId), [10])
})

test('describeAlertReason: moi code mot huong dan, khong rong', () => {
  for (const code of ['member_offline', 'deduct_incomplete', 'deduct_failed', undefined]) {
    assert.ok(describeAlertReason(code).length > 10)
  }
  assert.match(describeAlertReason('member_offline'), /không còn online/)
  assert.match(describeAlertReason('deduct_failed'), /Thử trừ ví lại/)
})

test('khach vang lai tai quay (dong treo cua "Goi mon ho"): chi thu tien mat kenh guest, khong tab/can tru', () => {
  const guestOrder = orderOf({ userId: 99, userName: 'KHACHVANGLAI', hostName: 'KHACHVANGLAI' })
  const gates = payGates(guestOrder, undefined, true)
  assert.equal(gates.cash.enabled, true)
  assert.equal(gates.accept.enabled, false)
  assert.equal(gates.deduct.enabled, false)

  const cash = dryRunPayload('cash', guestOrder, 5)
  assert.equal(cash.paymentMethod, 'guest')
  assert.equal(cash.hostName, 'KHACH_TAI_QUAY')
  assert.equal(payPayload('cash', guestOrder, 5, 'k').paymentMethod, 'guest')

  // may vang lai ngoi may (userName = ten may) va hoi vien van la cash nhu cu
  const seated = orderOf({ userId: 4, userName: 'PC-07', hostName: 'PC-07' })
  assert.equal(dryRunPayload('cash', seated, 5).paymentMethod, 'cash')
  assert.equal(dryRunPayload('cash', seated, 5).hostName, 'PC-07')
  assert.equal(dryRunPayload('cash', orderOf(), 5).paymentMethod, 'cash')
})