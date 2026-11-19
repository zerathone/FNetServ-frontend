import assert from 'node:assert/strict'
import test from 'node:test'
import {
  batchStatusLabel,
  checkStocktakeLine,
  closingPreview,
  closingResultText,
  defaultReportRange,
  describeLineError,
  diffBadge,
  effectiveStaffFilter,
  formatDateTimeText,
  formatInt,
  formatSigned,
  importBatchLines,
  importLineTotal,
  importVoucherTotal,
  lineStatus,
  mergeBatchResults,
  parseStockView,
  parseUnitFactor,
  reportOffset,
  reportTotalPages,
  stockDiff,
  stocktakeBatchLines,
  unitChoices,
  unitFactorOf,
  unitFactorText,
  validateImportLine,
  validateImportVoucher,
  reportTimeFilter,
  validateReportRange,
  type ImportDraftLine,
} from '../src/features/inventory/finishedStockModel.ts'
import type { ServiceItem } from '../src/api/services.ts'

const svc = (over: Partial<ServiceItem>): ServiceItem => ({
  id: 1,
  name: 'Coca',
  price: 10000,
  unit: 'lon',
  inventory: 10,
  inventoryManagement: 1,
  ...over,
})

const line = (over: Partial<ImportDraftLine> = {}): ImportDraftLine => ({
  key: 'k',
  serviceId: 1,
  unitId: 0,
  factor: 1,
  quantity: '2',
  price: '5000',
  note: '',
  ...over,
})

test('stockDiff: Dự kiến − Thực tế; thiếu field (server cũ) ⇒ null', () => {
  assert.equal(stockDiff(svc({ inventory: 8, inventoryExpected: 10 })), 2)
  assert.equal(stockDiff(svc({ inventory: 10, inventoryExpected: 7 })), -3)
  assert.equal(stockDiff(svc({ inventory: 5, inventoryExpected: 5 })), 0)
  assert.equal(stockDiff(svc({ inventory: 5 })), null)
})

test('diffBadge: âm = danger, dương = warning, 0/không biết = trống', () => {
  assert.deepEqual(diffBadge(2), { tone: 'warning', text: '+2' })
  assert.deepEqual(diffBadge(-3), { tone: 'danger', text: '−3' })
  assert.equal(diffBadge(0), null)
  assert.equal(diffBadge(null), null)
})

test('formatInt / formatSigned / formatDateTimeText', () => {
  assert.equal(formatInt(1234567), '1.234.567')
  assert.equal(formatInt(-1000), '-1.000')
  assert.equal(formatInt(0), '0')
  assert.equal(formatSigned(5), '+5')
  assert.equal(formatSigned(-1500), '−1.500')
  assert.equal(formatSigned(0), '0')
  assert.equal(formatDateTimeText('2026-11-18', '09:05:00'), '18/11/2026 09:05:00')
  assert.equal(formatDateTimeText('2026-11-18', ''), '18/11/2026')
  assert.equal(formatDateTimeText('lạ', '1'), 'lạ 1')
})

test('closingPreview: đếm món quản lý tồn và món đang lệch', () => {
  const list = [
    svc({ id: 1, inventory: 5, inventoryExpected: 5 }),
    svc({ id: 2, inventory: 5, inventoryExpected: 8 }),
    svc({ id: 3, inventory: 5, inventoryExpected: 4 }),
    svc({ id: 4, inventoryManagement: 0, inventory: 0 }),
  ]
  assert.deepEqual(closingPreview(list), { managedCount: 3, diffCount: 2, unknownDiff: false })
  assert.equal(closingPreview([svc({ inventory: 1 })]).unknownDiff, true)
  assert.deepEqual(closingPreview([]), { managedCount: 0, diffCount: 0, unknownDiff: false })
})

