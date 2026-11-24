import assert from 'node:assert/strict'
import test from 'node:test'
import type { ComboCardDetail } from '../src/api/users.ts'
import {
  isPastExpiry,
  daysUntil,
  remainingPercent,
  describeCardStatus,
  describeComboKind,
  describeOrigin,
  describeWeekdays,
  formatDateTime,
  formatRemain,
  formatTimestamp,
} from '../src/features/customers/comboCardDetailModel.ts'

function card(overrides: Partial<ComboCardDetail> = {}): ComboCardDetail {
  return {
    userId: 1,
    userName: 'CB0001',
    active: true,
    expiryDate: '',
    comboDetailId: 10,
    comboId: 3,
    comboName: 'Combo đêm',
    comboType: 1,
    duration: 0,
    numOfDay: 0,
    weekday: 127,
    price: 50000,
    zone: 'VIP|Thường',
    createDate: '2026-11-20',
    createTime: '10:00:00',
    fromDate: '2026-11-20',
    fromTime: '22:00',
    toDate: '2026-12-20',
    toTime: '06:00',
    firstLoginAt: '',
    remainMinutes: 0,
    accept: 1,
    paymentId: 5,
    ownerId: 0,
    ownerName: '',
    donates: [],
    ...overrides,
  }
}

test('loại combo: 1 cố định, 2 theo thời lượng, khác ⇒ không xác định', () => {
  assert.equal(describeComboKind({ comboType: 1 }).kind, 'fixed-window')
  assert.equal(describeComboKind({ comboType: 2 }).kind, 'duration')
  assert.equal(describeComboKind({ comboType: 2 }).label, 'Theo thời lượng')
  assert.equal(describeComboKind({ comboType: 0 }).kind, 'unknown')
})

test('nguồn thẻ: ownerId 0 ⇒ bán tại quầy; >0 ⇒ hội viên mua (thiếu tên ⇒ #id)', () => {
  assert.deepEqual(describeOrigin({ ownerId: 0, ownerName: '' }), { kind: 'counter', label: 'Bán tại quầy' })
  const member = describeOrigin({ ownerId: 7, ownerName: ' nguyenvan ' })
  assert.equal(member.kind, 'member')
  assert.equal(member.kind === 'member' ? member.ownerName : '', 'nguyenvan')
  const noName = describeOrigin({ ownerId: 7, ownerName: '' })
  assert.equal(noName.kind === 'member' ? noName.ownerName : '', '#7')
})

test('ngày áp dụng: 127 và 0 ⇒ tất cả; bitmask ⇒ danh sách T2..T7, CN', () => {
  assert.equal(describeWeekdays(127).all, true)
  assert.equal(describeWeekdays(0).all, true)
  assert.equal(describeWeekdays(127).text, 'Tất cả các ngày')
  // T2(2) + T4(8) + CN(1) = 11
  const some = describeWeekdays(11)
  assert.equal(some.all, false)
  assert.deepEqual(some.days, ['T2', 'T4', 'CN'])
  assert.equal(describeWeekdays(64).text, 'T7')
  assert.equal(describeWeekdays(62).text, 'T2, T3, T4, T5, T6') // 2+4+8+16+32: ngày thường
  assert.equal(describeWeekdays(126).text, 'T2, T3, T4, T5, T6, T7') // trừ Chủ nhật
})

test('formatRemain', () => {
  assert.equal(formatRemain(0), '0 phút')
  assert.equal(formatRemain(45), '45 phút')
  assert.equal(formatRemain(180), '3 giờ')
  assert.equal(formatRemain(185), '3 giờ 05 phút')
  assert.equal(formatRemain(-5), '0 phút')
})

test('định dạng ngày giờ', () => {
  assert.equal(formatDateTime('2026-11-24', '09:30:00'), '24/11/2026 09:30')
  assert.equal(formatDateTime('2026-11-24', ''), '24/11/2026')
  assert.equal(formatDateTime('', '09:30'), '')
  assert.equal(formatTimestamp('2026-11-24 09:30:15'), '24/11/2026 09:30')
  assert.equal(formatTimestamp(''), '')
})

