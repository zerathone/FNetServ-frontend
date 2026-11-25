import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecipeLine } from '../src/api/inventory.ts'
import type { ServiceItem, ServiceTopping } from '../src/api/services.ts'
import {
  hasRecipeConfig,
  hasToppingConfig,
  recipeCapacity,
  serviceStockView,
  toppingCapacity,
  toppingTagState,
} from '../src/features/services/serviceStockEstimate.ts'

function line(patch: Partial<RecipeLine> = {}): RecipeLine {
  return { materialId: 1, materialName: 'Sữa', unit: 'ml', qty: '150.000', wastePercent: '0.00', materialActive: 1, stockQty: '1000.000', ...patch }
}

function service(patch: Partial<ServiceItem> = {}): ServiceItem {
  return { id: 1, name: 'Trà sữa', price: 30000, unit: 'ly', inventory: 0, inventoryManagement: 0, ...patch }
}

function topping(patch: Partial<ServiceTopping> = {}): ServiceTopping {
  return {
    serviceId: 9,
    name: 'Bò thêm',
    unit: 'phần',
    price: 5000,
    toppingQty: '1.000',
    zMaterialId: 3,
    inventoryManagement: 0,
    inventory: 0,
    active: 1,
    materialName: 'Bò',
    materialUnit: 'phần',
    materialStock: '10.000',
    materialActive: 1,
    ...patch,
  }
}

test('recipeCapacity: lay MIN theo nguyen lieu, ghi nguyen lieu chan', () => {
  const cap = recipeCapacity([
    line({ materialId: 1, materialName: 'Sữa', qty: '150.000', stockQty: '1000.000' }), // 6
    line({ materialId: 2, materialName: 'Trà', qty: '10.000', stockQty: '35.000' }), // 3
    line({ materialId: 3, materialName: 'Đường', qty: '5.000', stockQty: '500.000' }), // 100
  ])
  assert.equal(cap?.portions, 3)
  assert.equal(cap?.limiter.materialName, 'Trà')
})

test('recipeCapacity: khong nhan hao hut; het nguyen lieu = 0; khong am', () => {
  assert.equal(recipeCapacity([line({ qty: '100.000', wastePercent: '50.00', stockQty: '250.000' })])?.portions, 2)
  assert.equal(recipeCapacity([line({ qty: '100.000', stockQty: '0.000' })])?.portions, 0)
  assert.equal(recipeCapacity([line({ qty: '100.000', stockQty: '-5.000' })])?.portions, 0)
})

test('recipeCapacity: so le milli khong troi (0.1 + 0.2)', () => {
  // 0.3 / 0.1 phai ra 3, khong phai 2 (loi so thuc)
  assert.equal(recipeCapacity([line({ qty: '0.100', stockQty: '0.300' })])?.portions, 3)
})

test('recipeCapacity: cong thuc rong / server cu thieu stockQty / dinh luong 0 -> khong tinh', () => {
  assert.equal(recipeCapacity(undefined), null)
  assert.equal(recipeCapacity([]), null)
  assert.equal(recipeCapacity([line({ stockQty: undefined })]), null)
  assert.equal(recipeCapacity([line({ qty: '0.000' })]), null)
  // dong dinh luong 0 bi bo qua, dong con lai van chan
  assert.equal(recipeCapacity([line({ qty: '0.000' }), line({ qty: '100.000', stockQty: '250.000' })])?.portions, 2)
})

test('toppingCapacity: nguyen lieu chia theo toppingQty; rong/<=0 tinh 1 (parity server)', () => {
  assert.deepEqual(toppingCapacity(topping({ toppingQty: '2.000', materialStock: '10.000' })), { portions: 5, basis: 'material' })
  assert.equal(toppingCapacity(topping({ toppingQty: '0.000', materialStock: '7.000' })).portions, 7)
  assert.equal(toppingCapacity(topping({ materialStock: '0.500' })).portions, 0)
})

