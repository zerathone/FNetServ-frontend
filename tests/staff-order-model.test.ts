import assert from 'node:assert/strict'
import test from 'node:test'
import type { StaffOrderResponse } from '../src/api/orders.ts'
import type { ServiceItem } from '../src/api/services.ts'
import { MACHINE_STATUS, USER_GROUP } from '../src/features/orders/orderPayModel.ts'
import {
  CART_MAX_LINES,
  GUEST_HOST_NAME,
  acceptPayload,
  addToCart,
  availableMethods,
  buildCatalog,
  cartIssues,
  cartTotal,
  classifyStepFailure,
  describeSettled,
  failureActions,
  foldText,
  isCounterGuest,
  listMachineTargets,
  methodGates,
  payRequestPayloadOf,
  removeFromCart,
  sameTarget,
  setCartQuantity,
  settleFingerprint,
  staffOrderFingerprint,
  staffOrderPayload,
  stockLimit,
  type CartLine,
  type StaffOrderTarget,
} from '../src/features/orders/staffOrderModel.ts'

function service(patch: Partial<ServiceItem> = {}): ServiceItem {
  return {
    id: 1,
    name: 'Trà đá',
    price: 5_000,
    unit: 'ly',
    inventory: 0,
    inventoryManagement: 0,
    active: 1,
    groupId: 2,
    groupName: 'Đồ uống',
    ...patch,
  }
}

const member: StaffOrderTarget = { kind: 'member', userId: 7, hostName: 'PC-01', userName: 'an' }
const guest: StaffOrderTarget = { kind: 'guest' }

// ---- nhận diện vãng lai ----

test('isCounterGuest: nhan dien theo hostName KHACH_TAI_QUAY, hostName/userName KHACHVANGLAI; may ngoi that khong phai', () => {
  assert.equal(isCounterGuest({ hostName: 'KHACH_TAI_QUAY', userName: 'x' }), true)
  assert.equal(isCounterGuest({ hostName: ' khach_tai_quay ' }), true)
  assert.equal(isCounterGuest({ hostName: 'KHACHVANGLAI', userName: 'KHACHVANGLAI' }), true)
  assert.equal(isCounterGuest({ hostName: null, userName: 'KHACHVANGLAI' }), true)
  assert.equal(isCounterGuest({ hostName: 'PC-07', userName: 'PC-07' }), false)
  assert.equal(isCounterGuest({ hostName: 'PC-01', userName: 'an' }), false)
  assert.equal(isCounterGuest({}), false)
})

// ---- máy đang có khách ----

test('listMachineTargets: chi may co userId>0, sap theo ten may tu nhien, tim bo dau', () => {
  const machines = [
    { hostName: 'PC10', userId: 3, userName: 'Bình', userGroupType: USER_GROUP.member, status: MACHINE_STATUS.ONLINE },
    { hostName: 'PC2', userId: 4, userName: 'An', userGroupType: USER_GROUP.anonym, status: MACHINE_STATUS.ONLINE },
    { hostName: 'PC3', userId: 0, userName: null, userGroupType: 0, status: MACHINE_STATUS.AVAILABLE },
  ]
  assert.deepEqual(listMachineTargets(machines).map((m) => m.hostName), ['PC2', 'PC10'])
  assert.equal(listMachineTargets(machines)[0].kindLabel, 'Khách vãng lai (ngồi máy)')
  assert.deepEqual(listMachineTargets(machines, 'binh').map((m) => m.hostName), ['PC10'])
  assert.deepEqual(listMachineTargets(undefined), [])
})

test('listMachineTargets: tim theo truong Tai khoan / Ten may', () => {
  const machines = [
    { hostName: 'PC10', userId: 3, userName: 'pc2', userGroupType: USER_GROUP.member, status: MACHINE_STATUS.ONLINE },
    { hostName: 'PC2', userId: 4, userName: 'An', userGroupType: USER_GROUP.member, status: MACHINE_STATUS.ONLINE },
  ]
  assert.deepEqual(listMachineTargets(machines, 'pc2', 'host').map((m) => m.hostName), ['PC2'])
  assert.deepEqual(listMachineTargets(machines, 'pc2', 'customer').map((m) => m.hostName), ['PC10'])
  assert.deepEqual(listMachineTargets(machines, 'pc2').map((m) => m.hostName), ['PC2', 'PC10'])
})

test('foldText: bo dau + chu d', () => {
  assert.equal(foldText('  Trà Đá '), 'tra da')
})

