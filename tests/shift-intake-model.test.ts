import assert from 'node:assert/strict'
import test from 'node:test'
import {
  describeIntakePending,
  formatClock,
  formatElapsed,
  isIntakePaused,
  isManualPaused,
  isNoShiftWarningOnly,
  isPauseOverdue,
  normalizeCurrent,
  normalizeOrderPause,
  normalizeOrderPauseResponse,
  normalizeShiftModeSetting,
  parseServerStamp,
  pauseChipText,
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

// Hợp đồng chốt 2026-11-21 (`handoff/HANDOFF_work-shift-S3b-be.md` mục 3): tách nguồn khỏi lý do.
const manualRaw = {
  on: true,
  manual: { on: true, since: '2026-11-21 10:02:00', byStaffId: 7, byName: 'A', reason: 'Kiểm kho giao ca' },
  noShift: false,
  pendingOrders: { service: 3, combo: 1, qrPaid: 1 },
}
const idleRaw = {
  on: false,
  manual: { on: false, since: null, byStaffId: null, byName: null, reason: null },
  noShift: false,
  pendingOrders: { service: 2, combo: 0, qrPaid: 0 },
}

test('normalizeOrderPause: cờ thủ công — manual.on, giờ, tên, lý do người gõ, số đơn chờ', () => {
  const pause = normalizeOrderPause(manualRaw)
  assert.ok(pause)
  assert.equal(pause.on, true)
  assert.equal(pause.manual.on, true)
  assert.equal(pause.manual.since, '2026-11-21 10:02:00')
  assert.equal(pause.manual.byStaffId, 7)
  assert.equal(pause.manual.byName, 'A')
  assert.equal(pause.manual.reason, 'Kiểm kho giao ca')
  assert.equal(pause.noShift, false)
  assert.deepEqual(pause.pendingOrders, { service: 3, combo: 1, qrPaid: 1 })
  assert.equal(isManualPaused(pause), true)
})

test('normalizeOrderPause: không ngừng — manual toàn null ⇒ chuỗi rỗng, số đơn chờ vẫn giữ để hộp xác nhận hiện', () => {
  const off = normalizeOrderPause(idleRaw)
  assert.ok(off)
  assert.equal(off.on, false)
  assert.deepEqual(off.manual, { on: false, since: '', byStaffId: 0, byName: '', reason: '' })
  assert.equal(off.pendingOrders.service, 2)
  assert.equal(isIntakePaused(off), false)
  assert.equal(isManualPaused(off), false)
})

test('normalizeOrderPause: noShift + chế độ 2 ⇒ on mà không manual (khoá, không có nút Tiếp tục)', () => {
  const pause = normalizeOrderPause({ ...idleRaw, on: true, noShift: true })
  assert.ok(pause)
  assert.equal(isIntakePaused(pause), true)
  assert.equal(isManualPaused(pause), false)
  assert.equal(isNoShiftWarningOnly(pause), false)
  assert.equal(pauseHeadline(pause), 'Chưa có ca nào mở — đang dừng nhận đơn')
})

test('normalizeOrderPause: noShift + chế độ 1 ⇒ on=false mà noShift=true: CHỈ cảnh báo, không khoá nút', () => {
  const pause = normalizeOrderPause({ ...idleRaw, on: false, noShift: true })
  assert.ok(pause)
  assert.equal(isIntakePaused(pause), false) // nút Tạo đơn không khoá
  assert.equal(isNoShiftWarningOnly(pause), true)
  assert.equal(pauseHeadline(pause), 'Chưa có ca nào đang mở')
})

test('normalizeOrderPause: A ngừng thủ công rồi chốt ca cuối ⇒ manual.on VÀ noShift cùng true — hỏi theo manual, headline là của người ngừng', () => {
  const pause = normalizeOrderPause({ ...manualRaw, noShift: true })
  assert.ok(pause)
  assert.equal(isManualPaused(pause), true) // Dialog Mở ca hỏi "Tiếp tục nhận đơn?" dựa vào đây
  assert.equal(isNoShiftWarningOnly(pause), false)
  assert.match(pauseHeadline(pause), /^Dừng nhận đơn từ 10:02 · A/)
})

test('normalizeOrderPause: thiếu / sai kiểu ⇒ null hoặc coi như đang nhận đơn', () => {
  assert.equal(normalizeOrderPause(undefined), null)
  assert.equal(normalizeOrderPause('on'), null)
  assert.equal(normalizeOrderPause([]), null)
  assert.equal(isIntakePaused(null), false)
  assert.equal(isManualPaused(null), false)
  assert.equal(normalizeOrderPause({ on: 'abc' })?.on, false) // chuỗi lạ ⇒ coi như đang nhận đơn
  assert.equal(normalizeOrderPause({ on: true })?.manual.on, false) // thiếu manual ⇒ không có nút Tiếp tục
  assert.deepEqual(normalizeOrderPause({ on: true, pendingOrders: { service: -3, combo: 'x' } })?.pendingOrders, {
    service: 0,
    combo: 0,
    qrPaid: 0,
  })
  // Bản cũ: `reason` chỉ là chữ người gõ, không còn là mã nguồn.
  assert.equal(normalizeOrderPause({ ...manualRaw, manual: { ...manualRaw.manual, reason: 'no_shift' } })?.manual.reason, 'no_shift')
})

test('normalizeCurrent: orderPause độc lập chế độ ca — mang theo cả mode 0 (nếu máy chủ gửi) lẫn mode ≥ 1', () => {
  // Mode 0: vẫn không có ca (enabled=false) nhưng giữ orderPause để nút Ngừng/Nhận đơn dùng được (user chốt 2026-11-25).
  const off = normalizeCurrent({ enabled: false, mode: 0, orderPause: manualRaw })
  assert.equal(off.enabled, false)
  assert.equal(off.shift, null)
  assert.equal(off.orderPause?.on, true)
  assert.equal(off.orderPause?.manual.byName, 'A')
  // Máy chủ cũ không gửi orderPause ở mode 0 ⇒ null ⇒ ẩn nút.
  assert.equal(normalizeCurrent({ enabled: false, mode: 0 }).orderPause, null)
  const on = normalizeCurrent({ enabled: true, mode: 2, shift: null, orderPause: manualRaw })
  assert.equal(on.orderPause?.on, true)
  assert.equal(normalizeCurrent({ enabled: true, mode: 1 }).orderPause, null) // máy chủ cũ không gửi
})

test('normalizeOrderPauseResponse: {changed, orderPause} cùng hình dạng /shift/current', () => {
  const a = normalizeOrderPauseResponse({ changed: true, orderPause: manualRaw })
  assert.equal(a.changed, true)
  assert.equal(a.orderPause?.manual.byName, 'A')
  const b = normalizeOrderPauseResponse({ changed: false, orderPause: idleRaw })
  assert.equal(b.changed, false)
  assert.equal(b.orderPause?.on, false)
  assert.deepEqual(normalizeOrderPauseResponse(undefined), { changed: false, orderPause: null })
})

test('pauseHeadline / pauseResumeQuestion theo đúng câu design 8b', () => {
  const pause = normalizeOrderPause(manualRaw)
  assert.ok(pause)
  assert.equal(pauseHeadline(pause), 'Dừng nhận đơn từ 10:02 · A · Lý do: Kiểm kho giao ca')
  assert.equal(
    pauseHeadline({ ...pause, manual: { ...pause.manual, reason: '' } }),
    'Dừng nhận đơn từ 10:02 · A',
  )
  assert.equal(pauseResumeQuestion(pause), 'Dừng nhận đơn từ 10:02 (bởi A). Tiếp tục nhận đơn?')
  assert.equal(
    pauseResumeQuestion({ ...pause, manual: { ...pause.manual, byName: '' } }),
    'Dừng nhận đơn từ 10:02. Tiếp tục nhận đơn?',
  )
})

test('pauseChipText (khối ở topbar): chữ gọn luôn giữ ý chính; giờ ở bản đầy đủ; tên + lý do + thời gian ở tooltip', () => {
  const manual = normalizeOrderPause(manualRaw)
  assert.ok(manual)
  const chip = pauseChipText(manual, 47)
  assert.equal(chip.short, 'Dừng nhận đơn')
  assert.equal(chip.long, 'Dừng nhận đơn từ 10:02') // gọn: không còn tên người ngừng trên thanh
  assert.doesNotMatch(chip.long, /·/)
  assert.match(chip.tooltip, / · A/) // tên người ngừng nằm ở tooltip
  assert.match(chip.tooltip, /Lý do: Kiểm kho giao ca/)
  assert.match(chip.tooltip, /Đã dừng 47 phút/)
  assert.match(chip.tooltip, /Tiếp tục nhận đơn/) // quá 30 phút: nhắc bấm tiếp tục
  assert.doesNotMatch(pauseChipText(manual, 12).tooltip, /kiểm kho xong thì bấm/i)
  assert.doesNotMatch(pauseChipText(manual, null).tooltip, /Đã dừng \d/)

  const blocking = normalizeOrderPause({ ...idleRaw, on: true, noShift: true })
  assert.ok(blocking)
  assert.equal(pauseChipText(blocking, null).short, 'Dừng nhận đơn')
  assert.equal(pauseChipText(blocking, null).long, 'Chưa có ca nào mở — đang dừng nhận đơn')

  const warn = normalizeOrderPause({ ...idleRaw, noShift: true })
  assert.ok(warn)
  assert.equal(pauseChipText(warn, null).short, 'Chưa có ca nào mở')
  assert.match(pauseChipText(warn, null).tooltip, /vẫn nhận đơn/)
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
  // Nguồn đã tách khỏi lý do (`manual.reason` chỉ là chữ người gõ) ⇒ gõ gì cũng được, kể cả chữ "no_shift".
  assert.equal(validatePauseReason('no_shift'), undefined)
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
  // GET thêm `enabled`; PUT thêm `changed` (false = đã đúng chế độ đó từ trước).
  assert.deepEqual(normalizeShiftModeSetting({ mode: 1, effective: 1, enabled: true }), { mode: 1, effective: 1, enabled: true })
  assert.deepEqual(normalizeShiftModeSetting({ mode: 2, effective: 1, changed: false }), { mode: 2, effective: 1, changed: false })
  assert.equal(normalizeShiftModeSetting({ mode: 2, effective: 1, changed: 1 }).changed, true)
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
