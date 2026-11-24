import assert from 'node:assert/strict'
import test from 'node:test'
import {
  PASSWORD_MAX_LENGTH,
  USERNAME_MAX_LENGTH,
  describeAccountUpdateError,
  toDraft,
  toUpdateBody,
  validateNewPassword,
  validateUsername,
} from '../src/features/customers/customerProfileModel.ts'

const detail = {
  id: 7,
  username: 'HV3',
  userGroupId: 2,
  fullName: ' Nguyễn Văn A ',
  idNumber: null,
  phone: '0900000000',
  email: null,
  address: null,
  city: null,
  district: null,
  note: 'ghi chú',
  birthday: '0000-00-00',
  gender: 3,
  active: true,
  expiryDate: '0000-00-00',
  isVat: true,
  usageTimeId: 0,
  version: 'v1',
} as never

test('toDraft: ngày rỗng của máy chủ thành chuỗi rỗng, null thành chuỗi rỗng', () => {
  const draft = toDraft(detail)
  assert.equal(draft.birthday, '')
  assert.equal(draft.expiryDate, '')
  assert.equal(draft.idNumber, '')
  assert.equal(draft.email, '')
})

test('toUpdateBody: gửi lại ngày rỗng đúng dạng máy chủ, cắt khoảng trắng, kèm version', () => {
  const body = toUpdateBody(detail, toDraft(detail))
  assert.equal(body.birthday, '0000-00-00')
  assert.equal(body.expiryDate, '0000-00-00')
  assert.equal(body.fullName, 'Nguyễn Văn A')
  assert.equal(body.expectedVersion, 'v1')
  assert.equal(body.confirmMobileUnpair, false)
  assert.equal(body.isVat, true) // cờ VAT không bị đổi khi lưu tài khoản/hồ sơ
})

test('toUpdateBody: đổi nhóm/hoạt động/hết hạn không làm đổi field hồ sơ khác', () => {
  const body = toUpdateBody(detail, { ...toDraft(detail), userGroupId: 5, active: false, expiryDate: '2027-01-31' })
  assert.equal(body.userGroupId, 5)
  assert.equal(body.active, false)
  assert.equal(body.expiryDate, '2027-01-31')
  assert.equal(body.phone, '0900000000')
  assert.equal(body.note, 'ghi chú')
})

test('validateNewPassword: để trống cả hai = không đổi', () => {
  assert.equal(validateNewPassword('', ''), null)
})

test('validateNewPassword: hợp lệ khi hai ô khớp', () => {
  assert.equal(validateNewPassword('123456', '123456'), null)
})

test('validateNewPassword: lỗi thiếu / không khớp / toàn khoảng trắng / quá dài', () => {
  assert.equal(validateNewPassword('', 'abc'), 'Nhập mật khẩu mới.')
  assert.equal(validateNewPassword('   ', '   '), 'Nhập mật khẩu mới.')
  assert.equal(validateNewPassword('123456', ''), 'Mật khẩu nhập lại không khớp.')
  assert.equal(validateNewPassword('123456', '123457'), 'Mật khẩu nhập lại không khớp.')
  const long = 'x'.repeat(PASSWORD_MAX_LENGTH + 1)
  assert.match(validateNewPassword(long, long) ?? '', /tối đa/)
})

test('validateUsername: tên hợp lệ (có cắt khoảng trắng đầu/cuối)', () => {
  assert.equal(validateUsername('HV3'), null)
  assert.equal(validateUsername('  nguyen.van-a_01 '), null)
})

test('validateUsername: chặn đúng các dạng server từ chối', () => {
  assert.equal(validateUsername(''), 'Nhập tên đăng nhập.')
  assert.equal(validateUsername('   '), 'Nhập tên đăng nhập.')
  assert.match(validateUsername('x'.repeat(USERNAME_MAX_LENGTH + 1)) ?? '', /Tối đa/)
  assert.match(validateUsername("a'b") ?? '', /dấu nháy đơn/)
  assert.match(validateUsername('a\\b') ?? '', /gạch chéo/)
  assert.match(validateUsername('a(b)') ?? '', /"\("/)
  assert.match(validateUsername('"abc') ?? '', /nháy kép/)
  assert.match(validateUsername('NULL1') ?? '', /NULL/)
  assert.match(validateUsername('null') ?? '', /NULL/)
  assert.equal(validateUsername('Null'), null) // server chỉ chặn đúng "NULL"/"null"
  assert.equal(validateUsername('admin'), 'Không được dùng tên ADMIN.')
  assert.equal(validateUsername(' Admin '), 'Không được dùng tên ADMIN.')
})

test('describeAccountUpdateError: dịch lỗi quen thuộc, giữ nguyên lỗi lạ', () => {
  assert.match(describeAccountUpdateError(new Error('USER_VERSION_CONFLICT')), /người khác/)
  assert.match(describeAccountUpdateError(new Error('profile updated but password change failed')), /đổi mật khẩu thất bại/)
  assert.equal(describeAccountUpdateError(new Error('something else')), 'something else')
  assert.equal(describeAccountUpdateError('x'), 'Không lưu được tài khoản.')
})
