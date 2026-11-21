import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeIntakePending,
  formatClock,
  formatElapsed,
  isIntakePaused,
  isPauseOverdue,
  normalizeCurrent,
  normalizeOrderPause,
  normalizeOrderPauseResponse,
  normalizeShiftModeSetting,
  parseServerStamp,
  pauseElapsedMinutes,
  pauseHeadline,
  pauseResumeQuestion,
  validatePauseReason,
} from '../src/features/shifts/shiftModel.ts'
import {
  SHIFT_MODE_OPTIONS,
  describeShiftModeError,
  shiftModeFromValue,
  shiftModeToValue,
} from '../src/features/shifts/shiftModeModel.ts'

const manualRaw = {
  on: 1,
  since: '2026-11-21 10:02:00',
  byStaffId: 7,
  byName: 'A',
  reason: 'Kiểm kho giao ca',
  pendingOrders: { service: 3, combo: 1, qrPaid: 1 },
}

test('normalizeOrderPause: hợp đồng B3 (on số 1, lý do người gõ) ⇒ nguồn manual', () => {
  const pause = normalizeOrderPause(manualRaw)
  assert.ok(pause)
  assert.equal(pause.on, true)
  assert.equal(pause.source, 'manual')
  assert.equal(pause.byName, 'A')
  assert.equal(pause.reason, 'Kiểm kho giao ca')
  assert.deepEqual(pause.pendingOrders, { service: 3, combo: 1, qrPaid: 1 })
})

test('normalizeOrderPause: reason = "no_shift" (design 8b, S4b) là mã nguồn tự động, không phải lý do người gõ', () => {
  const pause = normalizeOrderPause({ on: true, reason: 'no_shift', since: '2026-11-21 10:02:00' })
  assert.ok(pause)
  assert.equal(pause.source, 'no_shift')
  assert.equal(pause.reason, '')
  assert.equal(pauseHeadline(pause), 'Chưa có ca nào mở — đang ngừng nhận đơn')
  // `source` tường minh cũng được nhận; reason "manual" là mã, không hiện thành lý do.
  const explicit = normalizeOrderPause({ on: true, source: 'no_shift' })
  assert.equal(explicit?.source, 'no_shift')
  assert.equal(normalizeOrderPause({ on: true, reason: 'manual', since: '2026-11-21 10:02:00' })?.reason, '')
})

test('normalizeOrderPause: không ngừng / thiếu / sai kiểu', () => {
  const off = normalizeOrderPause({ on: 0, pendingOrders: { service: 2 } })
  assert.equal(off?.on, false)
  assert.equal(off?.since, '')
  assert.equal(off?.pendingOrders.service, 2) // số đơn chờ vẫn giữ để hộp xác nhận hiện
  assert.equal(isIntakePaused(off), false)
  assert.equal(normalizeOrderPause(undefined), null)
  assert.equal(normalizeOrderPause('on'), null)
  assert.equal(normalizeOrderPause([]), null)
  assert.equal(isIntakePaused(null), false)
  assert.equal(normalizeOrderPause({ on: 'abc' })?.on, false) // chuỗi lạ ⇒ coi như đang nhận đơn
  assert.deepEqual(normalizeOrderPause({ on: 1, pendingOrders: { service: -3, combo: 'x' } })?.pendingOrders, {
    service: 0,
    combo: 0,
    qrPaid: 0,
  })
})

test('normalizeCurrent: mode 0 bỏ qua orderPause; mode ≥ 1 mang theo orderPause', () => {
  const off = normalizeCurrent({ enabled: false, mode: 0, orderPause: manualRaw })
  assert.equal(off.orderPause, null)
  const on = normalizeCurrent({ enabled: true, mode: 2, shift: null, orderPause: manualRaw })
  assert.equal(on.orderPause?.on, true)
  assert.equal(normalizeCurrent({ enabled: true, mode: 1 }).orderPause, null) // máy chủ cũ không gửi
})

test('normalizeOrderPauseResponse: nhận cả state lẫn orderPause', () => {
  const a = normalizeOrderPauseResponse({ changed: true, state: manualRaw })
  assert.equal(a.changed, true)
  assert.equal(a.orderPause?.byName, 'A')
  const b = normalizeOrderPauseResponse({ changed: false, orderPause: manualRaw })
  assert.equal(b.changed, false)
  assert.equal(b.orderPause?.on, true)
  assert.deepEqual(normalizeOrderPauseResponse(undefined), { changed: false, orderPause: null })
})

test('pauseHeadline / pauseResumeQuestion theo đúng câu design 8b', () => {
  const pause = normalizeOrderPause(manualRaw)
  assert.ok(pause)
  assert.equal(pauseHeadline(pause), 'Đang ngừng nhận đơn từ 10:02 · A · Lý do: Kiểm kho giao ca')
  assert.equal(pauseHeadline({ ...pause, reason: '' }), 'Đang ngừng nhận đơn từ 10:02 · A')
  assert.equal(pauseResumeQuestion(pause), 'Đang ngừng nhận đơn từ 10:02 (bởi A). Tiếp tục nhận đơn?')
  assert.equal(pauseResumeQuestion({ ...pause, byName: '' }), 'Đang ngừng nhận đơn từ 10:02. Tiếp tục nhận đơn?')
})