test('importLineTotal + validateImportLine: SL nguyên ≥1, giá nguyên ≥0, trần quy đổi và thành tiền', () => {
  assert.equal(importLineTotal(line({ quantity: '3', price: '1500' })), 4500)
  assert.equal(importLineTotal(line({ quantity: '', price: '1500' })), null)
  assert.equal(validateImportLine(line()), null)
  assert.equal(validateImportLine(line({ price: '0' })), null)
  assert.match(validateImportLine(line({ quantity: '0' })) ?? '', /Số lượng/)
  assert.match(validateImportLine(line({ quantity: '1,5' })) ?? '', /Số lượng/)
  assert.match(validateImportLine(line({ quantity: '-1' })) ?? '', /Số lượng/)
  assert.match(validateImportLine(line({ price: '12.5' })) ?? '', /Giá nhập/)
  assert.match(validateImportLine(line({ price: '' })) ?? '', /Giá nhập/)
  // SL × hệ số ≤ 1.000.000
  assert.equal(validateImportLine(line({ quantity: '1000', factor: 1000, price: '1' })), null)
  assert.match(validateImportLine(line({ quantity: '1001', factor: 1000, price: '1' })) ?? '', /quy đổi/)
  // thành tiền ≤ 999.999.999
  assert.equal(validateImportLine(line({ quantity: '1000', price: '999999' })), null)
  assert.match(validateImportLine(line({ quantity: '1000', price: '1000000' })) ?? '', /Thành tiền/)
  assert.match(validateImportLine(line({ note: 'x'.repeat(251) })) ?? '', /Ghi chú/)
})

test('importVoucherTotal + validateImportVoucher', () => {
  const lines = [line({ key: 'a', quantity: '2', price: '1000' }), line({ key: 'b', quantity: '3', price: '500' })]
  assert.equal(importVoucherTotal(lines), 3500)
  // dòng sai số bị bỏ qua khi cộng
  assert.equal(importVoucherTotal([...lines, line({ key: 'c', quantity: '', price: '9' })]), 3500)
  assert.equal(validateImportVoucher(lines), null)
  assert.match(validateImportVoucher([]) ?? '', /chưa có dòng/)
  assert.match(validateImportVoucher([...lines, line({ key: 'z', quantity: '0' })]) ?? '', /Số lượng/)
  const many = Array.from({ length: 51 }, (_, i) => line({ key: `k${i}` }))
  assert.match(validateImportVoucher(many) ?? '', /tối đa 50/)
})

test('importBatchLines: unitId chỉ gửi khi khác đơn vị gốc; ghi chú trim, rỗng thì bỏ', () => {
  const body = importBatchLines([
    line({ serviceId: 7, quantity: '2', price: '1000', unitId: 0, note: '  ' }),
    line({ serviceId: 8, quantity: '1', price: '3000', unitId: 5, note: ' lô A ' }),
  ])
  assert.deepEqual(body, [
    { serviceId: 7, quantity: 2, price: 1000 },
    { serviceId: 8, quantity: 1, price: 3000, unitId: 5, note: 'lô A' },
  ])
})

test('checkStocktakeLine: thực tế ≥0, điều chỉnh có dấu, không âm, báo trước vượt Dự kiến', () => {
  const snap = { inventory: 10, expected: 12 }
  assert.deepEqual(checkStocktakeLine('real', '7', snap), { ok: true, real: 7, adjust: -3 })
  assert.deepEqual(checkStocktakeLine('real', '10', snap), { ok: true, real: 10, adjust: 0 })
  assert.deepEqual(checkStocktakeLine('real', '12', snap), { ok: true, real: 12, adjust: 2 }) // đúng bằng Dự kiến: được
  const over = checkStocktakeLine('real', '13', snap)
  assert.equal(over.ok, true)
  assert.match(over.ok ? (over.warning ?? '') : '', /dự kiến 12/)
  assert.deepEqual(checkStocktakeLine('adjust', '-4', snap), { ok: true, real: 6, adjust: -4 })
  assert.equal(checkStocktakeLine('adjust', '3', snap).ok, true)
  const overAdj = checkStocktakeLine('adjust', '3', snap)
  assert.match(overAdj.ok ? (overAdj.warning ?? '') : '', /vượt/)
  // lỗi cứng
  assert.equal(checkStocktakeLine('real', '-1', snap).ok, false)
  assert.equal(checkStocktakeLine('real', '', snap).ok, false)
  assert.equal(checkStocktakeLine('real', '1.5', snap).ok, false)
  assert.equal(checkStocktakeLine('adjust', '-11', snap).ok, false) // 10 − 11 < 0
  assert.equal(checkStocktakeLine('adjust', 'abc', snap).ok, false)
  assert.equal(checkStocktakeLine('real', '5', snap, 'x'.repeat(251)).ok, false)
})

