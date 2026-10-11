import assert from 'node:assert/strict'
import test from 'node:test'
import type { WorkstationComboItem, WorkstationOrderItem } from '../src/api/workstations.ts'
import {
  groupMachineOrders,
  machineOrdersSummary,
  machineOrdersWaitingTotal,
  parseOrderTime,
  splitMachineOrders,
} from '../src/features/workstations/machineOrdersModel.ts'

function item(patch: Partial<WorkstationOrderItem> & { serviceDetailId: number }): WorkstationOrderItem {
  return {
    status: 'waiting',
    serviceName: 'Coca',
    quantity: 1,
    unit: 'lon',
    amount: 10000,
    serviceDate: '2026-10-11',
    serviceTime: '10:30:00',
    voucherId: 0,
    parentId: 0,
    topping: 0,
    ...patch,
  }
}

function combo(patch: Partial<WorkstationComboItem> & { comboCardId: number }): WorkstationComboItem {
  return {
    comboName: 'Combo 3 gio',
    price: 50000,
    status: 'waiting',
    createdAt: '2026-10-11 10:42:00',
    ...patch,
  }
}

const summary = (patch: Partial<Parameters<typeof machineOrdersSummary>[0]> = {}) => ({
  orderedCount: 0,
  waitingCount: 0,
  comboCount: 0,
  comboWaitingCount: 0,
  ...patch,
})

test('moi goi xep truoc, dong thieu gio xep cuoi', () => {
  const lines = groupMachineOrders([
    item({ serviceDetailId: 1, serviceTime: '10:10:00' }),
    item({ serviceDetailId: 2, serviceTime: '10:40:00' }),
    item({ serviceDetailId: 3, serviceDate: '', serviceTime: '' }),
    item({ serviceDetailId: 4, serviceTime: '10:20:00' }),
  ])
  assert.deepEqual(lines.map((line) => line.id), [2, 4, 1, 3])
})

test('topping gom vao mon chinh', () => {
  const lines = groupMachineOrders([
    item({ serviceDetailId: 10, serviceName: 'Tra sua', quantity: 2 }),
    item({ serviceDetailId: 11, serviceName: 'Tran chau', parentId: 10, topping: 1, quantity: 2 }),
  ])
  assert.equal(lines.length, 1)
  assert.deepEqual(lines[0]?.toppings.map((topping) => topping.name), ['Tran chau'])
})

test('topping mo coi (mon chinh khong co trong danh sach) van hien nhu mot dong', () => {
  const lines = groupMachineOrders([item({ serviceDetailId: 11, serviceName: 'Tran chau', parentId: 99 })])
  assert.equal(lines.length, 1)
  assert.equal(lines[0]?.toppings.length, 0)
})

test('DB chua co schema topping (parentId null) thi moi dong la mon chinh', () => {
  const lines = groupMachineOrders([
    item({ serviceDetailId: 1, parentId: null, topping: null }),
    item({ serviceDetailId: 2, parentId: null, topping: null }),
  ])
  assert.equal(lines.length, 2)
})

test('combo tron vao danh sach theo gio mua, mon va combo trung id khong de len nhau', () => {
  const lines = groupMachineOrders(
    [item({ serviceDetailId: 7, serviceTime: '10:30:00' })],
    [combo({ comboCardId: 7, createdAt: '2026-10-11 10:42:00' })],
  )
  assert.deepEqual(lines.map((line) => `${line.kind}-${line.id}`), ['combo-7', 'service-7'])
  assert.equal(lines[0]?.quantity, 1)
  assert.equal(lines[0]?.amount, 50000)
  assert.deepEqual(lines[0]?.toppings, [])
})

test('chia khu: cho duyet len tren, con lai (da duyet / da thu) o duoi; combo da chot nam o duoi', () => {
  const lines = groupMachineOrders(
    [
      item({ serviceDetailId: 1, status: 'accepted', serviceTime: '10:10:00' }),
      item({ serviceDetailId: 2, status: 'waiting', serviceTime: '10:20:00' }),
    ],
    [combo({ comboCardId: 3, status: 'waiting' }), combo({ comboCardId: 4, status: 'paid', createdAt: '2026-10-11 09:00:00' })],
  )
  const { waiting, done } = splitMachineOrders(lines)
  assert.deepEqual(waiting.map((line) => `${line.kind}-${line.id}`), ['combo-3', 'service-2'])
  assert.deepEqual(done.map((line) => `${line.kind}-${line.id}`), ['service-1', 'combo-4'])
})

test('server cu chua tra combo thi van chay', () => {
  assert.equal(groupMachineOrders([item({ serviceDetailId: 1 })]).length, 1)
})

test('parseOrderTime: thieu hoac sai dinh dang -> 0', () => {
  assert.equal(parseOrderTime('', ''), 0)
  assert.equal(parseOrderTime('2026-10-11', 'abc'), 0)
  assert.ok(parseOrderTime('2026-10-11', '10:00:00') > 0)
})

test('dong tom tat: chi nhac phan co so, don cho gop mon + combo', () => {
  assert.equal(machineOrdersSummary(summary()), 'Chưa gọi món')
  assert.equal(
    machineOrdersSummary(summary({ orderedCount: 6, waitingCount: 2 })),
    '6 món đã gọi · 2 đang chờ',
  )
  assert.equal(
    machineOrdersSummary(summary({ orderedCount: 3, waitingCount: 1, comboCount: 2, comboWaitingCount: 1 })),
    '3 món đã gọi · 2 combo · 2 đang chờ',
  )
  assert.equal(machineOrdersSummary(summary({ comboCount: 1 })), '1 combo')
  assert.equal(machineOrdersSummary(summary({ comboCount: 1, comboWaitingCount: 1 })), '1 combo · 1 đang chờ')
  assert.equal(machineOrdersWaitingTotal(summary({ waitingCount: 2, comboWaitingCount: 1 })), 3)
})
