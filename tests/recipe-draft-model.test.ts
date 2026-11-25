import assert from 'node:assert/strict'
import test from 'node:test'
import type { RecipeConfig } from '../src/api/inventory.ts'
import {
  emptyRecipeDraft,
  emptyToppingDraft,
  recipeChanged,
  recipeDraftForGroup,
  recipeDraftFromConfig,
  recipeSaveBody,
  setRecipeEnabled,
  toppingChanged,
  toppingDraftFromConfig,
  toppingSaveBody,
  trimDecimal,
  validateRecipe,
  validateTopping,
} from '../src/features/inventory/recipeDraftModel.ts'

function config(patch: Partial<RecipeConfig> = {}): RecipeConfig {
  return { supported: true, recipe: [], toppings: [], ...patch }
}

const recipeLine = { materialId: 5, materialName: 'Sữa', unit: 'ml', qty: '150.000', wastePercent: '2.50', materialActive: 1 }
const toppingLine = {
  toppingId: 1,
  serviceId: 9,
  name: 'Trân châu',
  unit: 'phần',
  toppingQty: '1.000',
  topPrice: '0.000',
  zMaterialId: 3,
  inventoryManagement: 0,
  active: 1,
}

test('trimDecimal: bo so 0 thua, 0 -> rong', () => {
  assert.equal(trimDecimal('1.500'), '1.5')
  assert.equal(trimDecimal('2.000'), '2')
  assert.equal(trimDecimal('0.000'), '')
  assert.equal(trimDecimal('abc'), 'abc')
})

test('recipeDraftFromConfig: chon che do theo zMaterialId / so dong', () => {
  assert.equal(recipeDraftFromConfig(config()).mode, 'none')
  assert.equal(recipeDraftFromConfig(config({ recipe: [recipeLine] })).mode, 'recipe')
  const direct = recipeDraftFromConfig(config({ zMaterialId: 7 }))
  assert.equal(direct.mode, 'material')
  assert.equal(direct.materialId, 7)
  const line = recipeDraftFromConfig(config({ recipe: [recipeLine] })).lines[0]
  assert.equal(line.qty, '150')
  assert.equal(line.waste, '2.5')
})

test('validateRecipe: recipe can >=1 dong hop le, material can chon nguyen lieu, none luon hop le', () => {
  assert.equal(validateRecipe(emptyRecipeDraft()), null)
  assert.ok(validateRecipe({ mode: 'recipe', lines: [], materialId: 0 }))
  assert.ok(validateRecipe({ mode: 'material', lines: [], materialId: 0 }))
  assert.equal(validateRecipe({ mode: 'material', lines: [], materialId: 4 }), null)
  assert.equal(
    validateRecipe({ mode: 'recipe', lines: [{ key: 'a', materialId: 5, qty: '1.5', waste: '' }], materialId: 0 }),
    null,
  )
  assert.ok(validateRecipe({ mode: 'recipe', lines: [{ key: 'a', materialId: 5, qty: '0', waste: '' }], materialId: 0 }))
})

test('recipeSaveBody: none -> lines rong (go cong thuc); material -> materialId; recipe -> lines', () => {
  assert.deepEqual(recipeSaveBody(3, emptyRecipeDraft()), { serviceId: 3, lines: [] })
  assert.deepEqual(recipeSaveBody(3, { mode: 'material', lines: [], materialId: 7 }), { serviceId: 3, materialId: 7 })
  const body = recipeSaveBody(3, recipeDraftFromConfig(config({ recipe: [recipeLine] })))
  assert.deepEqual(body, { serviceId: 3, lines: [{ materialId: 5, qty: '150', wastePercent: '2.5' }] })
})