test('checkStocktakeLine: dữ liệu cũ tồn > Dự kiến — giữ nguyên/giảm vẫn qua, không cảnh báo', () => {
  const snap = { inventory: 20, expected: 12 }
  assert.deepEqual(checkStocktakeLine('real', '20', snap), { ok: true, real: 20, adjust: 0 })
  assert.deepEqual(checkStocktakeLine('real', '15', snap), { ok: true, real: 15, adjust: -5 })
  // thiếu Dự kiến (server cũ): không cảnh báo, server vẫn là nguồn chặn
  assert.deepEqual(checkStocktakeLine('real', '99', { inventory: 20 }), { ok: true, real: 99, adjust: 79 })
})

test('stocktakeBatchLines: đúng MỘT trong numReal / numAdjust', () => {
  const lines = [
    { key: 'a', serviceId: 1, value: '7', note: '' },
    { key: 'b', serviceId: 2, value: '-3', note: ' ghi ' },
  ]
  assert.deepEqual(stocktakeBatchLines('real', lines), [
    { serviceId: 1, numReal: 7 },
    { serviceId: 2, numReal: -3, note: 'ghi' },
  ])
  assert.deepEqual(stocktakeBatchLines('adjust', lines), [
    { serviceId: 1, numAdjust: 7 },
    { serviceId: 2, numAdjust: -3, note: 'ghi' },
  ])
})

test('mergeBatchResults: dòng ok biến mất, dòng lỗi giữ + lý do; thiếu kết quả coi như chưa ghi', () => {
  const sent = [{ key: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'd' }]
  const out = mergeBatchResults(sent, [
    { index: 0, ok: true },
    { index: 1, ok: false, code: 'not_managed', message: 'Mặt hàng không quản lý tồn.' },
    { index: 2, ok: false, code: 'exceeds_expected' },
    // index 3: thiếu
  ])
  assert.deepEqual([...out.okKeys], ['a'])
  assert.equal(out.okCount, 1)
  assert.equal(out.failCount, 3)
  assert.equal(out.errors.b, 'Mặt hàng không quản lý tồn.') // nguyên văn message của server
  assert.equal(out.errors.c, 'Số thực tế vượt tồn sổ sách.') // fallback theo mã
  assert.match(out.errors.d, /không trả kết quả/)
  assert.equal('a' in out.errors, false)
  const allOk = mergeBatchResults([{ key: 'x' }], [{ index: 0, ok: true }])
  assert.equal(allOk.failCount, 0)
})

test('describeLineError / batchStatusLabel / lineStatus', () => {
  assert.equal(describeLineError({ code: 'zzz' }), 'Dòng chưa được ghi.')
  assert.equal(describeLineError({ code: 'db_error', message: '  ' }), 'Lỗi cơ sở dữ liệu, dòng chưa được ghi.')
  assert.equal(batchStatusLabel(3, 0), 'Đã ghi 3 dòng.')
  assert.match(batchStatusLabel(2, 1), /Đã ghi 2 dòng, còn 1 dòng lỗi/)
  assert.match(batchStatusLabel(0, 2), /Không ghi được dòng nào/)
  assert.equal(lineStatus('lỗi', 'cb'), 'error')
  assert.equal(lineStatus(undefined, 'cb'), 'warning')
  assert.equal(lineStatus(undefined, undefined), 'pending')
})

test('phân trang 200 dòng: offset và tổng số trang', () => {
  assert.equal(reportOffset(0), 0)
  assert.equal(reportOffset(2), 400)
  assert.equal(reportOffset(-1), 0)
  assert.equal(reportTotalPages(0), 1)
  assert.equal(reportTotalPages(200), 1)
  assert.equal(reportTotalPages(201), 2)
  assert.equal(reportTotalPages(1000), 5)
})

test('effectiveStaffFilter: ALL chọn tự do, quyền thường khoá vào chính mình', () => {
  assert.equal(effectiveStaffFilter(true, 5, 0), undefined)
  assert.equal(effectiveStaffFilter(true, 5, 9), 9)
  assert.equal(effectiveStaffFilter(false, 5, 0), 5)
  assert.equal(effectiveStaffFilter(false, 5, 9), 5) // không tin lựa chọn của FE
  assert.equal(effectiveStaffFilter(false, null, 9), undefined)
})

