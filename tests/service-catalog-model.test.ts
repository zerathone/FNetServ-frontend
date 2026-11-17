import assert from 'node:assert/strict'
import test from 'node:test'
import type { ServiceGroupRow } from '../src/api/serviceCatalog.ts'
import type { ServiceItem } from '../src/api/services.ts'
import {
  VAT_NONE,
  dataUrlBytes,
  draftFromGroup,
  draftFromService,
  emptyServiceDraft,
  fitWithin,
  groupChoices,
  groupSaveBody,
  groupTypeLocked,
  inventoryFlagChanged,
  isDiscontinued,
  isValidVat,
  isReadonlyService,
  nextGroupOrder,
  parseNonNegativeInt,
  parsePrice,
  pendingOrdersOf,
  planGroupMove,
  serviceSaveBody,
  validateCatalogName,
  validateGroupDraft,
  validateServiceDraft,
  validateServiceName,
  vatLabel,
  vatOptions,
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
  assert.equal(validateGroupDraft({ name: 'Đồ ăn', typeId: 0 }), null)
  assert.ok(validateGroupDraft({ name: '', typeId: 0 }))
  assert.equal(nextGroupOrder([]), 1)
  assert.equal(nextGroupOrder([group({ sortOrder: 3 }), group({ groupId: 9, sortOrder: 1 })]), 4)
  assert.equal(nextGroupOrder([group({ sortOrder: 255 })]), 255)
})

test('planGroupMove: sortOrder khac nhau -> doi cho 2 nhom ke nhau; bien -> khong lam gi', () => {
  const rows = [
    group({ groupId: 1, name: 'A', sortOrder: 1 }),
    group({ groupId: 2, name: 'B', sortOrder: 5 }),
    group({ groupId: 3, name: 'C', sortOrder: 9 }),
  ]
  assert.deepEqual(planGroupMove(rows, 2, 1), [
    { groupId: 2, name: 'B', sortOrder: 9 },
    { groupId: 3, name: 'C', sortOrder: 5 },
  ])
  assert.deepEqual(planGroupMove(rows, 2, -1), [
    { groupId: 2, name: 'B', sortOrder: 1 },
    { groupId: 1, name: 'A', sortOrder: 5 },
  ])
  assert.deepEqual(planGroupMove(rows, 1, -1), [])
  assert.deepEqual(planGroupMove(rows, 3, 1), [])
  assert.deepEqual(planGroupMove(rows, 99, 1), [])
})

test('planGroupMove: sortOrder trung (nhom cu toan 0) -> danh lai 1..N theo thu tu dang thay', () => {
  const rows = [
    group({ groupId: 1, name: 'A', sortOrder: 0 }),
    group({ groupId: 2, name: 'B', sortOrder: 0 }),
    group({ groupId: 3, name: 'C', sortOrder: 0 }),
  ]
  // dang thay A,B,C -> keo C len = A,C,B
  assert.deepEqual(planGroupMove(rows, 3, -1), [
    { groupId: 1, name: 'A', sortOrder: 1 },
    { groupId: 3, name: 'C', sortOrder: 2 },
    { groupId: 2, name: 'B', sortOrder: 3 },
  ])
})

test('groupSaveBody: tao gui typeId + thu tu cuoi; sua giu thu tu cu, chi gui typeId khi doi that (nhom loai la khong bi ghi de)', () => {
  const created = groupSaveBody({ name: ' Topping ', typeId: 2 }, null, 4)
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

// ---- VAT + anh ----

test('VAT: -1 (khong ap dung) va 0 (thue 0%) la hai gia tri rieng; tag them muc la neu ngoai danh sach chon nhanh', () => {
  assert.equal(VAT_NONE, -1)
  assert.notEqual(vatLabel(VAT_NONE), vatLabel(0))
  assert.equal(vatLabel(-1), 'Không áp dụng thuế')
  assert.equal(vatLabel(0), '0%')
  assert.equal(isValidVat(-1) && isValidVat(0) && isValidVat(100), true)
  assert.equal(isValidVat(-2) || isValidVat(101) || isValidVat(5.5), false)
  assert.deepEqual(vatOptions(8), [-1, 0, 5, 8, 10])
  assert.deepEqual(vatOptions(3), [-1, 0, 5, 8, 10, 3]) // muc la co san trong DB van hien de khong mat
  assert.deepEqual(vatOptions(-1), [-1, 0, 5, 8, 10])
})

test('VAT trong draft/body: server cu (khong vatPercent) khong gui; sua chi gui khi doi; them chi gui khi khac -1', () => {
  assert.equal(draftFromService(service()).vat, -1) // thieu field -> khong ap dung
  assert.equal(draftFromService(service({ vatPercent: 0 })).vat, 0)
  assert.ok(validateServiceDraft({ ...emptyServiceDraft(), name: 'x', price: '1', groupId: 1, vat: 101 }))

  const base = { ...emptyServiceDraft(), name: 'Trà', price: '5000', groupId: 2 }
  // them
  assert.equal('vatPercent' in serviceSaveBody({ ...base, vat: -1 }, null), false)
  assert.equal(serviceSaveBody({ ...base, vat: 0 }, null).vatPercent, 0) // 0% phai gui (khac -1)
  assert.equal(serviceSaveBody({ ...base, vat: 10 }, null).vatPercent, 10)
  // sua
  const old = service({ vatPercent: 8 })
  assert.equal('vatPercent' in serviceSaveBody({ ...draftFromService(old) }, old), false)
  assert.equal(serviceSaveBody({ ...draftFromService(old), vat: -1 }, old).vatPercent, -1)
  assert.equal(serviceSaveBody({ ...draftFromService(old), vat: 0 }, old).vatPercent, 0)
  const noVat = service() // server cu / DB thieu cot
  assert.equal('vatPercent' in serviceSaveBody({ ...draftFromService(noVat), vat: 10 }, noVat), false)
})

test('fitWithin: chi thu nho, giu ti le, khong phong to', () => {
  assert.deepEqual(fitWithin(300, 200), { width: 300, height: 200 })
  assert.deepEqual(fitWithin(1200, 600), { width: 600, height: 300 })
  assert.deepEqual(fitWithin(600, 1800), { width: 200, height: 600 })
  assert.deepEqual(fitWithin(4000, 1), { width: 600, height: 1 })
  assert.deepEqual(fitWithin(0, 100), { width: 0, height: 0 })
})

test('dataUrlBytes: so byte that cua base64 (tinh dau =)', () => {
  assert.equal(dataUrlBytes('data:image/png;base64,QQ=='), 1) // "A"
  assert.equal(dataUrlBytes('data:image/png;base64,QUI='), 2) // "AB"
  assert.equal(dataUrlBytes('data:image/png;base64,QUJD'), 3) // "ABC"
  assert.equal(dataUrlBytes(''), 0)
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
