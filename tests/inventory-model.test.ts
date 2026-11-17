import assert from 'node:assert/strict'
import test from 'node:test'
import {
  countClosingDiffs,
  describeInventoryError,
  diffTone,
  formatDiff,
  formatQty,
  isValidStockCode,
  materialStockState,
  milliToString,
  parseMilli,
  parseWastePercent,
  parseWholeNumber,
  previewStockAfter,
  recipeLinesBody,
  suggestStockCode,
  toppingLinesBody,
  toWireDecimal,
  validateRecipeDraft,
  validateStockMove,
  validateToppingDraft,
} from '../src/features/inventory/inventoryModel.ts'

test('parseMilli: nhận dấu chấm/phẩy, tối đa 3 số lẻ, không qua float', () => {
  assert.equal(parseMilli('1.5'), 1500)
  assert.equal(parseMilli('1,5'), 1500)
  assert.equal(parseMilli('0.001'), 1)
  assert.equal(parseMilli('12'), 12000)
  assert.equal(parseMilli('0.1234'), null)
  assert.equal(parseMilli('-1'), null)
  assert.equal(parseMilli('1e3'), null)
  assert.equal(parseMilli(''), null)
  assert.equal(parseMilli('1.'), null)
  // 0.1 + 0.2 kiểu float sai — ở đây là số nguyên milli nên đúng
  assert.equal(parseMilli('0.1')! + parseMilli('0.2')!, parseMilli('0.3'))
  assert.equal(parseMilli('999999999.999'), 999_999_999_999)
  assert.equal(parseMilli('1000000000'), null)
})

test('toWireDecimal chuẩn hoá chuỗi gửi server', () => {
  assert.equal(toWireDecimal('1,50'), '1.5')
  assert.equal(toWireDecimal('007'), '7')
  assert.equal(toWireDecimal('0,5'), '0.5')
  assert.equal(toWireDecimal('abc'), null)
  assert.equal(milliToString(1500), '1.5')
  assert.equal(milliToString(-250), '-0.25')
})

test('formatQty / formatDiff hiển thị kiểu vi-VN', () => {
  assert.equal(formatQty('1.500'), '1,5')
  assert.equal(formatQty('1234567.000'), '1.234.567')
  assert.equal(formatQty('0.250'), '0,25')
  assert.equal(formatQty(''), '—')
  assert.equal(formatQty(null), '—')
  assert.equal(formatDiff('2.000'), '+2')
  assert.equal(formatDiff('-1.500'), '−1,5')
  assert.equal(formatDiff('0.000'), '0')
  assert.equal(diffTone('-1.000'), 'danger')
  assert.equal(diffTone('1.000'), 'warning')
  assert.equal(diffTone('0.000'), 'neutral')
})

test('mã phiếu gợi ý hợp lệ và đủ ngắn', () => {
  const now = new Date(2026, 10, 15, 9, 5, 7)
  assert.equal(suggestStockCode(1, now), 'NK261115090507')
  assert.equal(suggestStockCode(2, now), 'XK261115090507')
  assert.equal(suggestStockCode(3, now), 'KK261115090507')
  assert.ok(isValidStockCode(suggestStockCode(1, now)))
  assert.equal(isValidStockCode(''), false)
  assert.equal(isValidStockCode('có dấu'), false)
  assert.equal(isValidStockCode('a'.repeat(21)), false)
  assert.equal(isValidStockCode("x'; DROP"), false)
})

test('validateStockMove: xuất/nhập > 0, kiểm kê cho phép 0', () => {
  const base = { msType: 1 as const, qty: '5', price: '', code: 'NK1', note: '' }
  assert.equal(validateStockMove(base), null)
  assert.match(validateStockMove({ ...base, qty: '0' }) ?? '', /lớn hơn 0/)
  assert.equal(validateStockMove({ ...base, msType: 3, qty: '0' }), null)
  assert.match(validateStockMove({ ...base, qty: '1.2345' }) ?? '', /Số lượng/)
  assert.match(validateStockMove({ ...base, code: 'sai ma' }) ?? '', /Mã phiếu/)
  assert.match(validateStockMove({ ...base, price: 'x' }) ?? '', /Đơn giá/)
})

test('previewStockAfter cảnh báo xuất vượt tồn', () => {
  assert.deepEqual(previewStockAfter('10.000', { msType: 1, qty: '2.5' }), { after: '12.5', short: false })
  assert.deepEqual(previewStockAfter('10.000', { msType: 2, qty: '3' }), { after: '7', short: false })
  assert.deepEqual(previewStockAfter('1.000', { msType: 2, qty: '3' }), { after: '-2', short: true })
  assert.deepEqual(previewStockAfter('10.000', { msType: 3, qty: '4' }), { after: '4', short: false })
  assert.equal(previewStockAfter('10.000', { msType: 1, qty: 'x' }), null)
})