test('sameTarget: member theo userId+hostName, guest chi bang guest', () => {
  assert.equal(sameTarget(member, { ...member }), true)
  assert.equal(sameTarget(member, { ...member, hostName: 'PC-02' }), false)
  assert.equal(sameTarget(member, guest), false)
  assert.equal(sameTarget(guest, guest), true)
  assert.equal(sameTarget(null, null), true)
  assert.equal(sameTarget(null, guest), false)
})

// ---- danh mục ----

test('buildCatalog: chi mon dang ban, nhom theo ten, mon khong nhom/nhom ma gom cuoi', () => {
  const catalog = buildCatalog([
    service({ id: 1, name: 'Trà đá', groupId: 2, groupName: 'Đồ uống' }),
    service({ id: 2, name: 'Mì tôm', groupId: 3, groupName: 'Đồ ăn' }),
    service({ id: 3, name: 'Món ngừng', active: 0 }),
    service({ id: 4, name: 'Khăn giấy', groupId: 0, groupName: '' }),
    service({ id: 5, name: 'Nhóm ma', groupId: 1, groupName: '' }),
    service({ id: 6, name: 'Cà phê', groupId: 2, groupName: 'Đồ uống' }),
  ])
  assert.deepEqual(catalog.map((g) => g.name), ['Đồ ăn', 'Đồ uống', 'Chưa phân nhóm'])
  assert.deepEqual(catalog[1].services.map((s) => s.name), ['Cà phê', 'Trà đá'])
  assert.deepEqual(catalog[2].services.map((s) => s.name), ['Khăn giấy', 'Nhóm ma'])
  assert.equal(catalog.flatMap((g) => g.services).some((s) => s.id === 3), false)
})

test('buildCatalog: server cu chua tra active/group => coi nhu dang ban, 1 nhom phang; tim khong dau', () => {
  const legacy = [
    { id: 1, name: 'Trà đá', price: 5000, unit: 'ly', inventory: 0, inventoryManagement: 0 },
    { id: 2, name: 'Mì tôm', price: 15000, unit: 'tô', inventory: 0, inventoryManagement: 0 },
  ] as ServiceItem[]
  assert.equal(buildCatalog(legacy).length, 1)
  assert.deepEqual(buildCatalog(legacy, 'tra da')[0].services.map((s) => s.id), [1])
  assert.deepEqual(buildCatalog(legacy, 'zzz'), [])
  assert.deepEqual(buildCatalog(undefined), [])
})

// ---- giỏ ----

test('addToCart/setCartQuantity: gop dong, kep 1..99, bo dong khi < 1 khong xay ra (kep ve 1)', () => {
  const tea = service()
  let cart: CartLine[] = []
  cart = addToCart(cart, tea)
  cart = addToCart(cart, tea)
  assert.deepEqual(cart, [{ serviceId: 1, quantity: 2 }])
  assert.equal(setCartQuantity(cart, tea, 500)[0].quantity, 99)
  assert.equal(setCartQuantity(cart, tea, 0)[0].quantity, 1)
  assert.equal(setCartQuantity(cart, tea, Number.NaN)[0].quantity, 1)
  assert.deepEqual(removeFromCart(cart, 1), [])
})

test('stockLimit/addToCart: mon quan ly kho bi chan o ton kho; het hang khong them duoc', () => {
  const stocked = service({ id: 9, inventoryManagement: 1, inventory: 3 })
  assert.equal(stockLimit(stocked), 3)
  let cart = addToCart([], stocked, 2)
  cart = addToCart(cart, stocked, 5)
  assert.equal(cart[0].quantity, 3)
  assert.deepEqual(addToCart([], service({ id: 10, inventoryManagement: 1, inventory: 0 })), [])
  assert.equal(stockLimit(service({ inventoryManagement: 0, inventory: 0 })), 99)
})

test('addToCart: toi da 50 dong', () => {
  let cart: CartLine[] = []
  for (let id = 1; id <= CART_MAX_LINES + 5; id += 1) cart = addToCart(cart, service({ id }))
  assert.equal(cart.length, CART_MAX_LINES)
  // dong da co van tang duoc khi gio day
  assert.equal(addToCart(cart, service({ id: 1 }))[0].quantity, 2)
})

