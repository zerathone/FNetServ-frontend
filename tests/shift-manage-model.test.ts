import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAYMENT_METHODS,
  SHIFT_RIGHTS,
  canForceClose,
  cashDiffView,
  classifyShiftError,
  formatSignedQty,
  isTodayYmd,
  listItemToCloseResult,
  methodLabel,
  normalizeReconcile,
  normalizeShiftList,
  normalizeShiftPayments,
  normalizeShiftStock,
  reconcileFromList,
  reconcileVerdict,
  shiftStatusView,
  sortShifts,
  summarizeDay,
  todayYmd,
  validateForceCloseNote,
  viewAllGate,
} from '../src/features/shifts/shiftManageModel.ts'
import { buildCloseTicketHtml, normalizeSummary } from '../src/features/shifts/shiftModel.ts'

const rawShift = (over: Record<string, unknown> = {}) => ({
  shiftId: 10,
  staffId: 7,
  staffName: 'Thu Ngân',
  status: 2,
  openTime: '2026-11-21 06:00:00',
  closeTime: '2026-11-21 14:00:00',
  openingCash: 500000,
  revenue: 1000000,
  expectedCash: 1200000,
  countedCash: 1190000,
  cashDiff: -10000,
  hung: false,
  ...over,
})

test('normalizeShiftList: số dạng chuỗi được ép số, ca đang mở không có closeTime, bỏ ca không có mã', () => {
  const list = normalizeShiftList({
    shifts: [
      rawShift({ shiftId: '11', status: '1', closeTime: '2026-11-21 23:00:00', revenue: '250000', countedCash: null, cashDiff: null }),
      { staffName: 'Hỏng không có mã ca' },
    ],
    outside: { system: { count: '12', total: '1850000' }, other: { count: 2, total: 130000 } },
    reconcile: { reportTotal: 3500000, bucketTotal: 3300000 },
  })
  assert.equal(list.shifts.length, 1)
  assert.equal(list.shifts[0].shiftId, 11)
  assert.equal(list.shifts[0].status, 1)
  assert.equal(list.shifts[0].closeTime, null) // ca đang mở: bỏ qua closeTime lạc
  assert.equal(list.shifts[0].revenue, 250000)
  assert.equal(list.shifts[0].countedCash, null)
  assert.equal(list.outside.system.total, 1850000)
  assert.equal(list.outside.system.count, 12)
  // thiếu diff ⇒ tự tính reportTotal − bucketTotal
  assert.equal(list.reconcile?.diff, 200000)
})

test('normalizeShiftList: thiếu mọi trường vẫn trả cấu trúc đủ (không ném)', () => {
  const list = normalizeShiftList(undefined)
  assert.deepEqual(list.shifts, [])
  assert.deepEqual(list.outside, { system: { count: 0, total: 0 }, other: { count: 0, total: 0 } })
  assert.equal(list.reconcile, null)
})

test('sortShifts: ca đang mở lên đầu, rồi mới mở sau cùng trước; không đổi mảng gốc', () => {
  const input = normalizeShiftList({
    shifts: [
      rawShift({ shiftId: 1, openTime: '2026-11-21 06:00:00' }),
      rawShift({ shiftId: 2, openTime: '2026-11-21 14:00:00' }),
      rawShift({ shiftId: 3, status: 1, openTime: '2026-11-20 20:00:00', closeTime: '' }),
    ],
  }).shifts
  assert.deepEqual(input.map((s) => s.shiftId), [3, 2, 1])
  const copy = [...input].reverse()
  const before = copy.map((s) => s.shiftId)
  sortShifts(copy)
  assert.deepEqual(copy.map((s) => s.shiftId), before)
})

test('shiftStatusView: 4 trạng thái — Treo thắng Đang mở; chữ không viết tắt', () => {
  assert.equal(shiftStatusView({ status: 1, hung: false }).label, 'Đang mở')
  assert.equal(shiftStatusView({ status: 1, hung: true }).label, 'Treo')
  assert.equal(shiftStatusView({ status: 1, hung: true }).tone, 'danger')
  assert.equal(shiftStatusView({ status: 2, hung: false }).label, 'Đã chốt')
  assert.equal(shiftStatusView({ status: 3, hung: false }).label, 'Đóng cưỡng bức')
  // ca đã đóng thì `hung` không còn ý nghĩa
  assert.equal(shiftStatusView({ status: 2, hung: true }).label, 'Đã chốt')
})