test('parseServerStamp + pauseElapsedMinutes: tính theo giờ máy chủ, không theo đồng hồ trình duyệt', () => {
  assert.equal(parseServerStamp('không phải ngày'), null)
  assert.equal(parseServerStamp('2026-11-21 10:02'), parseServerStamp('2026-11-21 10:02:00'))
  const since = '2026-11-21 10:02:00'
  const serverTime = '2026-11-21 10:20:30'
  const fetchedAt = 1_000_000
  // Vừa tải: 18 phút 30 giây ⇒ 18.
  assert.equal(pauseElapsedMinutes(since, serverTime, fetchedAt, fetchedAt), 18)
  // 90 giây sau khi tải ⇒ 20 phút (18'30" + 1'30").
  assert.equal(pauseElapsedMinutes(since, serverTime, fetchedAt, fetchedAt + 90_000), 20)
  // Đồng hồ trình duyệt chạy lùi không làm số âm / giảm.
  assert.equal(pauseElapsedMinutes(since, serverTime, fetchedAt, fetchedAt - 5_000), 18)
  // since sau serverTime (lệch) ⇒ 0, không âm.
  assert.equal(pauseElapsedMinutes('2026-11-21 11:00:00', serverTime, fetchedAt, fetchedAt), 0)
  assert.equal(pauseElapsedMinutes('', serverTime, fetchedAt, fetchedAt), null)
  assert.equal(pauseElapsedMinutes(since, '', fetchedAt, fetchedAt), null)
  assert.equal(pauseElapsedMinutes(since, serverTime, 0, fetchedAt), null) // chưa từng tải
})

test('isPauseOverdue: mốc 30 phút (Q10) — đúng 30 là quá hạn, 29 chưa, null chưa', () => {
  assert.equal(isPauseOverdue(29), false)
  assert.equal(isPauseOverdue(30), true)
  assert.equal(isPauseOverdue(47), true)
  assert.equal(isPauseOverdue(null), false)
})

test('formatElapsed / formatClock', () => {
  assert.equal(formatElapsed(0), '0 phút')
  assert.equal(formatElapsed(45), '45 phút')
  assert.equal(formatElapsed(65), '1 giờ 05 phút')
  assert.equal(formatElapsed(120), '2 giờ')
  assert.equal(formatClock('2026-11-21 09:05:09'), '09:05')
  assert.equal(formatClock('lạ'), 'lạ')
})

test('describeIntakePending: chỉ liệt kê loại có đơn', () => {
  assert.equal(describeIntakePending({ service: 0, combo: 0, qrPaid: 0 }), '')
  assert.equal(
    describeIntakePending({ service: 3, combo: 1, qrPaid: 1 }),
    '3 món chờ duyệt, 1 combo chờ xác nhận, 1 đơn QR đã trả chưa xác nhận',
  )
  assert.equal(describeIntakePending({ service: 0, combo: 2, qrPaid: 0 }), '2 combo chờ xác nhận')
})

test('validatePauseReason: ≤ 40 ký tự, không dấu nháy đơn / gạch chéo ngược (server isSqlSafeText)', () => {
  assert.equal(validatePauseReason(''), undefined)
  assert.equal(validatePauseReason('Kiểm kho giao ca'), undefined)
  assert.equal(validatePauseReason('x'.repeat(40)), undefined)
  assert.ok(validatePauseReason('x'.repeat(41)))
  assert.ok(validatePauseReason("it's"))
  assert.ok(validatePauseReason('a\\b'))
  // Mã nguồn của `orderPause.reason` không được là lý do người gõ (sẽ bị đọc nhầm thành nguồn tự động).
  assert.ok(validatePauseReason('no_shift'))
  assert.ok(validatePauseReason(' Manual '))
  assert.equal(validatePauseReason('manual stock check'), undefined)
})

test('normalizeOrderPauseResponse: changed dạng số 1 cũng là đã đổi', () => {
  assert.equal(normalizeOrderPauseResponse({ changed: 1 }).changed, true)
  assert.equal(normalizeOrderPauseResponse({ changed: 0 }).changed, false)
})

test('normalizeShiftModeSetting: chỉ 0/1/2; effective thiếu ⇒ bằng mode; ngoài khoảng ⇒ 0', () => {
  assert.deepEqual(normalizeShiftModeSetting({ mode: 2, effective: 1 }), { mode: 2, effective: 1 })
  assert.deepEqual(normalizeShiftModeSetting({ mode: '1' }), { mode: 1, effective: 1 })
  assert.deepEqual(normalizeShiftModeSetting({ mode: 7, effective: 9 }), { mode: 0, effective: 0 })
  assert.deepEqual(normalizeShiftModeSetting(undefined), { mode: 0, effective: 0 })
})

test('chế độ ca: nhãn đúng chữ user chốt, chuyển đổi giá trị Segmented', () => {
  assert.deepEqual(
    SHIFT_MODE_OPTIONS.map((item) => item.label),
    ['Tắt', 'Ghi sổ (chưa chặn)', 'Bắt buộc mở ca'],
  )
  assert.deepEqual(
    SHIFT_MODE_OPTIONS.map((item) => item.mode),
    [0, 1, 2],
  )
  assert.equal(shiftModeToValue(2), '2')
  assert.equal(shiftModeFromValue('1'), 1)
  assert.equal(shiftModeFromValue('2'), 2)
  assert.equal(shiftModeFromValue('x'), 0)
  assert.equal(shiftModeFromValue('3'), 0)
})

test('describeShiftModeError: 403, INVALID_INPUT, chưa hỗ trợ, lỗi khác', () => {
  assert.match(describeShiftModeError({ httpStatus: 403 }), /quản trị viên/)
  assert.match(describeShiftModeError({ message: 'forbidden' }), /quản trị viên/)
  assert.match(describeShiftModeError({ code: 'INVALID_INPUT' }), /không hợp lệ/)
  assert.match(describeShiftModeError({ httpStatus: 404 }), /chưa hỗ trợ/)
  assert.equal(describeShiftModeError({ message: 'Mất kết nối' }), 'Mất kết nối')
  assert.match(describeShiftModeError({}), /Không đổi được/)
})
