import assert from 'node:assert/strict'
import test from 'node:test'
import type { PendingOrder } from '../src/api/orders.ts'
import {
  buildCloseTicketHtml,
  cashDifference,
  countPendingMainLines,
  fillCloseFromSnapshot,
  formatShiftDateTime,
  formatShiftTime,
  formatSigned,
  hasPending,
  normalizeCloseResult,
  normalizeCurrent,
  normalizePendingCounts,
  normalizeSummary,
  sanitizeNoteInput,
  sumSources,
  validateCashInput,
  validateShiftNote,
} from '../src/features/shifts/shiftModel.ts'

const source = (over: Partial<Record<string, unknown>> = {}) => ({
  key: 'service',
  name: 'Dịch vụ',
  count: 3,
  cash: 100,
  online: 20,
  qr: 30,
  deduct: 500,
  total: 150,
  ...over,
})

test('sumSources: total = tiền mặt + chuyển khoản + QR, KHÔNG cộng cấn trừ (Q16b)', () => {
  const totals = sumSources([
    { key: 'a', name: 'A', count: 1, cash: 100, online: 10, qr: 5, deduct: 40, total: 115 },
    { key: 'b', name: 'B', count: 2, cash: 50, online: 0, qr: 25, deduct: 60, total: 75 },
  ])
  assert.equal(totals.total, 190)
  assert.equal(totals.deduct, 100)
  assert.equal(totals.count, 3)
})

test('normalizeSummary: số dạng chuỗi được ép số; thiếu totals thì tự cộng (không gồm cấn trừ)', () => {
  const summary = normalizeSummary({
    sources: [source({ cash: '100', total: undefined }), source({ key: 'x', name: 'X', cash: 1, online: 2, qr: 3, deduct: 9, total: undefined })],
    refund: { count: '1', cash: '-50', online: 0 },
    expectedCash: '1500',
  })
  assert.equal(summary.sources[0].cash, 100)
  assert.equal(summary.sources[0].total, 150) // 100 + 20 + 30, không +500
  assert.equal(summary.totals.total, 150 + 6)
  assert.equal(summary.refund.cash, -50)
  assert.equal(summary.expectedCash, 1500)
})

test('normalizeSummary: totals do server gửi được giữ nguyên (số chốt là số server)', () => {
  const summary = normalizeSummary({ sources: [source()], totals: { count: 9, cash: 1, online: 2, qr: 3, deduct: 4, total: 6 } })
  assert.equal(summary.totals.total, 6)
  assert.equal(summary.totals.count, 9)
})

test('normalizeSummary: dữ liệu rỗng/hỏng không ném', () => {
  const summary = normalizeSummary(undefined)
  assert.deepEqual(summary.sources, [])
  assert.equal(summary.totals.total, 0)
  assert.equal(summary.expectedCash, 0)
})

test('normalizeCurrent: enabled=false hoặc mode 0 ⇒ tắt hẳn, không ca', () => {
  assert.deepEqual(normalizeCurrent({ enabled: false, mode: 0 }), {
    enabled: false,
    mode: 0,
    serverTime: '',
    shift: null,
    lastClosed: null,
  })
  assert.equal(normalizeCurrent({ enabled: true, mode: 0 }).enabled, false)
  assert.equal(normalizeCurrent(undefined).enabled, false)
})

test('normalizeCurrent: lastClosed chỉ giữ khi chưa có ca và có tiền thực đếm', () => {
  const lastClosed = { shiftId: 5, staffName: 'A', closeTime: '2026-11-21 06:00:00', countedCash: '1200000' }
  const none = normalizeCurrent({ enabled: true, mode: 2, serverTime: 't', shift: null, lastClosed })
  assert.equal(none.shift, null)
  assert.equal(none.lastClosed?.countedCash, 1_200_000)
  const noCount = normalizeCurrent({ enabled: true, mode: 1, shift: null, lastClosed: { ...lastClosed, countedCash: null } })
  assert.equal(noCount.lastClosed, null)
  const open = normalizeCurrent({
    enabled: true,
    mode: 1,
    shift: { shiftId: 9, staffId: 1, staffName: 'B', status: 1, openTime: '2026-11-21 08:00:00', openingCash: '500' },
    lastClosed,
  })
  assert.equal(open.shift?.openingCash, 500)
  assert.equal(open.lastClosed, null)
})