test('cashDiffView: âm = Thiếu (đỏ), dương = Thừa, 0 = Khớp, null = Chưa đếm; luôn kèm chữ', () => {
  assert.deepEqual(cashDiffView(-10000), { kind: 'short', text: 'Thiếu 10.000 đ' })
  assert.deepEqual(cashDiffView(5000), { kind: 'over', text: 'Thừa 5.000 đ' })
  assert.deepEqual(cashDiffView(0), { kind: 'ok', text: 'Khớp' })
  assert.deepEqual(cashDiffView(null), { kind: 'none', text: 'Chưa đếm' })
  assert.deepEqual(cashDiffView(null, 3), { kind: 'none', text: 'Không đếm' }) // đóng cưỡng bức
})

test('normalizeShiftList: thiếu status ⇒ coi như đã chốt (không hiện nút Đóng cưỡng bức nhầm)', () => {
  const [item] = normalizeShiftList({ shifts: [{ shiftId: 5 }] }).shifts
  assert.equal(item.status, 2)
})

test('summarizeDay: đếm ca đang mở / treo / mở từ hôm trước; tổng doanh thu chỉ cộng các ca', () => {
  const shifts = normalizeShiftList({
    shifts: [
      rawShift({ shiftId: 1, revenue: 100 }),
      rawShift({ shiftId: 2, status: 1, closeTime: '', revenue: 50 }),
      rawShift({ shiftId: 3, status: 1, closeTime: '', hung: true, openTime: '2026-11-20 20:00:00', revenue: 25 }),
    ],
  }).shifts
  const totals = summarizeDay(shifts, '2026-11-21')
  assert.deepEqual(totals, { shiftCount: 3, openCount: 2, hungCount: 1, carriedOver: 1, revenueTotal: 175 })
})

test('đối soát: diff = 0 ⇒ khớp; lệch ⇒ đếm phiếu gây lệch; mã phiếu số hay chuỗi đều thành chuỗi', () => {
  const ok = normalizeReconcile({ reportTotal: 100, shiftsTotal: 60, systemTotal: 30, otherTotal: 10, diff: 0, orphans: [], duplicates: [] })
  assert.deepEqual(reconcileVerdict(ok), { matched: true, diff: 0, badCount: 0 })

  const bad = normalizeReconcile({ reportTotal: 300, shiftsTotal: 60, systemTotal: 30, otherTotal: 10, diff: 200, orphans: [10234, '10241'], duplicates: [10188] })
  assert.deepEqual(bad.orphans, ['10234', '10241'])
  assert.deepEqual(bad.duplicates, ['10188'])
  assert.deepEqual(reconcileVerdict(bad), { matched: false, diff: 200, badCount: 3 })

  // thiếu diff ⇒ reportTotal − (ca + hệ thống + khác); âm = thừa (đếm hai lần)
  const derived = normalizeReconcile({ reportTotal: 90, shiftsTotal: 60, systemTotal: 30, otherTotal: 10 })
  assert.equal(derived.diff, -10)
})

test('reconcileFromList: dựng bản rút gọn từ /shift/list khi /shift/reconcile lỗi (không có danh sách phiếu)', () => {
  const list = normalizeShiftList({
    shifts: [rawShift({ shiftId: 1, revenue: 60 }), rawShift({ shiftId: 2, revenue: 40 })],
    outside: { system: { count: 1, total: 30 }, other: { count: 1, total: 10 } },
    reconcile: { reportTotal: 140, bucketTotal: 140, diff: 0 },
  })
  const rec = reconcileFromList(list)
  assert.equal(rec?.shiftsTotal, 100) // = bucketTotal − hệ thống − khác
  // ca qua đêm: Σ revenue các dòng danh sách (vd 250) khác tổng theo phiếu trong ngày — bản dự phòng vẫn phải cộng ra
  const overnight = normalizeShiftList({
    shifts: [rawShift({ shiftId: 1, revenue: 250 })],
    outside: { system: { count: 1, total: 30 }, other: { count: 1, total: 10 } },
    reconcile: { reportTotal: 140, bucketTotal: 140, diff: 0 },
  })
  const rec2 = reconcileFromList(overnight)
  assert.equal(rec2 ? rec2.shiftsTotal + rec2.systemTotal + rec2.otherTotal : -1, 140)
  assert.equal(rec?.systemTotal, 30)
  assert.equal(rec?.diff, 0)
  assert.deepEqual(rec?.orphans, [])
  assert.equal(reconcileFromList(normalizeShiftList({ shifts: [] })), null)
})