test('isPastExpiry: tính cả giờ; thiếu giờ ⇒ hết ngày; thiếu ngày ⇒ không quá hạn', () => {
  const now = new Date(2026, 10, 24, 7, 44)
  assert.equal(isPastExpiry({ toDate: '2026-11-24', toTime: '00:00' }, now), true) // hết lúc 00:00 sáng nay
  assert.equal(isPastExpiry({ toDate: '2026-11-24', toTime: '23:00' }, now), false)
  assert.equal(isPastExpiry({ toDate: '2026-11-24', toTime: '' }, now), false)
  assert.equal(isPastExpiry({ toDate: '', toTime: '' }, now), false)
})

test('daysUntil: theo ngày lịch, bỏ qua giờ; rỗng ⇒ null', () => {
  const now = new Date(2026, 10, 24, 23, 59)
  assert.equal(daysUntil('2026-11-24', now), 0)
  assert.equal(daysUntil('2026-11-25', now), 1)
  assert.equal(daysUntil('2026-12-24', now), 30)
  assert.equal(daysUntil('2026-11-23', now), -1)
  assert.equal(daysUntil('', now), null)
  assert.equal(daysUntil('0000-00-00', now), null)
})

test('remainingPercent: chỉ tính khi đã dùng và có thời lượng', () => {
  assert.equal(remainingPercent({ duration: 5, remainMinutes: 150, firstLoginAt: '2026-11-24 08:00:00' }), 50)
  assert.equal(remainingPercent({ duration: 5, remainMinutes: 999, firstLoginAt: '2026-11-24 08:00:00' }), 100)
  assert.equal(remainingPercent({ duration: 5, remainMinutes: 0, firstLoginAt: '2026-11-24 08:00:00' }), 0)
  assert.equal(remainingPercent({ duration: 5, remainMinutes: 150, firstLoginAt: '' }), null)
  assert.equal(remainingPercent({ duration: 0, remainMinutes: 150, firstLoginAt: 'x' }), null)
})

test('trạng thái: khóa > hết hạn > chưa sử dụng/hết giờ > chưa đến hạn > còn hiệu lực', () => {
  const now = new Date(2026, 10, 24, 12, 0)
  assert.equal(describeCardStatus(card({ active: false }), now).label, 'Đã khóa')
  assert.equal(describeCardStatus(card({ toDate: '2026-11-23', toTime: '06:00' }), now).label, 'Hết hạn')
  assert.equal(describeCardStatus(card({ toDate: '2026-11-23', toTime: '06:00' }), now).tone, 'danger')
  assert.equal(describeCardStatus(card(), now).label, 'Còn hiệu lực')
  assert.equal(describeCardStatus(card({ fromDate: '2026-11-25', fromTime: '00:00' }), now).label, 'Chưa đến hạn')
})

test('thẻ theo thời lượng: chưa đăng nhập ⇒ chưa sử dụng; hết phút ⇒ hết giờ', () => {
  const now = new Date(2026, 10, 24, 12, 0)
  const base = { comboType: 2, duration: 5, toDate: '', toTime: '', fromDate: '', fromTime: '' }
  assert.equal(describeCardStatus(card({ ...base }), now).label, 'Chưa sử dụng')
  assert.equal(
    describeCardStatus(card({ ...base, firstLoginAt: '2026-11-24 08:00:00', remainMinutes: 0, toDate: '2026-11-30' }), now).label,
    'Hết giờ',
  )
  assert.equal(
    describeCardStatus(card({ ...base, firstLoginAt: '2026-11-24 08:00:00', remainMinutes: 90, toDate: '2026-11-30' }), now).label,
    'Còn hiệu lực',
  )
})

test('ngày kết thúc không có giờ ⇒ tính đến hết ngày đó', () => {
  const lateEvening = new Date(2026, 10, 24, 23, 30)
  assert.equal(describeCardStatus(card({ toDate: '2026-11-24', toTime: '' }), lateEvening).label, 'Còn hiệu lực')
  const nextMorning = new Date(2026, 10, 25, 0, 5)
  assert.equal(describeCardStatus(card({ toDate: '2026-11-24', toTime: '' }), nextMorning).label, 'Hết hạn')
})