test('normalizeCloseResult: nhận cả dạng lồng và dạng phẳng; thiếu countedCash không vỡ', () => {
  const nested = normalizeCloseResult({
    alreadyClosed: false,
    shift: { shiftId: 3, staffName: 'A', openTime: '2026-11-21 08:00:00', closeTime: '2026-11-21 16:00:00', openingCash: 100, expectedCash: 400, countedCash: null, cashDiff: null },
    summary: { sources: [source()], expectedCash: 400 },
  })
  assert.equal(nested.shift.countedCash, null)
  assert.equal(nested.shift.expectedCash, 400)
  assert.equal(nested.summary?.sources.length, 1)

  const flat = normalizeCloseResult({
    alreadyClosed: true,
    shiftId: 3,
    closeTime: 'x',
    expectedCash: 400,
    countedCash: 410,
    cashDiff: 10,
    sources: [source()],
  })
  assert.equal(flat.alreadyClosed, true)
  assert.equal(flat.shift.cashDiff, 10)
  assert.equal(flat.summary?.sources.length, 1)
})

test('normalizePendingCounts: qrPaidUnconfirmed dạng số hoặc {count, amount}; bóc data lồng', () => {
  assert.deepEqual(normalizePendingCounts({ code: 'X', pendingService: 3, pendingCombo: 1, qrPaidUnconfirmed: 2 }), {
    pendingService: 3,
    pendingCombo: 1,
    qrPaidUnconfirmed: { count: 2, amount: null },
  })
  const obj = normalizePendingCounts({ data: { pendingService: 1, pendingCombo: 0, qrPaidUnconfirmed: { count: 1, amount: 55000 } } })
  assert.equal(obj?.qrPaidUnconfirmed.amount, 55000)
  assert.equal(normalizePendingCounts({ message: 'x' }), null)
  assert.equal(hasPending(obj), true)
  assert.equal(hasPending({ pendingService: 0, pendingCombo: 0, qrPaidUnconfirmed: { count: 0, amount: null } }), false)
})

test('countPendingMainLines: chỉ đếm món chính, bỏ topping; đếm riêng QR đã trả', () => {
  const line = (id: number, parentId: number | null, servicePaid = 0) =>
    ({ serviceDetailId: id, parentId, servicePaid }) as unknown as PendingOrder
  const result = countPendingMainLines([line(1, null), line(2, 1), line(3, 0, 1), line(4, 3, 1), line(5, 99)])
  // 1 (chính), 3 (chính, QR), 5 (cha 99 không có trong danh sách => coi là chính); 2 và 4 là topping
  assert.equal(result.mains, 3)
  assert.equal(result.qrPaid, 1)
})

test('validateCashInput: trống hợp lệ; âm/lẻ/quá 10 tỷ bị từ chối', () => {
  assert.equal(validateCashInput(null, 'Tiền'), undefined)
  assert.equal(validateCashInput(0, 'Tiền'), undefined)
  assert.equal(validateCashInput(10_000_000_000, 'Tiền'), undefined)
  assert.ok(validateCashInput(10_000_000_001, 'Tiền'))
  assert.ok(validateCashInput(-1, 'Tiền'))
  assert.ok(validateCashInput(1.5, 'Tiền'))
})

test('cashDifference / formatSigned', () => {
  assert.equal(cashDifference(null, 1000), null)
  assert.equal(cashDifference(990_000, 1_000_000), -10_000)
  assert.equal(formatSigned(10_000), '+10.000 đ')
  assert.equal(formatSigned(-10_000), '−10.000 đ')
  assert.equal(formatSigned(0), '0 đ')
})