test('cartTotal + cartIssues: tong tam tinh; mon ngung ban/ton kho giam sau khi bo vao gio', () => {
  const services = [
    service({ id: 1, price: 5_000 }),
    service({ id: 2, price: 12_000, inventoryManagement: 1, inventory: 2 }),
    service({ id: 3, active: 0 }),
  ]
  const cart: CartLine[] = [
    { serviceId: 1, quantity: 2 },
    { serviceId: 2, quantity: 4 },
    { serviceId: 3, quantity: 1 },
    { serviceId: 99, quantity: 1 },
  ]
  assert.equal(cartTotal(cart.slice(0, 2), services), 2 * 5_000 + 4 * 12_000)
  const issues = cartIssues(cart, services)
  assert.deepEqual(issues.map((i) => [i.serviceId, i.reason]), [[2, 'stock'], [3, 'unavailable'], [99, 'unavailable']])
  assert.equal(issues[0].limit, 2)
  assert.deepEqual(cartIssues(cart.slice(0, 1), services), [])
})

// ---- bước 1 ----

test('staffOrderPayload: hoi vien gui userId+hostName, vang lai gui anonymous + hostName KHACH_TAI_QUAY; khong gui gia', () => {
  const cart: CartLine[] = [{ serviceId: 9, quantity: 1 }, { serviceId: 3, quantity: 2 }]
  assert.deepEqual(staffOrderPayload(member, cart, 'k1'), {
    userId: 7,
    anonymous: false,
    hostName: 'PC-01',
    idem: 'k1',
    items: [{ serviceId: 3, quantity: 2 }, { serviceId: 9, quantity: 1 }],
  })
  const guestPayload = staffOrderPayload(guest, cart, 'k2')
  assert.equal(guestPayload.userId, 0)
  assert.equal(guestPayload.anonymous, true)
  assert.equal(guestPayload.hostName, GUEST_HOST_NAME)
  assert.equal(JSON.stringify(guestPayload).includes('price'), false)
})

test('staffOrderFingerprint: doi khach/mon/so luong => khac; doi thu tu them mon => giu nguyen', () => {
  const a: CartLine[] = [{ serviceId: 1, quantity: 1 }, { serviceId: 2, quantity: 1 }]
  const reordered: CartLine[] = [{ serviceId: 2, quantity: 1 }, { serviceId: 1, quantity: 1 }]
  const fp = (t: StaffOrderTarget, c: CartLine[]) => JSON.stringify(staffOrderFingerprint(t, c))
  assert.equal(fp(member, a), fp(member, reordered))
  assert.notEqual(fp(member, a), fp(guest, a))
  assert.notEqual(fp(member, a), fp({ ...member, userId: 8 }, a))
  assert.notEqual(fp(member, a), fp(member, [{ serviceId: 1, quantity: 2 }, { serviceId: 2, quantity: 1 }]))
})

// ---- bước 2 ----

const created = (patch: Partial<StaffOrderResponse> = {}): StaffOrderResponse => ({
  userId: 7,
  hostName: 'PC-01',
  anonymous: false,
  items: [
    { detailId: 30, serviceId: 1, quantity: 2, amount: 10_000 },
    { detailId: 12, serviceId: 2, quantity: 1, amount: 12_000 },
  ],
  amount: 22_000,
  inventoryWarnings: [],
  ...patch,
})

test('settleFingerprint: detailIds da sap xep + cach thu — doi cach thu la idem moi', () => {
  const key = (ids: number[], m: 'tab' | 'cash' | 'deduct') => JSON.stringify(settleFingerprint(ids, m))
  assert.equal(key([30, 12], 'cash'), key([12, 30], 'cash'))
  assert.notEqual(key([30, 12], 'cash'), key([30, 12], 'deduct'))
  assert.notEqual(key([30, 12], 'cash'), key([30], 'cash'))
})

test('acceptPayload: dung detailId cua buoc 1, alreadyPaid=false, fullCore, khong anonymous', () => {
  const payload = acceptPayload(created(), 5, 'idem-2')
  assert.equal(payload.userId, 7)
  assert.equal(payload.hostName, 'PC-01')
  assert.equal(payload.fullCore, true)
  assert.equal(payload.anonymous, undefined)
  assert.deepEqual(payload.items, [
    { detailId: 30, quantity: 2, amount: 10_000, alreadyPaid: false },
    { detailId: 12, quantity: 1, amount: 12_000, alreadyPaid: false },
  ])
})

