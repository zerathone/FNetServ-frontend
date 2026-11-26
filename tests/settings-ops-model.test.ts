import assert from 'node:assert/strict'
import test from 'node:test'
import {
  hourlyTime,
  isPausedResetInDomain,
  isRefundInDomain,
  minuteOfTime,
  normalizeChargeKeywords,
  validateBackupDraft,
  validateChargeKeywords,
  validatePausedResetMinutes,
  validateRefundMinutes,
} from '../src/features/settings/settingsOpsModel.ts'

const validDaily = { type: 2 as const, time: '21:30', day: null, compress: false, backupPath: 'D:\\SaoLuu' }

test('backup: tắt lịch không cần kiểm gì thêm', () => {
  assert.equal(validateBackupDraft({ ...validDaily, type: 0, backupPath: '' }), null)
})

test('backup: type khác 0 cần giờ hợp lệ, thư mục ổ đĩa cục bộ và không phải gốc ổ đĩa', () => {
  assert.equal(validateBackupDraft(validDaily), null)
  assert.match(validateBackupDraft({ ...validDaily, time: '' }) ?? '', /giờ/)
  assert.match(validateBackupDraft({ ...validDaily, time: '24:00' }) ?? '', /giờ/)
  assert.match(validateBackupDraft({ ...validDaily, backupPath: '' }) ?? '', /thư mục/i)
  assert.match(validateBackupDraft({ ...validDaily, backupPath: '\\\\may\\chia' }) ?? '', /ổ đĩa/)
  assert.match(validateBackupDraft({ ...validDaily, backupPath: 'D:\\a\\..\\b' }) ?? '', /\.\./)
  assert.match(validateBackupDraft({ ...validDaily, backupPath: 'D:\\' }) ?? '', /gốc/)
  assert.match(validateBackupDraft({ ...validDaily, backupPath: `D:\\${'a'.repeat(260)}` }) ?? '', /250/)
})

test('backup: mỗi tuần bắt chọn thứ 0..6, day null phải chọn lại', () => {
  assert.match(validateBackupDraft({ ...validDaily, type: 3, day: null }) ?? '', /thứ/)
  assert.equal(validateBackupDraft({ ...validDaily, type: 3, day: 0 }), null)
  assert.equal(validateBackupDraft({ ...validDaily, type: 3, day: 6 }), null)
  assert.match(validateBackupDraft({ ...validDaily, type: 3, day: 7 }) ?? '', /thứ/)
})

test('backup: mỗi giờ chỉ giữ phút và gửi 00:MM', () => {
  assert.equal(hourlyTime(5), '00:05')
  assert.equal(hourlyTime(59), '00:59')
  assert.equal(hourlyTime(75), '00:59')
  assert.equal(hourlyTime(-3), '00:00')
  assert.equal(minuteOfTime('13:45'), 45)
  assert.equal(minuteOfTime('bad'), 0)
})

test('hoàn tiền: miền 5..1440, giá trị cũ ngoài miền nhận diện được', () => {
  assert.equal(validateRefundMinutes(5), null)
  assert.equal(validateRefundMinutes(1440), null)
  assert.notEqual(validateRefundMinutes(4), null)
  assert.notEqual(validateRefundMinutes(1441), null)
  assert.notEqual(validateRefundMinutes(Number.NaN), null)
  assert.notEqual(validateRefundMinutes(10.5), null)
  assert.equal(isRefundInDomain(2), false)
})

test('máy trạm treo: chỉ 0 hoặc 3..60, 1 và 2 và trên 60 bị từ chối', () => {
  for (const ok of [0, 3, 30, 60]) assert.equal(validatePausedResetMinutes(ok), null)
  for (const bad of [1, 2, 61, -1, Number.NaN, 3.5]) assert.notEqual(validatePausedResetMinutes(bad), null)
  assert.equal(isPausedResetInDomain(2), false)
})

test('từ khóa xin nạp: chuẩn hóa, giới hạn số từ, độ dài từ và tổng độ dài', () => {
  assert.equal(normalizeChargeKeywords(' nạp , ,tiền,, ck '), 'nạp,tiền,ck')
  assert.equal(validateChargeKeywords(''), null)
  assert.equal(validateChargeKeywords('nạp,nap,tiền'), null)
  assert.match(validateChargeKeywords('a'.repeat(21)) ?? '', /20/)
  assert.match(validateChargeKeywords(Array.from({ length: 31 }, (_, i) => `k${i}`).join(',')) ?? '', /30/)
  assert.match(validateChargeKeywords(Array.from({ length: 20 }, () => 'a'.repeat(15)).join(',')) ?? '', /255/)
})
