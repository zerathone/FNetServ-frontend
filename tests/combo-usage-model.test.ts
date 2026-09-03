import assert from 'node:assert/strict'
import test from 'node:test'
import type { Combo } from '../src/api/combo.ts'
import { comboUsagePresentation } from '../src/features/checkout/comboUsageModel.ts'

function combo(): Combo {
  return {
    comboId: 1,
    name: 'Combo test',
    price: 50_000,
    type: 1,
    preAlias: 'CB',
    status: 1,
    order: 1,
    numOfDay: 1,
    weekday: 127,
    include: '',
    duration: 3,
    saleFrom: '00:00:00',
    saleTo: '00:00:00',
    display: 1,
    salableNow: true,
    usageMode: 'fixed_window',
    donates: [],
    machineGroups: [
      {
        machineGroupId: 1,
        name: 'FPS',
        fromTime: 8,
        toTime: 22,
        usageState: 'usable',
        usableNow: true,
        nextUsableAtMs: 1_000,
        nextTransitionAtMs: 5_000,
      },
      {
        machineGroupId: 2,
        name: 'VIP',
        fromTime: 10,
        toTime: 20,
        usageState: 'starts_later',
        usableNow: false,
        nextUsableAtMs: 3_600_000,
        nextTransitionAtMs: 3_600_000,
      },
    ],
  }
}

test('combo usage remains per machine group instead of collapsing all zones', () => {
  assert.equal(comboUsagePresentation(combo(), null, 0)?.label, '1/2 nhóm dùng được')
  assert.equal(comboUsagePresentation(combo(), 1, 0)?.label, 'Dùng được bây giờ')
  assert.equal(comboUsagePresentation(combo(), 2, 0)?.label, 'Dùng được 1 giờ nữa')
})

test('duration mode never invents an end time when backend returns null transition', () => {
  const item = combo()
  item.type = 2
  item.usageMode = 'duration'
  item.machineGroups = [{ ...item.machineGroups[0], nextTransitionAtMs: null }]
  const result = comboUsagePresentation(item, 1, 2_000)
  assert.equal(result?.usableNow, true)
  assert.equal(result?.nextTransitionAtMs, null)
})