test('recipeChanged: khong doi -> false; sua dinh luong / doi che do -> true', () => {
  const a = recipeDraftFromConfig(config({ recipe: [recipeLine] }))
  assert.equal(recipeChanged(a, recipeDraftFromConfig(config({ recipe: [recipeLine] }))), false)
  assert.equal(recipeChanged(emptyRecipeDraft(), emptyRecipeDraft()), false)
  const edited = { ...a, lines: a.lines.map((l) => ({ ...l, qty: '200' })) }
  assert.equal(recipeChanged(a, edited), true)
  assert.equal(recipeChanged(a, { ...a, mode: 'none' }), true)
})

test('toppingDraftFromConfig + validateTopping: bat thi can >=1 dong hop le; tat thi bo qua', () => {
  const d = toppingDraftFromConfig(config({ toppings: [toppingLine], isSelect: 1 }))
  assert.equal(d.enabled, true)
  assert.equal(d.single, 1)
  assert.equal(d.lines[0].qty, '1')
  assert.equal(d.lines[0].price, '')
  assert.equal(validateTopping(2, d), null)
  assert.ok(validateTopping(9, d)) // tu la topping cua chinh no
  assert.ok(validateTopping(2, { enabled: true, single: 0, lines: [] }))
  assert.equal(validateTopping(2, { enabled: false, single: 0, lines: [] }), null)
  assert.equal(toppingDraftFromConfig(config()).enabled, false)
})

test('toppingSaveBody: tat -> toppings rong; bat -> dong da nhap', () => {
  const d = toppingDraftFromConfig(config({ toppings: [toppingLine] }))
  assert.deepEqual(toppingSaveBody(2, { ...d, enabled: false }).toppings, [])
  assert.deepEqual(toppingSaveBody(2, d), {
    serviceId: 2,
    isSelect: 0,
    toppings: [{ serviceId: 9, toppingQty: '1' }],
  })
})

test('toppingChanged: ca hai rong -> khong doi du doi cach chon; tat het topping dang co -> doi', () => {
  const empty = emptyToppingDraft()
  assert.equal(toppingChanged(empty, { ...empty, single: 1 }), false)
  const d = toppingDraftFromConfig(config({ toppings: [toppingLine] }))
  assert.equal(toppingChanged(d, toppingDraftFromConfig(config({ toppings: [toppingLine] }))), false)
  assert.equal(toppingChanged(d, { ...d, enabled: false }), true)
  assert.equal(toppingChanged(d, { ...d, single: 1 }), true)
  // tat roi bat lai voi danh sach cu giu nguyen -> khong doi
  assert.equal(toppingChanged(d, { ...d, enabled: true }), false)
})

test('setRecipeEnabled: bat theo loai nhom, tat giu du lieu', () => {
  const off = emptyRecipeDraft()
  // nhom thuong: nhieu nguyen lieu, co san 1 dong trong
  const normal = setRecipeEnabled(off, true, false)
  assert.equal(normal.mode, 'recipe')
  assert.equal(normal.lines.length, 1)
  // nhom kem them: dung 1 nguyen lieu
  assert.equal(setRecipeEnabled(off, true, true).mode, 'material')
  // tat -> none, giu lines/materialId de bat lai khong mat
  const filled = { ...normal, lines: [{ ...normal.lines[0], materialId: 5, qty: '2' }], materialId: 7 }
  const tatCa = setRecipeEnabled(filled, false, false)
  assert.equal(tatCa.mode, 'none')
  assert.equal(tatCa.lines[0].materialId, 5)
  assert.equal(setRecipeEnabled(tatCa, true, false).lines[0].qty, '2')
})

test('recipeDraftForGroup: doi nhom khi cong thuc dang bat', () => {
  const draft = { ...emptyRecipeDraft(), mode: 'recipe' as const, lines: [{ key: 'a', materialId: 5, qty: '1', waste: '' }] }
  const topping = recipeDraftForGroup(draft, true)
  assert.equal(topping.mode, 'material')
  assert.equal(topping.lines.length, 1) // giu lai de doi nhom lai khong mat
  assert.equal(recipeDraftForGroup(topping, false).mode, 'recipe')
  // dang tat thi khong tu bat
  assert.equal(recipeDraftForGroup(emptyRecipeDraft(), true).mode, 'none')
})
