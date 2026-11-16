import assert from 'node:assert/strict'
import test from 'node:test'
import type { ServiceGroupRow } from '../src/api/serviceCatalog.ts'
import type { ServiceItem } from '../src/api/services.ts'
import {
  draftFromGroup,
  draftFromService,
  emptyServiceDraft,
  groupChoices,
  groupSaveBody,
  groupTypeLocked,
  inventoryFlagChanged,
  isDiscontinued,
  isReadonlyService,
  nextGroupOrder,
  parseNonNegativeInt,
  parsePrice,
  pendingOrdersOf,
  serviceSaveBody,
  validateCatalogName,
  validateGroupDraft,
  validateServiceDraft,
  validateServiceName,
  warningToInput,
} from '../src/features/services/serviceCatalogModel.ts'

function service(patch: Partial<ServiceItem> = {}): ServiceItem {
  return {
    id: 7,
    name: 'Trà đá',
    price: 5_000,
    unit: 'ly',
    inventory: 0,
    inventoryManagement: 0,
    active: 1,
    groupId: 2,
    groupName: 'Đồ uống',
    unitId: 3,
    warningInventory: 0,
    groupTypeId: 0,
    groupActive: 1,
    readonly: false,
    ...patch,
  }
}

function group(patch: Partial<ServiceGroupRow> = {}): ServiceGroupRow {
  return { groupId: 2, name: 'Đồ uống', sortOrder: 1, active: 1, typeId: 0, serviceCount: 0, ...patch }
}

// ---- tên / giá ----

test('validateCatalogName: cat khoang trang, 1..50 ky tu, chan ky tu dieu khien va emoji', () => {
  assert.equal(validateCatalogName('  Trà đá  '), null)
  assert.ok(validateCatalogName('   '))
  assert.ok(validateCatalogName(''))
  assert.equal(validateCatalogName('a'.repeat(50)), null)
  assert.ok(validateCatalogName('a'.repeat(51)))
  assert.ok(validateCatalogName('Tra\tda'))
  assert.ok(validateCatalogName('Trà 😀'))
})

test('validateServiceName: cam ten he thong FFOOD (khong phan biet hoa thuong)', () => {
  assert.ok(validateServiceName('ffood'))
  assert.ok(validateServiceName(' FFood '))
  assert.equal(validateServiceName('FFood nuong'), null)
})

test('parsePrice: nguyen dong, chap nhan cham nghin, tu choi so le/am/chu/dau phay/qua lon', () => {
  assert.equal(parsePrice('15000'), 15_000)
  assert.equal(parsePrice(' 15.000 '), 15_000)
  assert.equal(parsePrice('0'), 0)
  assert.equal(parsePrice('999999999'), 999_999_999)
  assert.equal(parsePrice('999.999.999'), 999_999_999)
  assert.equal(parsePrice('1.000.000.000'), null)
  assert.equal(parsePrice('1000000000'), null)
  for (const bad of ['', '-1', '15,5', '15.5', '1.5.000', 'abc', '1e3', '15 000', '١٢']) {
    assert.equal(parsePrice(bad), null, bad)
  }
})

test('parseNonNegativeInt: so nguyen khong am, co tran', () => {
  assert.equal(parseNonNegativeInt('0'), 0)
  assert.equal(parseNonNegativeInt(' 12 '), 12)
  assert.equal(parseNonNegativeInt('-1'), null)
  assert.equal(parseNonNegativeInt('1.5'), null)
  assert.equal(parseNonNegativeInt('256', 255), null)
  assert.equal(parseNonNegativeInt('255', 255), 255)
})

// ---- form dich vu ----

test('validateServiceDraft: can ten, gia hop le, da chon nhom; canh bao chi xet khi bat quan ly ton', () => {
  const ok = { ...emptyServiceDraft(), name: 'Mì tôm', price: '15000', groupId: 2 }
  assert.equal(validateServiceDraft(ok), null)
  assert.ok(validateServiceDraft({ ...ok, groupId: 0 }))
  assert.ok(validateServiceDraft({ ...ok, price: '15,5' }))
  assert.ok(validateServiceDraft({ ...ok, name: '' }))
  assert.ok(validateServiceDraft({ ...ok, inventoryManagement: true, warning: '-3' }))
  // tat quan ly ton => o canh bao bi bo qua, ke ca rac
  assert.equal(validateServiceDraft({ ...ok, inventoryManagement: false, warning: 'abc' }), null)
  assert.equal(validateServiceDraft({ ...ok, inventoryManagement: true, warning: '' }), null)
})

