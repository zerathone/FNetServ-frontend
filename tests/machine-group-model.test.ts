import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canEditAnonymPrice,
  canRequestMachineGroupDelete,
  matchesMachineGroup,
  validateMachineGroupCreateDraft,
  validateMachineGroupDraft,
  zeroPriceUserGroupIds,
} from '../src/features/machine-groups/machineGroupModel.ts'

const group = {
  id: 1,
  name: 'Máy VIP',
  description: 'Tầng 2',
  active: 1,
  anonymPrice: 0,
}

test('machine-group search and zero price preserve server semantics', () => {
  assert.equal(matchesMachineGroup(group, 'VIP'), true)
  assert.equal(matchesMachineGroup(group, 'tầng 2'), true)
  assert.equal(matchesMachineGroup(group, 'khác'), false)
  assert.equal(group.anonymPrice, 0)
})

test('machine-group price editing is locked when multiple ANONYM prices exist', () => {
  assert.equal(canEditAnonymPrice(group), true)
  assert.equal(
    canEditAnonymPrice({ ...group, anonymPriceAmbiguous: true }),
    false,
  )
  assert.equal(canRequestMachineGroupDelete(group), true)
  assert.equal(canRequestMachineGroupDelete({ ...group, active: 0 }), false)
})

test('machine-group draft keeps runtime MFC limits and backend price range', () => {
  assert.equal(
    validateMachineGroupDraft({
      name: 'Máy VIP',
      description: 'Tầng 2',
      anonymPrice: 0,
      priceEditable: true,
    }),
    null,
  )
  assert.match(
    validateMachineGroupDraft({
      name: 'x'.repeat(26),
      description: '',
      anonymPrice: null,
      priceEditable: true,
    }) ?? '',
    /25/,
  )
  assert.match(
    validateMachineGroupDraft({
      name: 'VIP',
      description: '',
      anonymPrice: 1_000_000,
      priceEditable: true,
    }) ?? '',
    /999.999/,
  )
})

test('machine-group create requires the completed usergroup price matrix', () => {
  assert.equal(
    validateMachineGroupCreateDraft({
      name: 'Khu mới',
      description: '',
      priceGroupIds: [10, 20],
      prices: { 10: 0, 20: 8_000 },
    }),
    null,
  )
  assert.match(
    validateMachineGroupCreateDraft({
      name: 'Khu mới',
      description: '',
      priceGroupIds: [10, 20],
      prices: { 10: 0, 20: null },
    }) ?? '',
    /mọi bảng giá/,
  )
  assert.deepEqual(zeroPriceUserGroupIds({ 10: 0, 20: 8_000 }, [10, 20]), [10])
})