test('payRequestPayloadOf: hoi vien theo cach thu; vang lai luon guest + hostName server tra', () => {
  const m = payRequestPayloadOf(created(), 'deduct', 5, 'idem-3')
  assert.equal(m.paymentMethod, 'deduct')
  assert.equal(m.fullCore, true)
  assert.equal(m.staffId, 5)
  const g = payRequestPayloadOf(
    created({ userId: 99, hostName: GUEST_HOST_NAME, anonymous: true }),
    'cash',
    5,
    'idem-4',
  )
  assert.equal(g.paymentMethod, 'guest')
  assert.equal(g.hostName, GUEST_HOST_NAME)
  assert.equal(g.userId, 99)
})

test('describeSettled: thong bao ngan theo cach xu ly, co so phieu + so tien', () => {
  assert.equal(describeSettled('cash', 123, 22_000), 'Đã thu tiền #123 22.000 đ')
  assert.equal(describeSettled('tab', 124, 5_000), 'Đã chấp nhận #124 5.000 đ')
  assert.equal(describeSettled('deduct', 125, 12_000), 'Đã cấn trừ #125 12.000 đ')
  assert.equal(describeSettled('cash', undefined, 0), 'Đã thu tiền 0 đ')
})

test('availableMethods + methodGates: vang lai chi tien mat; hoi vien theo may/quyen', () => {
  assert.deepEqual(availableMethods(guest), ['cash'])
  assert.deepEqual(availableMethods(member), ['tab', 'cash', 'deduct'])
  const guestGates = methodGates(guest, undefined, true)
  assert.equal(guestGates.cash.enabled, true)
  assert.equal(guestGates.tab.enabled, false)
  assert.equal(guestGates.deduct.enabled, false)

  const online = { status: MACHINE_STATUS.ONLINE, userId: 7, userGroupType: USER_GROUP.member }
  const ok = methodGates(member, online, true)
  assert.equal(ok.tab.enabled && ok.cash.enabled && ok.deduct.enabled, true)
  assert.equal(methodGates(member, online, false).deduct.enabled, false) // thieu quyen 9224
  assert.equal(methodGates(member, { ...online, userGroupType: USER_GROUP.anonym }, true).deduct.enabled, false)
  assert.equal(methodGates(member, { ...online, userId: 8 }, true).deduct.enabled, false) // doi nguoi tren may
  assert.equal(methodGates(member, undefined, true).deduct.enabled, true) // chua co du lieu may => fail-open
})

// ---- lỗi bước 2 ----

class FakeApiError extends Error {
  httpStatus: number
  code?: string
  constructor(message: string, httpStatus: number, code?: string) {
    super(message)
    this.name = 'ApiError'
    this.httpStatus = httpStatus
    this.code = code
  }
}

test('classifyStepFailure: ma nghiep vu = ro rang; timeout/mang/5xx/khong ma/db_error = mo ho', () => {
  assert.equal(classifyStepFailure(new FakeApiError('x', 200, 'member_offline')), 'clear')
  assert.equal(classifyStepFailure(new FakeApiError('x', 200, 'deduct_check_failed')), 'clear')
  assert.equal(classifyStepFailure(new FakeApiError('x', 403, 'RBAC_DENIED')), 'clear')
  assert.equal(classifyStepFailure(Object.assign(new Error('rbac'), { name: 'RbacDeniedError' })), 'clear')

  assert.equal(classifyStepFailure(new FakeApiError('x', 200)), 'ambiguous') // status=0 khong co code
  assert.equal(classifyStepFailure(new FakeApiError('x', 500, 'invalid_request')), 'ambiguous')
  assert.equal(classifyStepFailure(new FakeApiError('x', 200, 'db_error')), 'ambiguous')
  assert.equal(classifyStepFailure(new TypeError('Failed to fetch')), 'ambiguous')
  assert.equal(classifyStepFailure(undefined), 'ambiguous')
  assert.equal(classifyStepFailure('boom'), 'ambiguous')
})

test('failureActions: ro rang => thu lai/doi cach/huy; mo ho + manual-fix => CHI thu lai (khong huy)', () => {
  assert.deepEqual(failureActions('clear', false), { retry: true, changeMethod: true, cancel: true, suggestCancel: false })
  // vang lai: khong con cach thu nao khac, goi y huy
  assert.deepEqual(failureActions('clear', true), { retry: true, changeMethod: false, cancel: true, suggestCancel: true })
  for (const guestFlag of [false, true]) {
    for (const kind of ['ambiguous', 'manual-fix'] as const) {
      assert.deepEqual(failureActions(kind, guestFlag), {
        retry: true,
        changeMethod: false,
        cancel: false,
        suggestCancel: false,
      })
    }
  }
})
