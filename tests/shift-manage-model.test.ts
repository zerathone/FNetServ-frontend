import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PAYMENT_METHODS,
  SHIFT_RIGHTS,
  canForceClose,
  canViewAllShifts,
  cashDiffView,
  classifyShiftError,
  formatDayMonth,
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
  shiftDayView,
  shiftStatusView,
  sortShifts,
  summarizeDay,
  todayYmd,
  validateForceCloseNote,
} from '../src/features/shifts/shiftManageModel.ts'
import {
  buildCloseTicketHtml,
  describeDrift,
  hasDrift,
  normalizeSummary,
  normalizeSummaryResponse,
} from '../src/features/shifts/shiftModel.ts'

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
  assert.deepEqual(list.reconcile?.excludedNoUser, { count: 0, total: 0 })
})

test('normalizeShiftList S3-fix: revenueOnDate / crossDay / drift / note; máy chủ cũ ⇒ suy ra từ revenue và giờ mở/chốt', () => {
  const [full] = normalizeShiftList({
    shifts: [
      rawShift({
        revenue: '1000000',
        revenueOnDate: '400000',
        crossDay: { openDate: '2026-11-20', closeDate: '2026-11-21' },
        drift: { total: '50000', cash: 50000 },
        note: 'Quên chốt ca',
        openTime: '2026-11-20 22:00:00',
      }),
    ],
  }).shifts
  assert.equal(full.revenueOnDate, 400000)
  assert.equal(full.revenue, 1000000)
  assert.deepEqual(full.crossDay, { openDate: '2026-11-20', closeDate: '2026-11-21' })
  assert.deepEqual(full.drift, { total: 50000, cash: 50000 })
  assert.equal(full.note, 'Quên chốt ca')

  const [old] = normalizeShiftList({ shifts: [rawShift()] }).shifts
  assert.equal(old.revenueOnDate, old.revenue)
  assert.deepEqual(old.crossDay, { openDate: '2026-11-21', closeDate: '2026-11-21' })
  assert.equal(old.drift, null)

  // Ca đang mở: closeDate null và không có drift (dù máy chủ gửi lạc).
  const [open] = normalizeShiftList({
    shifts: [rawShift({ status: 1, closeTime: '', crossDay: { openDate: '2026-11-21', closeDate: null }, drift: { total: 5, cash: 5 } })],
  }).shifts
  assert.equal(open.crossDay.closeDate, null)
  assert.equal(open.drift, null)
})

test('shiftDayView: ca qua đêm hiện ở mọi ngày chạm tới — ngày mở ghi "chốt ngày …", ngày chốt đủ số; ca mở hôm nay thì đủ số', () => {
  const night = { openDate: '2026-11-20', closeDate: '2026-11-21' }
  // Ngày MỞ (20/11): còn kéo sang sau ⇒ ô tiền để "—", ghi chú chốt ngày 21/11.
  const openDay = shiftDayView({ crossDay: night }, '2026-11-20', '2026-11-22')
  assert.deepEqual(openDay, { crossesDays: true, continuesAfter: true, note: 'Ca qua đêm, chốt ngày 21/11' })
  // Ngày CHỐT (21/11): hiện đủ, ghi chú mở từ 20/11.
  const closeDay = shiftDayView({ crossDay: night }, '2026-11-21', '2026-11-22')
  assert.deepEqual(closeDay, { crossesDays: true, continuesAfter: false, note: 'Ca qua đêm, mở từ ngày 20/11' })
  // Ca trong ngày: không ghi chú.
  assert.deepEqual(shiftDayView({ crossDay: { openDate: '2026-11-21', closeDate: '2026-11-21' } }, '2026-11-21', '2026-11-21'), {
    crossesDays: false,
    continuesAfter: false,
    note: '',
  })
  // Ca đang mở từ hôm qua, xem HÔM NAY: tiền mặt dự kiến hiện tại có nghĩa ⇒ đủ số; xem hôm qua: còn kéo sang sau.
  const openNight = { openDate: '2026-11-20', closeDate: null }
  assert.deepEqual(shiftDayView({ crossDay: openNight }, '2026-11-21', '2026-11-21'), {
    crossesDays: true,
    continuesAfter: false,
    note: 'Ca qua đêm, mở từ ngày 20/11',
  })
  assert.deepEqual(shiftDayView({ crossDay: openNight }, '2026-11-20', '2026-11-21'), {
    crossesDays: true,
    continuesAfter: true,
    note: 'Ca qua đêm, chưa chốt',
  })
  // Ca mở trong ngày hôm nay: bình thường.
  assert.equal(shiftDayView({ crossDay: { openDate: '2026-11-21', closeDate: null } }, '2026-11-21', '2026-11-21').note, '')
  assert.equal(formatDayMonth('2026-11-05'), '05/11')
  assert.equal(formatDayMonth('lạ'), 'lạ')
})

