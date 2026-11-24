import assert from 'node:assert/strict'
import test from 'node:test'
import {
  FREE_TIME_MAX_MINUTES,
  FREE_TIME_PRESETS,
  FREE_TIME_UI_MAX_MINUTES,
  describeGiveFreeTimeError,
  describeParsedMinutes,
  formatMinutes,
  parseMinutes,
} from '../src/features/customers/staffFreeTimeModel.ts'

test('trần phút trùng dialog MFC / REST', () => {
  assert.equal(FREE_TIME_MAX_MINUTES, 30_000_000)
})

test('parseMinutes: số nguyên dương hợp lệ', () => {
  assert.deepEqual(parseMinutes('90'), { ok: true, minutes: 90 })
  assert.deepEqual(parseMinutes('  45 '), { ok: true, minutes: 45 })
  assert.deepEqual(parseMinutes('007'), { ok: true, minutes: 7 })
})

test('parseMinutes: rỗng / 0 / âm / thập phân / chữ bị từ chối đúng lý do', () => {
  assert.deepEqual(parseMinutes(''), { ok: false, reason: 'empty' })
  assert.deepEqual(parseMinutes('   '), { ok: false, reason: 'empty' })
  assert.deepEqual(parseMinutes('0'), { ok: false, reason: 'invalid' })
  assert.deepEqual(parseMinutes('-5'), { ok: false, reason: 'invalid' })
  assert.deepEqual(parseMinutes('1.5'), { ok: false, reason: 'invalid' })
  assert.deepEqual(parseMinutes('abc'), { ok: false, reason: 'invalid' })
})

test('trần nhập trên web (100 ngày) thấp hơn trần server', () => {
  assert.equal(FREE_TIME_UI_MAX_MINUTES, 144_000)
  assert.ok(FREE_TIME_UI_MAX_MINUTES < FREE_TIME_MAX_MINUTES)
})

test('parseMinutes: đúng trần được, quá trần bị chặn, số khổng lồ không vỡ', () => {
  assert.deepEqual(parseMinutes(String(FREE_TIME_UI_MAX_MINUTES)), { ok: true, minutes: FREE_TIME_UI_MAX_MINUTES })
  assert.deepEqual(parseMinutes(String(FREE_TIME_UI_MAX_MINUTES + 1)), { ok: false, reason: 'too-large' })
  // Trần server (MFC) cũng bị chặn ở web.
  assert.deepEqual(parseMinutes(String(FREE_TIME_MAX_MINUTES)), { ok: false, reason: 'too-large' })
  assert.deepEqual(parseMinutes('9'.repeat(30)), { ok: false, reason: 'invalid' })
})

test('formatMinutes', () => {
  assert.equal(formatMinutes(45), '45 phút')
  assert.equal(formatMinutes(120), '2 giờ')
  assert.equal(formatMinutes(150), '2 giờ 30 phút')
  assert.equal(formatMinutes(0), '0 phút')
  assert.equal(formatMinutes(Number.NaN), '0 phút')
})

test('describeParsedMinutes: không báo lỗi khi chưa gõ', () => {
  assert.equal(describeParsedMinutes(parseMinutes('')), '')
  assert.equal(describeParsedMinutes(parseMinutes('150')), '= 2 giờ 30 phút')
  assert.match(describeParsedMinutes(parseMinutes('x')), /số nguyên dương/)
  assert.match(describeParsedMinutes(parseMinutes('999999999')), /Tối đa/)
})

test('mốc bấm nhanh tăng dần và đều hợp lệ', () => {
  const minutes = FREE_TIME_PRESETS.map((preset) => preset.minutes)
  assert.deepEqual(minutes, [...minutes].sort((a, b) => a - b))
  for (const preset of FREE_TIME_PRESETS) assert.equal(parseMinutes(String(preset.minutes)).ok, true)
})

test('describeGiveFreeTimeError: map các message của server', () => {
  assert.match(describeGiveFreeTimeError({ message: 'user is not a staff' }), /không phải nhân viên/)
  assert.match(describeGiveFreeTimeError({ message: 'minutes too large' }), /vượt giới hạn/)
  assert.match(describeGiveFreeTimeError({ message: 'invalid note' }), /Ghi chú/)
  assert.match(describeGiveFreeTimeError({ message: 'idem is required' }), /thử lại/)
  assert.match(describeGiveFreeTimeError({ message: 'missing/invalid userId, minutes or staffId' }), /Kiểm tra số phút/)
  assert.match(describeGiveFreeTimeError({ message: 'admin required' }), /quản trị viên/)
  assert.match(describeGiveFreeTimeError({ message: 'cannot give time to self' }), /chính mình/)
  assert.match(describeGiveFreeTimeError({ message: 'staff not found' }), /không tìm thấy/i)
  assert.match(describeGiveFreeTimeError({ message: 'idem already used by another transaction' }), /trùng mã/)
  assert.match(describeGiveFreeTimeError({ message: 'db error' }), /nhật ký máy chủ/)
  assert.match(describeGiveFreeTimeError({ httpStatus: 404 }), /cập nhật Server/)
  assert.equal(describeGiveFreeTimeError({ message: 'db down' }), 'db down')
  assert.match(describeGiveFreeTimeError({}), /Không tặng được/)
})