test('warningToInput: <=0 (ke ca -1 cua Qt cu) la khong canh bao => o trong', () => {
  assert.equal(warningToInput(-1), '')
  assert.equal(warningToInput(0), '')
  assert.equal(warningToInput(undefined), '')
  assert.equal(warningToInput(5), '5')
})

test('serviceSaveBody: TAO gui active + unitId, khong gui serviceId; khong bao gio gui chuoi Unit/ton/z*', () => {
  const draft = { ...emptyServiceDraft(), name: '  Mì tôm ', price: '15.000', unitId: 3, groupId: 2, active: false }
  const body = serviceSaveBody(draft, null)
  assert.deepEqual(body, {
    name: 'Mì tôm',
    price: 15_000,
    groupId: 2,
    inventoryManagement: false,
    unitId: 3,
    active: false,
  })
  for (const key of ['serviceId', 'unit', 'inventory', 'zType', 'warningInventory']) {
    assert.equal(key in body, false, key)
  }
})

test('serviceSaveBody: SUA gui serviceId, KHONG gui active (Q7)', () => {
  const original = service()
  const body = serviceSaveBody({ ...draftFromService(original), price: '6000', active: false }, original)
  assert.equal(body.serviceId, 7)
  assert.equal(body.price, 6_000)
  assert.equal('active' in body, false)
  assert.equal(body.unitId, 3)
})

test('serviceSaveBody: server cu khong tra unitId => khong ghi de don vi bang 0', () => {
  const legacy = service({ unitId: undefined })
  const body = serviceSaveBody(draftFromService(legacy), legacy)
  assert.equal('unitId' in body, false)
  // nguoi dung chon don vi that thi van gui
  assert.equal(serviceSaveBody({ ...draftFromService(legacy), unitId: 4 }, legacy).unitId, 4)
})

test('serviceSaveBody: canh bao ton - bat thi gui, o trong => 0, giu nguyen -1 cua Qt cu khi khong dung toi', () => {
  const managed = { ...emptyServiceDraft(), name: 'Redbull', price: '15000', groupId: 2, inventoryManagement: true }
  assert.equal(serviceSaveBody({ ...managed, warning: '5' }, null).warningInventory, 5)
  assert.equal(serviceSaveBody({ ...managed, warning: '' }, null).warningInventory, 0)

  const qtOld = service({ inventoryManagement: 1, warningInventory: -1 })
  assert.equal('warningInventory' in serviceSaveBody(draftFromService(qtOld), qtOld), false)
  assert.equal(serviceSaveBody({ ...draftFromService(qtOld), warning: '3' }, qtOld).warningInventory, 3)

  // tat quan ly ton => khong gui canh bao (server ghi 0)
  assert.equal('warningInventory' in serviceSaveBody({ ...managed, inventoryManagement: false, warning: '9' }, null), false)
})

test('inventoryFlagChanged: chi true khi sua va co doi that', () => {
  const original = service({ inventoryManagement: 0 })
  assert.equal(inventoryFlagChanged(original, { ...draftFromService(original), inventoryManagement: true }), true)
  assert.equal(inventoryFlagChanged(original, draftFromService(original)), false)
  assert.equal(inventoryFlagChanged(null, { ...emptyServiceDraft(), inventoryManagement: true }), false)
})

test('isReadonlyService / isDiscontinued: field thieu (server cu) => khong chi doc, dang ban', () => {
  assert.equal(isReadonlyService({ readonly: true }), true)
  assert.equal(isReadonlyService({ readonly: false }), false)
  assert.equal(isReadonlyService({}), false)
  assert.equal(isDiscontinued({ active: 0 }), true)
  assert.equal(isDiscontinued({ active: 1 }), false)
  assert.equal(isDiscontinued({}), false)
})