test('drift: khác 0 ở tổng hoặc tiền mặt ⇒ cảnh báo; câu mô tả đúng chiều (số chụp − số tính lại)', () => {
  assert.equal(hasDrift(null), false)
  assert.equal(hasDrift({ total: 0, cash: 0 }), false)
  assert.equal(hasDrift({ total: 0, cash: -1 }), true)
  assert.deepEqual(describeDrift({ total: 50000, cash: 0 }), ['Doanh thu tính lại hiện thấp hơn số lúc chốt 50.000 đ.'])
  assert.deepEqual(describeDrift({ total: -20000, cash: 20000 }), [
    'Doanh thu tính lại hiện cao hơn số lúc chốt 20.000 đ.',
    'Tiền mặt tính lại hiện thấp hơn số lúc chốt 20.000 đ.',
  ])
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

test('summarizeDay: đếm ca đang mở / treo / mở từ hôm trước / số liệu đổi; tổng doanh thu cộng PHẦN THUỘC NGÀY của các ca', () => {
  const shifts = normalizeShiftList({
    shifts: [
      rawShift({ shiftId: 1, revenue: 100, drift: { total: 10, cash: 0 } }),
      rawShift({ shiftId: 2, status: 1, closeTime: '', revenue: 50 }),
      rawShift({ shiftId: 3, status: 1, closeTime: '', hung: true, openTime: '2026-11-20 20:00:00', revenue: 100, revenueOnDate: 25 }),
    ],
  }).shifts
  const totals = summarizeDay(shifts, '2026-11-21')
  // ca 3 qua đêm: cả ca 100 nhưng chỉ 25 thuộc ngày ⇒ 100 + 50 + 25 = 175 (không phải 250)
  assert.deepEqual(totals, { shiftCount: 3, openCount: 2, hungCount: 1, carriedOver: 1, revenueTotal: 175, driftCount: 1 })
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

test('đối soát: excludedNoUser đọc được cả dạng {count,total} lẫn hai trường phẳng; mặc định 0', () => {
  assert.deepEqual(normalizeReconcile({ excludedNoUser: { count: '2', total: '60000' } }).excludedNoUser, { count: 2, total: 60000 })
  assert.deepEqual(normalizeReconcile({ excludedNoUser: 3, excludedNoUserTotal: 90000 }).excludedNoUser, { count: 3, total: 90000 })
  assert.deepEqual(normalizeReconcile({}).excludedNoUser, { count: 0, total: 0 })
  const list = normalizeShiftList({
    shifts: [],
    reconcile: { reportTotal: 10, bucketTotal: 10, diff: 0, excludedNoUser: { count: 1, total: 5 } },
  })
  assert.deepEqual(reconcileFromList(list)?.excludedNoUser, { count: 1, total: 5 })
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

test('normalizeShiftStock: open/delta null khi không có ảnh chụp đầu ca (không đổi thành 0); cờ openSnapshot/closeSnapshot', () => {
  const stock = normalizeShiftStock({
    available: true,
    openSnapshot: false,
    closeSnapshot: true,
    rows: [
      { materialId: 1, name: 'Sữa', unit: 'lon', open: null, close: 8, delta: null, imported: 0, exported: 2, adjusted: 0 },
      { materialId: 2, name: 'Trứng', unit: 'quả', open: 0, close: 5, imported: 5, exported: 0, adjusted: 0 },
    ],
  })
  assert.equal(stock.openSnapshot, false)
  assert.equal(stock.closeSnapshot, true)
  assert.equal(stock.rows[0].open, null)
  assert.equal(stock.rows[0].delta, null)
  assert.equal(stock.rows[1].open, 0) // 0 thật khác với "không có"
  assert.equal(stock.rows[1].delta, 5)
  assert.equal(normalizeShiftStock({ rows: [] }).openSnapshot, true) // thiếu cờ ⇒ coi như có
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
  assert.equal(page.total, 120) // số phiếu của ô, không phải số dòng của trang
  assert.equal(page.items[0].voucherId, '12345')
  assert.equal(page.items[0].amount, 50000)
  assert.equal(normalizeShiftPayments({ items: [{}, {}] }).total, 2)
  // `sumAmount` = tổng tiền của cả ô (máy chủ tính); thiếu ⇒ cộng các dòng đang có.
  assert.equal(normalizeShiftPayments({ total: 120, sumAmount: '6000000', items: [] }).sumAmount, 6000000)
  assert.equal(normalizeShiftPayments({ items: [{ amount: 10 }, { amount: 5 }] }).sumAmount, 15)
})

test('methodLabel: 4 hình thức không viết tắt; khoá lạ giữ nguyên', () => {
  assert.deepEqual(PAYMENT_METHODS.map((m) => m.label), ['Tiền mặt', 'Chuyển khoản', 'QR', 'Cấn trừ'])
  assert.equal(methodLabel('online'), 'Chuyển khoản')
  assert.equal(methodLabel('zalo'), 'zalo')
})

test('normalizeSummary S3: refundsQrCanceled / onlineBook / drift — thiếu hoặc null ⇒ null (không hiện dòng nhắc)', () => {
  const none = normalizeSummary({ sources: [] })
  assert.equal(none.refundsQrCanceled, null)
  assert.equal(none.onlineBook, null)
  assert.equal(none.drift, null)
  const some = normalizeSummary({ sources: [], refundsQrCanceled: { count: '2', total: '180000' } })
  assert.deepEqual(some.refundsQrCanceled, { count: 2, total: 180000 })
  assert.equal(normalizeSummary({ sources: [], refundsQrCanceled: 'x' }).refundsQrCanceled, null)
})

test('onlineBook (design 14b D20): trừ ví / hoàn ví / ròng; thiếu phần hoàn ví ⇒ 0; thiếu netTotal ⇒ đã trừ − đã hoàn', () => {
  const full = normalizeSummary({
    sources: [],
    onlineBook: { count: '3', walletTotal: '240000', creditCount: 1, creditTotal: 80000, netTotal: 160000 },
  })
  assert.deepEqual(full.onlineBook, { count: 3, walletTotal: 240000, creditCount: 1, creditTotal: 80000, netTotal: 160000 })
  const derived = normalizeSummary({ sources: [], onlineBook: { count: 2, walletTotal: 100, creditCount: 1, creditTotal: 30 } })
  assert.equal(derived.onlineBook?.netTotal, 70)
  const old = normalizeSummary({ sources: [], onlineBook: { count: 1, walletTotal: 60000 } })
  assert.deepEqual(old.onlineBook, { count: 1, walletTotal: 60000, creditCount: 0, creditTotal: 0, netTotal: 60000 })
})

test('normalizeSummaryResponse: refundsQrCanceled (null) / onlineBook / drift nằm CÙNG CẤP summary', () => {
  const res = normalizeSummaryResponse({
    live: false,
    shift: {},
    summary: { sources: [], expectedCash: 5 },
    refundsQrCanceled: null,
    onlineBook: { count: 1, walletTotal: 60000, creditCount: 0, creditTotal: 0, netTotal: 60000 },
    drift: { total: 50000, cash: 0 },
  })
  assert.ok(res)
  assert.equal(res.refundsQrCanceled, null)
  assert.equal(res.onlineBook?.netTotal, 60000)
  assert.deepEqual(res.drift, { total: 50000, cash: 0 })
  assert.equal(normalizeSummaryResponse({ live: true, shift: {}, summary: { sources: [] } })?.drift, null) // ca đang mở: không có drift
  assert.equal(normalizeSummaryResponse({ live: false, shift: {}, summary: null }), null)
})

test('listItemToCloseResult: phiếu ca đã đóng dựng được từ dòng danh sách, kể cả khi chưa có tóm tắt hay chưa đếm tiền', () => {
  const [item] = normalizeShiftList({ shifts: [rawShift({ countedCash: null, cashDiff: null })] }).shifts
  const summary = normalizeSummary({ sources: [{ key: 'member', name: 'Nạp hội viên', count: 1, cash: 100, online: 0, qr: 0, deduct: 0 }], expectedCash: 777 })
  const result = listItemToCloseResult({ ...item, expectedCash: null }, summary)
  assert.equal(result.shift.expectedCash, 777) // thiếu ở danh sách ⇒ lấy ở tóm tắt
  assert.equal(result.shift.closeTime, '2026-11-21 14:00:00')
  assert.equal(result.shift.note, '')
  assert.match(listItemToCloseResult({ ...item, status: 3 }, summary).shift.note, /cưỡng bức/) // máy chủ không có ghi chú
  assert.equal(listItemToCloseResult({ ...item, status: 3, note: 'Quên chốt ca' }, summary).shift.note, 'Quên chốt ca') // dùng lý do thật
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

test('quyền thật 9418 / 9419: admin luôn được; nhân viên cần đúng mã; nút Đóng cưỡng bức chỉ ở ca đang mở', () => {
  const none = () => false
  assert.equal(SHIFT_RIGHTS.VIEW_ALL, 9418) // Xem mọi ca làm việc
  assert.equal(SHIFT_RIGHTS.FORCE_CLOSE, 9419) // Đóng cưỡng bức ca làm việc
  assert.equal(canViewAllShifts(true, none), true)
  assert.equal(canViewAllShifts(false, none), false)
  assert.equal(canViewAllShifts(false, (code) => code === 9418), true)
  assert.equal(canViewAllShifts(false, (code) => code === 9419), false) // mã đóng cưỡng bức không cho xem mọi ca
  assert.equal(canForceClose(1, true, none), true)
  assert.equal(canForceClose(1, false, none), false)
  assert.equal(canForceClose(1, false, (code) => code === 9418), false) // chỉ quyền xem thì không có nút
  assert.equal(canForceClose(1, false, (code) => code === 9419), true)
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