test('normalizeShiftStock: available:false ⇒ ẩn tab; close hoặc current đều là "cuối kỳ"; delta tự tính khi thiếu', () => {
  assert.equal(normalizeShiftStock({ available: false, rows: [] }).available, false)
  const stock = normalizeShiftStock({
    available: true,
    rows: [
      { materialId: 1, name: 'Sữa', unit: 'lon', open: 10, close: 8, imported: 0, exported: 2, adjusted: 0 },
      { materialId: 2, name: 'Trứng', unit: 'quả', open: '90', current: '100', delta: '10', imported: 20, exported: 10, adjusted: 0 },
      { materialId: 3, name: 'Đường', unit: 'kg', open: 5, current: 4.5 },
    ],
  })
  assert.equal(stock.available, true)
  assert.equal(stock.rows[0].close, 8)
  assert.equal(stock.rows[0].delta, -2) // tự tính 8 − 10
  assert.equal(stock.rows[1].close, 100)
  assert.equal(stock.rows[1].delta, 10)
  assert.equal(stock.rows[2].delta, -0.5)
  assert.equal(normalizeShiftStock({ rows: [] }).available, true) // thiếu cờ ⇒ coi như có kho
})

test('formatSignedQty: có dấu +/−, số lẻ giữ tới 3 chữ số', () => {
  assert.equal(formatSignedQty(12), '+12')
  assert.equal(formatSignedQty(-3.5), '−3,5')
  assert.equal(formatSignedQty(0), '0')
})

test('normalizeShiftPayments: total thiếu ⇒ số dòng; phân trang do máy chủ quyết định', () => {
  const page = normalizeShiftPayments({
    total: '120',
    items: [{ voucherId: 12345, date: '2026-11-21', time: '08:00:00', paymentType: '1', typeName: 'Nạp tiền', source: 'member', method: 'cash', amount: '50000', member: 'hv1', staff: 'A' }],
  })
  assert.equal(page.total, 120)
  assert.equal(page.items[0].voucherId, '12345')
  assert.equal(page.items[0].amount, 50000)
  assert.equal(normalizeShiftPayments({ items: [{}, {}] }).total, 2)
})

test('methodLabel: 4 hình thức không viết tắt; khoá lạ giữ nguyên', () => {
  assert.deepEqual(PAYMENT_METHODS.map((m) => m.label), ['Tiền mặt', 'Chuyển khoản', 'QR', 'Cấn trừ'])
  assert.equal(methodLabel('online'), 'Chuyển khoản')
  assert.equal(methodLabel('zalo'), 'zalo')
})

test('normalizeSummary S3: refundsQrCanceled / onlineBook — thiếu hoặc null ⇒ null (không hiện dòng nhắc)', () => {
  const none = normalizeSummary({ sources: [] })
  assert.equal(none.refundsQrCanceled, null)
  assert.equal(none.onlineBook, null)
  const some = normalizeSummary({ sources: [], refundsQrCanceled: { count: '2', total: '180000' }, onlineBook: { count: 1, walletTotal: 60000 } })
  assert.deepEqual(some.refundsQrCanceled, { count: 2, total: 180000 })
  assert.deepEqual(some.onlineBook, { count: 1, walletTotal: 60000 })
  assert.equal(normalizeSummary({ sources: [], refundsQrCanceled: 'x' }).refundsQrCanceled, null)
})