test('toppingCapacity: thanh pham theo ton, topping thuong khong gioi han', () => {
  assert.deepEqual(toppingCapacity(topping({ zMaterialId: 0, inventoryManagement: 1, inventory: 4 })), { portions: 4, basis: 'inventory' })
  assert.deepEqual(toppingCapacity(topping({ zMaterialId: 0, inventoryManagement: 0 })), { portions: null, basis: 'none' })
})

test('toppingTagState: het hang / ngung ban / tooltip co ton va gia', () => {
  const out = toppingTagState(topping({ materialStock: '0.000' }))
  assert.equal(out.out, true)
  assert.match(out.detail, /hết hàng/)
  const ok = toppingTagState(topping())
  assert.equal(ok.out, false)
  assert.match(ok.detail, /~10 phần/)
  assert.match(ok.detail, /5\.000 đ/)
  const off = toppingTagState(topping({ active: 0, materialStock: '0.000' }))
  assert.equal(off.inactive, true)
  assert.match(off.detail, /ngừng bán/)
  assert.doesNotMatch(off.detail, /hết hàng/)
})

test('serviceStockView: khong quan ly ton + cong thuc -> uoc luong phan', () => {
  const v = serviceStockView(service({ recipe: [line({ qty: '150.000', stockQty: '1000.000' })] }))
  assert.equal(v.kind, 'estimate')
  if (v.kind === 'estimate') {
    assert.equal(v.amount, 6)
    assert.equal(v.unit, 'phần')
    assert.match(v.detail, /Sữa/)
  }
})

test('serviceStockView: quan ly ton + cong thuc -> lay so NHO HON', () => {
  const recipe = [line({ qty: '100.000', stockQty: '300.000' })] // 3 phan
  const capped = serviceStockView(service({ inventoryManagement: 1, inventory: 10, recipe }))
  assert.equal(capped.kind, 'managed')
  if (capped.kind === 'managed') assert.equal(capped.amount, 3)
  const own = serviceStockView(service({ inventoryManagement: 1, inventory: 2, recipe }))
  if (own.kind === 'managed') assert.equal(own.amount, 2)
})

test('serviceStockView: quan ly ton khong cong thuc -> giu nguyen ton thanh pham, khong detail', () => {
  const v = serviceStockView(service({ inventoryManagement: 1, inventory: 8 }))
  assert.deepEqual(v, { kind: 'managed', amount: 8, detail: null })
})

test('serviceStockView: mon la nguyen lieu -> ton nguyen lieu goc kem don vi cua nguyen lieu', () => {
  const v = serviceStockView(
    service({ material: { materialId: 3, name: 'Bò', unit: 'kg', stockQty: '12.500', active: 1 } }),
  )
  assert.equal(v.kind, 'estimate')
  if (v.kind === 'estimate') {
    assert.equal(v.amount, 12.5)
    assert.equal(v.unit, 'kg')
  }
})

test('serviceStockView: khong co gi de uoc luong / server cu -> none', () => {
  assert.deepEqual(serviceStockView(service()), { kind: 'none' })
  assert.deepEqual(serviceStockView(service({ recipe: [line({ stockQty: undefined })] })), { kind: 'none' })
})

test('hasRecipeConfig / hasToppingConfig: bo loc cong thuc va ban kem', () => {
  assert.equal(hasRecipeConfig(service()), false)
  assert.equal(hasRecipeConfig(service({ recipe: [] })), false)
  assert.equal(hasRecipeConfig(service({ recipe: [line()] })), true)
  // mon "la nguyen lieu" cung tinh la co cong thuc
  assert.equal(hasRecipeConfig(service({ material: { materialId: 3, name: 'Bo', unit: 'kg', stockQty: '1.000', active: 1 } })), true)
  assert.equal(hasToppingConfig(service()), false)
  assert.equal(hasToppingConfig(service({ toppings: [] })), false)
  assert.equal(hasToppingConfig(service({ toppings: [topping()] })), true)
})