test('defaultReportRange: lùi 1 tháng → hôm nay, kẹp cuối tháng', () => {
  assert.deepEqual(defaultReportRange(new Date(2026, 10, 18)), { fromDate: '2026-10-18', toDate: '2026-11-18' })
  assert.deepEqual(defaultReportRange(new Date(2026, 2, 31)), { fromDate: '2026-02-28', toDate: '2026-03-31' })
  assert.deepEqual(defaultReportRange(new Date(2026, 0, 15)), { fromDate: '2025-12-15', toDate: '2026-01-15' })
})

test('validateReportRange: Từ > Đến là lỗi', () => {
  assert.equal(validateReportRange('2026-11-01', '2026-11-18'), null)
  assert.equal(validateReportRange('2026-11-18', '2026-11-18'), null)
  assert.notEqual(validateReportRange('2026-11-19', '2026-11-18'), null)
  assert.equal(validateReportRange('', '2026-11-18'), null)
})

test('validateReportRange: cùng ngày thì so giờ', () => {
  assert.equal(validateReportRange('2026-11-18', '2026-11-18', '08:00', '17:30'), null)
  assert.equal(validateReportRange('2026-11-18', '2026-11-18', '10:15', '10:15'), null)
  assert.notEqual(validateReportRange('2026-11-18', '2026-11-18', '17:30', '08:00'), null)
  // Khác ngày: giờ không ảnh hưởng.
  assert.equal(validateReportRange('2026-11-17', '2026-11-18', '17:30', '08:00'), null)
})

test('reportTimeFilter: chỉ gửi giờ khi có ngày và khác mặc định cả ngày', () => {
  assert.deepEqual(reportTimeFilter('2026-11-01', '2026-11-18', '00:00', '23:59'), {})
  assert.deepEqual(reportTimeFilter('2026-11-01', '2026-11-18', '08:30', '23:59'), { fromTime: '08:30' })
  assert.deepEqual(reportTimeFilter('2026-11-01', '2026-11-18', '00:00', '17:45'), { toTime: '17:45' })
  assert.deepEqual(reportTimeFilter('', '2026-11-18', '08:30', '17:45'), { toTime: '17:45' })
  assert.deepEqual(reportTimeFilter('2026-11-01', '', '08:30', '17:45'), { fromTime: '08:30' })
})

test('parseStockView: giá trị lạ ⇒ Tồn kho', () => {
  assert.equal(parseStockView(null), 'stock')
  assert.equal(parseStockView('imports'), 'imports')
  assert.equal(parseStockView('stocktakes'), 'stocktakes')
  assert.equal(parseStockView('closings'), 'closings')
  assert.equal(parseStockView('xyz'), 'stock')
})

test('đơn vị quy đổi: hệ số 2..1.000.000, nhãn, lựa chọn đơn vị nhập', () => {
  assert.equal(parseUnitFactor('12'), 12)
  assert.equal(parseUnitFactor('1'), null)
  assert.equal(parseUnitFactor('1000000'), 1_000_000)
  assert.equal(parseUnitFactor('1000001'), null)
  assert.equal(parseUnitFactor('2.5'), null)
  assert.equal(parseUnitFactor(''), null)
  assert.equal(unitFactorText('thùng', 12, 'chai'), '1 thùng = 12 chai')

  const list = {
    supported: true,
    rootUnit: 'chai',
    rows: [
      { unitId: 1, unit: 'chai', quantity: 1, root: true },
      { unitId: 2, unit: 'thùng', quantity: 24, root: false },
    ],
  }
  const choices = unitChoices(list, 'cái')
  assert.deepEqual(choices, [
    { unitId: 0, label: 'chai', factor: 1 },
    { unitId: 2, label: 'thùng (= 24 chai)', factor: 24 },
  ])
  assert.equal(unitFactorOf(choices, 2), 24)
  assert.equal(unitFactorOf(choices, 0), 1)
  assert.equal(unitFactorOf(choices, 99), 1)
  // chưa tải / không hỗ trợ ⇒ chỉ đơn vị gốc
  assert.deepEqual(unitChoices(undefined, 'lon'), [{ unitId: 0, label: 'lon', factor: 1 }])
  assert.deepEqual(unitChoices({ supported: false, rows: [] }, 'lon'), [{ unitId: 0, label: 'lon', factor: 1 }])
})

test('closingResultText', () => {
  assert.equal(closingResultText(12, 0), 'Đã chốt kho cho 12 mặt hàng.')
  assert.match(closingResultText(12, 2), /2 mặt hàng bị bỏ qua/)
})