test('công thức: chống trùng/thiếu/sai định lượng và hao hụt', () => {
  const line = (materialId: number, qty = '1', waste = '') => ({ key: String(materialId), materialId, qty, waste })
  assert.equal(validateRecipeDraft([]), null) // bỏ công thức
  assert.equal(validateRecipeDraft([line(1), line(2, '0.5', '5')]), null)
  assert.match(validateRecipeDraft([line(0)]) ?? '', /chọn nguyên liệu/)
  assert.match(validateRecipeDraft([line(1), line(1)]) ?? '', /một lần/)
  assert.match(validateRecipeDraft([line(1, '0')]) ?? '', /Định lượng/)
  assert.match(validateRecipeDraft([line(1, '1', '101')]) ?? '', /Hao hụt/)
  assert.match(validateRecipeDraft([line(1, '1', '1.234')]) ?? '', /Hao hụt/)
  assert.equal(parseWastePercent('100'), 10000)
  assert.equal(parseWastePercent('2,5'), 250)
  assert.equal(parseWastePercent('100.01'), null)
  assert.deepEqual(recipeLinesBody([line(7, '1,5', ''), line(8, '2', '3,5')]), [
    { materialId: 7, qty: '1.5', wastePercent: '0' },
    { materialId: 8, qty: '2', wastePercent: '3.5' },
  ])
})

test('topping: không tự chọn chính mình, không trùng, trường trống để server dùng mặc định', () => {
  const t = (serviceId: number, qty = '', price = '') => ({ key: String(serviceId), serviceId, qty, price })
  assert.equal(validateToppingDraft(10, [t(11), t(12, '2', '3000')]), null)
  assert.match(validateToppingDraft(10, [t(10)]) ?? '', /chính nó/)
  assert.match(validateToppingDraft(10, [t(11), t(11)]) ?? '', /một lần/)
  assert.match(validateToppingDraft(10, [t(11, '0')]) ?? '', /Lượng/)
  assert.deepEqual(toppingLinesBody([t(11), t(12, '2', '3000')]), [
    { serviceId: 11 },
    { serviceId: 12, toppingQty: '2', topPrice: '3000' },
  ])
})

test('số nguyên kho thành phẩm', () => {
  assert.equal(parseWholeNumber('12'), 12)
  assert.equal(parseWholeNumber('-3'), null)
  assert.equal(parseWholeNumber('-3', true), -3)
  assert.equal(parseWholeNumber('1.5'), null)
  assert.equal(parseWholeNumber(''), null)
})

test('describeInventoryError ghép chi tiết từ server', () => {
  assert.equal(
    describeInventoryError({
      message: 'Không đủ tồn để xuất.',
      code: 'material_short',
      details: { stockQty: '1.500', need: '3.000' },
    }),
    'Không đủ tồn để xuất. Tồn 1,5, cần 3.',
  )
  assert.match(describeInventoryError({ message: 'Đang dùng', code: 'in_use', details: { recipeCount: 4 } }), /4 công thức/)
  assert.equal(describeInventoryError(undefined), 'Không thực hiện được, thử lại sau.')
})

test('chốt kỳ: đếm dòng lệch', () => {
  assert.equal(countClosingDiffs([{ diffQty: '0.000' }, { diffQty: '-2.000' }, { diffQty: '0.500' }]), 2)
  assert.equal(countClosingDiffs([]), 0)
})

test('materialStockState: ngung dung > het ton (<=0) > sap het (<= toi thieu) > con ton', () => {
  const m = (isActive: number, stockQty: string, minStockQty: string) => ({ isActive, stockQty, minStockQty })
  assert.equal(materialStockState(m(0, '9', '1')), 'stopped')
  assert.equal(materialStockState(m(0, '0', '0')), 'stopped')
  assert.equal(materialStockState(m(1, '0.000', '5.000')), 'out')
  assert.equal(materialStockState(m(1, '-2.500', '0.000')), 'out')
  assert.equal(materialStockState(m(1, '3.000', '5.000')), 'low')
  assert.equal(materialStockState(m(1, '5.000', '5.000')), 'low')
  assert.equal(materialStockState(m(1, '5.001', '5.000')), 'available')
  assert.equal(materialStockState(m(1, '0.500', '0.000')), 'available')
})