test('fillCloseFromSnapshot: response thiếu trường ca thì lấy từ ca đang giữ; tiền đầu ca luôn theo snapshot', () => {
  const snapshot = { shiftId: 7, staffId: 3, staffName: 'Thu Ngân', status: 1, openTime: '2026-11-21 08:00:00', openingCash: 500_000 }
  const bare = normalizeCloseResult({ alreadyClosed: false, expectedCash: 1_000_000, countedCash: 990_000, cashDiff: -10_000 })
  const filled = fillCloseFromSnapshot(bare, snapshot)
  assert.equal(filled.shift.shiftId, 7)
  assert.equal(filled.shift.staffName, 'Thu Ngân')
  assert.equal(filled.shift.openingCash, 500_000)
  assert.equal(filled.shift.cashDiff, -10_000)
  // ca khác (id khác) thì không đụng
  const other = normalizeCloseResult({ shift: { shiftId: 99, openingCash: 1 } })
  assert.equal(fillCloseFromSnapshot(other, snapshot).shift.shiftId, 99)
})

test('normalizeCurrent: shift không có shiftId hợp lệ coi như chưa có ca', () => {
  assert.equal(normalizeCurrent({ enabled: true, mode: 1, shift: {} }).shift, null)
})

test('ghi chú: Enter/tab thành khoảng trắng; nháy đơn và gạch chéo ngược bị báo lỗi (server isSqlSafeText)', () => {
  assert.equal(sanitizeNoteInput('a\nb\tc'), 'a b c')
  assert.equal(validateShiftNote('Thiếu 10k do thối nhầm'), undefined)
  assert.ok(validateShiftNote("khách d'a"))
  assert.ok(validateShiftNote('a\\b'))
  assert.ok(validateShiftNote('x'.repeat(501)))
})

test('định dạng giờ', () => {
  assert.equal(formatShiftTime('2026-11-21 09:14:33'), '09:14 21/11')
  assert.equal(formatShiftDateTime('2026-11-21 09:14:33'), '09:14 21/11/2026')
  assert.equal(formatShiftTime('lạ'), 'lạ')
})

const result = (over: Record<string, unknown> = {}) =>
  normalizeCloseResult({
    alreadyClosed: false,
    shift: {
      shiftId: 7,
      staffName: 'Nguyễn <A>',
      openTime: '2026-11-21 08:00:00',
      closeTime: '2026-11-21 16:00:00',
      openingCash: 500_000,
      expectedCash: 1_000_000,
      countedCash: 990_000,
      cashDiff: -10_000,
      note: 'ghi chú "x"',
      ...over,
    },
    summary: {
      sources: [source({ name: 'Dịch vụ', count: 2, cash: 100, online: 0, qr: 0, deduct: 700, total: 100 })],
      refund: { count: 1, cash: -20, online: 0 },
      totals: { count: 2, cash: 100, online: 0, qr: 0, deduct: 700, total: 100 },
      expectedCash: 1_000_000,
    },
  })

test('buildCloseTicketHtml: đủ mục, escape HTML, chữ không viết tắt', () => {
  const html = buildCloseTicketHtml({ shopName: 'Quán <FNet>', result: result(), type: 1 })
  assert.match(html, /PHIẾU CHỐT CA/)
  assert.match(html, /Quán &lt;FNet&gt;/)
  assert.match(html, /Nguyễn &lt;A&gt;/)
  assert.match(html, /Chuyển khoản/)
  assert.match(html, /Tiền thực đếm/)
  assert.match(html, /Chênh lệch/)
  assert.match(html, /Hoàn tiền/)
  assert.doesNotMatch(html, /<A>/)
  assert.doesNotMatch(html, /SĐT|\bCK\b/)
})

test('buildCloseTicketHtml: không vỡ khi thiếu countedCash / chênh lệch / summary / tên quán', () => {
  const noCount = buildCloseTicketHtml({
    shopName: '',
    result: result({ countedCash: null, cashDiff: null, note: '' }),
    type: 2,
  })
  assert.match(noCount, /Không nhập/)
  assert.doesNotMatch(noCount, /Chênh lệch/)
  assert.doesNotMatch(noCount, /undefined|NaN|null/)

  const noSummary = normalizeCloseResult({ shift: { shiftId: 1, openTime: 'a', closeTime: 'b' } })
  const html = buildCloseTicketHtml({ shopName: '', result: noSummary, type: 1 })
  assert.match(html, /PHIẾU CHỐT CA/)
  assert.doesNotMatch(html, /undefined|NaN/)
})