test('listItemToCloseResult: phiếu ca đã đóng dựng được từ dòng danh sách, kể cả khi chưa có tóm tắt hay chưa đếm tiền', () => {
  const [item] = normalizeShiftList({ shifts: [rawShift({ countedCash: null, cashDiff: null })] }).shifts
  const summary = normalizeSummary({ sources: [{ key: 'member', name: 'Nạp hội viên', count: 1, cash: 100, online: 0, qr: 0, deduct: 0 }], expectedCash: 777 })
  const result = listItemToCloseResult({ ...item, expectedCash: null }, summary)
  assert.equal(result.shift.expectedCash, 777) // thiếu ở danh sách ⇒ lấy ở tóm tắt
  assert.equal(result.shift.closeTime, '2026-11-21 14:00:00')
  assert.equal(result.shift.note, '')
  assert.match(listItemToCloseResult({ ...item, status: 3 }, summary).shift.note, /cưỡng bức/)
  const html = buildCloseTicketHtml({ shopName: 'Quán <A>', result, type: 1 })
  assert.match(html, /Ca số:/)
  assert.match(html, /Không nhập/) // chưa đếm tiền
  assert.doesNotMatch(html, /Quán <A>/) // đã escape
  // không có tóm tắt cũng không vỡ
  assert.doesNotThrow(() => buildCloseTicketHtml({ shopName: '', result: listItemToCloseResult(item, null), type: 2 }))
})

test('validateForceCloseNote: bắt buộc 1–500 ký tự; từ chối nháy đơn và gạch chéo ngược; Enter → khoảng trắng', () => {
  assert.match(validateForceCloseNote('') ?? '', /lý do/)
  assert.match(validateForceCloseNote('   ') ?? '', /lý do/)
  assert.equal(validateForceCloseNote('Nhân viên về mà quên chốt ca'), undefined)
  assert.equal(validateForceCloseNote('x'.repeat(500)), undefined)
  assert.match(validateForceCloseNote('x'.repeat(501)) ?? '', /500/)
  assert.match(validateForceCloseNote("it's") ?? '', /nháy/)
  assert.match(validateForceCloseNote('a\\b') ?? '', /gạch chéo/)
  assert.equal(validateForceCloseNote('dòng một\ndòng hai'), undefined)
})

test('quyền: admin luôn được; chưa biết mã quyền ⇒ unknown (để server quyết định) và nút Đóng cưỡng bức chỉ cho admin', () => {
  const none = () => false
  assert.equal(SHIFT_RIGHTS.VIEW_ALL, null) // đổi test này khi B2 chốt mã quyền
  assert.equal(viewAllGate(true, none), 'allowed')
  assert.equal(viewAllGate(false, none), 'unknown')
  assert.equal(canForceClose(1, true, none), true)
  assert.equal(canForceClose(1, false, () => true), false) // chưa có mã ⇒ không tự cho
  assert.equal(canForceClose(2, true, none), false) // ca đã đóng: không có nút
  assert.equal(canForceClose(3, true, none), false)
})

test('classifyShiftError: SHIFT_DISABLED / 403 / RBAC_DENIED / còn lại', () => {
  assert.equal(classifyShiftError({ rbac: false, code: 'SHIFT_DISABLED' }), 'disabled')
  assert.equal(classifyShiftError({ rbac: true }), 'denied')
  assert.equal(classifyShiftError({ rbac: false, httpStatus: 403 }), 'denied')
  assert.equal(classifyShiftError({ rbac: false, code: 'RBAC_DENIED' }), 'denied')
  assert.equal(classifyShiftError({ rbac: false, code: 'INTERNAL' }), 'other')
})

test('todayYmd / isTodayYmd: ngày địa phương, không lệch múi giờ', () => {
  const lateNight = new Date(2026, 10, 21, 23, 59, 0) // 21/11/2026 23:59 giờ địa phương
  assert.equal(todayYmd(lateNight), '2026-11-21')
  assert.equal(isTodayYmd('2026-11-21', lateNight), true)
  assert.equal(isTodayYmd('2026-11-20', lateNight), false)
  assert.equal(todayYmd(new Date(2026, 0, 5, 0, 0, 1)), '2026-01-05')
})
