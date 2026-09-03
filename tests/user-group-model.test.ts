import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canManageUserGroup,
  canRequestUserGroupDelete,
  groupUserGroupsByType,
  supportsUserGroupPricingAndPromotion,
  userGroupTypeLabel,
  validateUserGroupDraft,
  zeroPriceMachineGroupIds,
} from '../src/features/user-groups/userGroupModel.ts'

const memberGroup = {
  id: 1,
  name: 'Hội viên VIP',
  type: 'member' as const,
  typeCode: 2 as const,
  active: true,
  prices: { 10: 10_000, 20: 0 },
}

test('user-group type mapping keeps ADMIN distinct and only legacy price types editable', () => {
  assert.equal(userGroupTypeLabel('admin'), 'Quản trị hệ thống')
  assert.equal(canManageUserGroup(memberGroup), true)
  assert.equal(
    canManageUserGroup({
      ...memberGroup,
      type: 'admin',
      typeCode: 3,
    }),
    false,
  )
  for (const [type, typeCode] of [
    ['admin', 3],
    ['staff', 4],
    ['combo', 5],
  ] as const) {
    assert.equal(
      supportsUserGroupPricingAndPromotion({ ...memberGroup, type, typeCode }),
      false,
    )
  }
})

test('user groups render as ordered type trees without a duplicate type column', () => {
  const sections = groupUserGroupsByType([
    { ...memberGroup, id: 3, name: 'Hội viên VIP' },
    { ...memberGroup, id: 1, name: 'Khách vãng lai', type: 'anonym', typeCode: 1 },
    { ...memberGroup, id: 4, name: 'Nhân viên', type: 'staff', typeCode: 4 },
    { ...memberGroup, id: 2, name: 'Hội viên thường' },
  ])

  assert.deepEqual(
    sections.map((section) => [section.type, section.groups.map((group) => group.id)]),
    [
      ['anonym', [1]],
      ['member', [3, 2]],
      ['staff', [4]],
    ],
  )
})

test('user-group delete keeps active and type guards from the MFC list', () => {
  assert.equal(canRequestUserGroupDelete(memberGroup), true)
  assert.equal(
    canRequestUserGroupDelete({ ...memberGroup, active: false }),
    false,
  )
  assert.equal(
    canRequestUserGroupDelete({
      ...memberGroup,
      type: 'combo',
      typeCode: 5,
    }),
    false,
  )
})

test('user-group matrix requires every machine group and confirms explicit zero prices', () => {
  assert.equal(
    validateUserGroupDraft({
      name: memberGroup.name,
      prices: memberGroup.prices,
      machineGroupIds: [10, 20],
    }),
    null,
  )
  assert.match(
    validateUserGroupDraft({
      name: memberGroup.name,
      prices: { 10: 10_000 },
      machineGroupIds: [10, 20],
    }) ?? '',
    /tất cả nhóm máy/,
  )
  assert.deepEqual(
    zeroPriceMachineGroupIds(memberGroup.prices, [10, 20]),
    [20],
  )
})