// ---- nhom ----

test('groupChoices: chi nhom dang dung, chia thuong/topping, giu nhom hien tai du da ngung', () => {
  const groups = [
    group({ groupId: 1, name: 'B', sortOrder: 2 }),
    group({ groupId: 2, name: 'A', sortOrder: 1 }),
    group({ groupId: 3, name: 'Topping', typeId: 2, sortOrder: 5 }),
    group({ groupId: 4, name: 'Cu', active: 0, sortOrder: 0 }),
    group({ groupId: 5, name: 'Topping cu', typeId: 2, active: 0 }),
  ]
  const choices = groupChoices(groups)
  assert.deepEqual(choices.normal.map((g) => g.groupId), [2, 1])
  assert.deepEqual(choices.topping.map((g) => g.groupId), [3])
  const keepCurrent = groupChoices(groups, 4)
  assert.deepEqual(keepCurrent.normal.map((g) => g.groupId), [4, 2, 1])
})

test('groupTypeLocked (Q10): khoa khi nhom con mon, ke ca mon ngung ban; nhom moi (null) khong khoa', () => {
  assert.equal(groupTypeLocked(group({ serviceCount: 3 })), true)
  assert.equal(groupTypeLocked(group({ serviceCount: 0 })), false)
  assert.equal(groupTypeLocked(null), false)
})

test('validateGroupDraft + nextGroupOrder', () => {
  assert.equal(validateGroupDraft({ name: 'Đồ ăn', sortOrder: '3', typeId: 0 }), null)
  assert.ok(validateGroupDraft({ name: '', sortOrder: '3', typeId: 0 }))
  assert.ok(validateGroupDraft({ name: 'x', sortOrder: '256', typeId: 0 }))
  assert.ok(validateGroupDraft({ name: 'x', sortOrder: '-1', typeId: 0 }))
  assert.equal(nextGroupOrder([]), 1)
  assert.equal(nextGroupOrder([group({ sortOrder: 3 }), group({ groupId: 9, sortOrder: 1 })]), 4)
  assert.equal(nextGroupOrder([group({ sortOrder: 255 })]), 255)
})

test('groupSaveBody: tao gui typeId; sua chi gui typeId khi doi that (nhom loai la khong bi ghi de)', () => {
  const created = groupSaveBody({ name: ' Topping ', sortOrder: '4', typeId: 2 }, null)
  assert.deepEqual(created, { name: 'Topping', sortOrder: 4, typeId: 2 })

  const original = group({ groupId: 9, typeId: 0 })
  const rename = groupSaveBody({ ...draftFromGroup(original), name: 'Đồ uống lạnh' }, original)
  assert.deepEqual(rename, { groupId: 9, name: 'Đồ uống lạnh', sortOrder: 1 })
  assert.equal('typeId' in rename, false)

  const retype = groupSaveBody({ ...draftFromGroup(original), typeId: 2 }, original)
  assert.equal(retype.typeId, 2)

  // loai la (1) giu nguyen khi chi doi ten: draft quy ve 0 nhung khong duoc gui nhu "da doi"
  const odd = group({ groupId: 8, typeId: 1 })
  assert.equal('typeId' in groupSaveBody({ ...draftFromGroup(odd), name: 'Moi' }, odd), false)
})

// ---- loi tu server ----

test('pendingOrdersOf: chi nhan ma pending_orders, lay orders + total; thieu field khong vo', () => {
  const orders = [{ serviceDetailId: 1 }, { serviceDetailId: 2 }]
  const info = pendingOrdersOf({ code: 'pending_orders', details: { total: 55, orders } })
  assert.equal(info?.total, 55)
  assert.equal(info?.orders.length, 2)
  assert.equal(pendingOrdersOf({ code: 'pending_orders', details: { orders } })?.total, 2)
  assert.deepEqual(pendingOrdersOf({ code: 'pending_orders' }), { total: 0, orders: [] })
  assert.equal(pendingOrdersOf({ code: 'duplicate_name' }), null)
  assert.equal(pendingOrdersOf(undefined), null)
  assert.equal(pendingOrdersOf(new Error('x')), null)
})
