import assert from 'node:assert/strict'
import test from 'node:test'
import { birthdayMonthOptions, birthdayWeekStatus } from '../src/features/customers/birthdayModel.ts'

// 2026-11-25 là thứ Tư → tuần 23/11 (T2) … 29/11 (CN).
const wed = new Date(2026, 10, 25, 15, 30)

test('thiếu hoặc không hợp lệ → null', () => {
  assert.equal(birthdayWeekStatus(null, wed), null)
  assert.equal(birthdayWeekStatus(undefined, wed), null)
  assert.equal(birthdayWeekStatus('', wed), null)
  assert.equal(birthdayWeekStatus('0000-00-00', wed), null)
  assert.equal(birthdayWeekStatus('1990-13-05', wed), null)
  assert.equal(birthdayWeekStatus('1990-04-31', wed), null)
  assert.equal(birthdayWeekStatus('abc', wed), null)
})

test('đúng hôm nay → today (bất kể năm sinh, bất kể giờ)', () => {
  const result = birthdayWeekStatus('1986-11-25', wed)
  assert.equal(result?.kind, 'today')
  assert.equal(result?.daysFromToday, 0)
})

test('trong tuần thứ Hai → Chủ nhật: nhận cả ngày đã qua lẫn sắp tới', () => {
  assert.equal(birthdayWeekStatus('2000-11-23', wed)?.daysFromToday, -2) // thứ Hai
  assert.equal(birthdayWeekStatus('2000-11-24', wed)?.daysFromToday, -1)
  assert.equal(birthdayWeekStatus('2000-11-29', wed)?.daysFromToday, 4) // Chủ nhật
  assert.equal(birthdayWeekStatus('2000-11-29', wed)?.kind, 'week')
})

test('ngoài tuần → null (sát biên hai đầu)', () => {
  assert.equal(birthdayWeekStatus('2000-11-22', wed), null) // Chủ nhật tuần trước
  assert.equal(birthdayWeekStatus('2000-11-30', wed), null) // thứ Hai tuần sau
  assert.equal(birthdayWeekStatus('2000-06-01', wed), null)
})

test('hôm nay là Chủ nhật: tuần vẫn tính từ thứ Hai trước đó', () => {
  const sunday = new Date(2026, 10, 29)
  assert.equal(birthdayWeekStatus('1999-11-23', sunday)?.daysFromToday, -6)
  assert.equal(birthdayWeekStatus('1999-11-30', sunday), null)
})

test('tuần vắt qua giao thừa', () => {
  const newYearWeek = new Date(2026, 11, 31) // thứ Năm; tuần 28/12/2026 → 03/01/2027
  assert.equal(birthdayWeekStatus('1990-01-02', newYearWeek)?.daysFromToday, 2)
  assert.equal(birthdayWeekStatus('1990-12-28', newYearWeek)?.daysFromToday, -3)
  const jan = new Date(2027, 0, 1) // thứ Sáu
  assert.equal(birthdayWeekStatus('1990-12-30', jan)?.daysFromToday, -2)
})

test('29/02: năm không nhuận tính 28/02, năm nhuận giữ 29/02', () => {
  const feb28 = new Date(2027, 1, 28) // 2027 không nhuận
  assert.equal(birthdayWeekStatus('2000-02-29', feb28)?.kind, 'today')
  const feb29 = new Date(2028, 1, 29) // 2028 nhuận
  assert.equal(birthdayWeekStatus('2000-02-29', feb29)?.kind, 'today')
})

test('nhãn mô tả ngày và khoảng cách', () => {
  assert.equal(birthdayWeekStatus('1986-11-25', wed)?.label, 'Hôm nay là sinh nhật')
  assert.equal(birthdayWeekStatus('1986-11-27', wed)?.label, 'Tuần sinh nhật (27/11, còn 2 ngày nữa)')
  assert.equal(birthdayWeekStatus('1986-11-24', wed)?.label, 'Tuần sinh nhật (24/11, đã qua 1 ngày)')
})

test('birthdayMonthOptions: bắt đầu từ tháng hiện tại, tăng dần, vòng qua tháng 12', () => {
  const counts = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
  const options = birthdayMonthOptions(11, counts)
  assert.deepEqual(options.map((o) => o.month), [11, 12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  assert.equal(options.length, 12)
  assert.equal(options[0].isCurrent, true)
  assert.equal(options.filter((o) => o.isCurrent).length, 1)
  assert.equal(options[0].label, 'Tháng 11')
  assert.equal(options[0].count, 11) // counts[10]
  assert.equal(options[2].count, 1) // tháng 1 = counts[0]
})

test('birthdayMonthOptions: tháng 1 và thiếu dữ liệu', () => {
  assert.deepEqual(birthdayMonthOptions(1, undefined).map((o) => o.month), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  assert.equal(birthdayMonthOptions(1, undefined).every((o) => o.count === 0), true)
  assert.equal(birthdayMonthOptions(12, [])[0].month, 12)
  assert.equal(birthdayMonthOptions(12, [])[1].month, 1)
  // tháng hiện tại ngoài 1..12 ⇒ coi như tháng 1
  assert.equal(birthdayMonthOptions(0, undefined)[0].month, 1)
  assert.equal(birthdayMonthOptions(13, undefined)[0].month, 1)
})
