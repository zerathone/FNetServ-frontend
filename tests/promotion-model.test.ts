import assert from 'node:assert/strict'
import test from 'node:test'
import {
  addDaysYMD,
  defaultPeriod,
  describeDays,
  findTimeOverlaps,
  hoursTo,
  memberHasContent,
  normalizeHour,
  periodForSave,
  toggleDay,
  validateDiscountRules,
  validateMemberDraft,
  validatePeriod,
  validateTimeRules,
  type MemberDraft,
  type TimeRule,
} from '../src/features/promotions/promotionModel.ts'

const TODAY = '2026-11-24'

test('ngày: cộng ngày qua ranh giới tháng/năm', () => {
  assert.equal(addDaysYMD('2026-11-24', 30), '2026-12-24')
  assert.equal(addDaysYMD('2026-12-31', 1), '2027-01-01')
  assert.equal(addDaysYMD('2026-03-01', -1), '2026-02-28')
  assert.deepEqual(defaultPeriod(TODAY), { begin: '2026-11-24', end: '2026-12-24' })
})

test('ngày: luật giống máy chủ (đủ ngày, begin<=end, begin không quá 30 ngày trước)', () => {
  assert.equal(validatePeriod('2026-11-24', '2026-12-01', TODAY), null)
  assert.equal(validatePeriod('2026-10-25', '2026-12-01', TODAY), null) // đúng 30 ngày trước
  assert.match(validatePeriod('2026-10-24', '2026-12-01', TODAY) ?? '', /30 ngày/)
  assert.match(validatePeriod('', '2026-12-01', TODAY) ?? '', /đủ ngày/)
  assert.match(validatePeriod('2026-12-02', '2026-12-01', TODAY) ?? '', /sau ngày bắt đầu/)
})

test('ngày: khi không có gì để áp dụng thì gửi hôm nay → hôm nay', () => {
  assert.deepEqual(periodForSave('2025-01-01', '2025-02-01', false, TODAY), { begin: TODAY, end: TODAY })
  assert.deepEqual(periodForSave('2026-11-25', '2026-12-01', true, TODAY), { begin: '2026-11-25', end: '2026-12-01' })
})

test('ngày trong tuần: mô tả dễ đọc', () => {
  assert.equal(describeDays(127), 'Cả tuần')
  assert.equal(describeDays(62), 'T2 – T6')
  assert.equal(describeDays(65), 'T7, CN')
  assert.equal(describeDays(2 | 8), 'T2, T4')
  assert.equal(describeDays(0), 'Chưa chọn ngày')
  assert.equal(toggleDay(62, 2), 60)
  assert.equal(toggleDay(60, 2), 62)
})

test('giờ: danh sách "đến" luôn sau giờ "từ", tối đa 24', () => {
  assert.deepEqual(hoursTo(22), [23, 24])
  assert.equal(hoursTo(0).length, 24)
  assert.equal(hoursTo(23)[0], 24)
})

test('giờ: giá trị HHMMSS cũ từ bản web trước được quy về giờ tròn và đánh dấu', () => {
  assert.deepEqual(normalizeHour(0, 0), { hour: 0, fixed: false })
  assert.deepEqual(normalizeHour('22', 0), { hour: 22, fixed: false })
  assert.deepEqual(normalizeHour(24, 0), { hour: 24, fixed: false })
  assert.deepEqual(normalizeHour(235959, 24), { hour: 24, fixed: true })
  assert.deepEqual(normalizeHour(80000, 0), { hour: 8, fixed: true })
  assert.deepEqual(normalizeHour('abc', 5), { hour: 5, fixed: true })
})

const rule = (patch: Partial<TimeRule> = {}): TimeRule => ({
  uid: 'r',
  machineGroupId: 1,
  beginHour: 8,
  endHour: 12,
  price: 5000,
  dayMask: 127,
  ...patch,
})

test('khung giờ vàng: kiểm từng dòng', () => {
  assert.equal(validateTimeRules([rule()]), null)
  assert.match(validateTimeRules([rule({ machineGroupId: 0 })]) ?? '', /nhóm máy/)
  assert.match(validateTimeRules([rule({ beginHour: 12, endHour: 12 })]) ?? '', /sau giờ bắt đầu/)
  assert.match(validateTimeRules([rule({ price: null })]) ?? '', /giá/)
  assert.match(validateTimeRules([rule({ dayMask: 0 })]) ?? '', /ngày trong tuần/)
})

test('khung giờ vàng: phát hiện chồng nhau (cùng nhóm máy, cùng ngày, chồng giờ)', () => {
  assert.deepEqual(findTimeOverlaps([rule(), rule({ beginHour: 10, endHour: 14 })]), [[0, 1]])
  assert.deepEqual(findTimeOverlaps([rule(), rule({ beginHour: 12, endHour: 14 })]), []) // sát nhau, không chồng
  assert.deepEqual(findTimeOverlaps([rule(), rule({ machineGroupId: 2 })]), [])
  assert.deepEqual(findTimeOverlaps([rule({ dayMask: 2 }), rule({ dayMask: 4 })]), [])
})

test('giảm giá theo giờ chơi: kiểm từng dòng', () => {
  const base = { uid: 'd', machineGroupId: 1, order: 0 as const, hours: 2, price: 3000 }
  assert.equal(validateDiscountRules([base]), null)
  assert.match(validateDiscountRules([{ ...base, machineGroupId: 0 }]) ?? '', /nhóm máy/)
  assert.match(validateDiscountRules([{ ...base, hours: 0 }]) ?? '', /1 đến 24/)
  assert.match(validateDiscountRules([{ ...base, hours: 25 }]) ?? '', /1 đến 24/)
  assert.match(validateDiscountRules([{ ...base, price: null }]) ?? '', /giá/)
})

const member = (patch: Partial<MemberDraft> = {}): MemberDraft => ({
  policy: 'none',
  accumulate: { charge: null, bonus: null },
  freeTiers: [],
  percentTiers: [],
  firstDeposit: { percent: null, minAmount: null },
  ...patch,
})

test('nạp tiền: có gì để áp dụng', () => {
  assert.equal(memberHasContent(member()), false)
  assert.equal(memberHasContent(member({ policy: 'free' })), true)
  assert.equal(memberHasContent(member({ firstDeposit: { percent: 10, minAmount: 0 } })), true)
})

test('nạp tiền: tích lũy — tặng không vượt quá số tích lũy', () => {
  assert.equal(validateMemberDraft(member({ policy: 'accumulate', accumulate: { charge: 100000, bonus: 10000 } })), null)
  assert.match(validateMemberDraft(member({ policy: 'accumulate', accumulate: { charge: 100000, bonus: 200000 } })) ?? '', /không được lớn hơn/)
  assert.match(validateMemberDraft(member({ policy: 'accumulate' })) ?? '', /lớn hơn 0/)
})

test('nạp tiền: theo mức — cần mốc, không trùng, % tối đa 100', () => {
  const tier = (charge: number | null, value: number | null) => ({ uid: String(charge), charge, value })
  assert.match(validateMemberDraft(member({ policy: 'free' })) ?? '', /ít nhất một mốc/)
  assert.equal(validateMemberDraft(member({ policy: 'free', freeTiers: [tier(100000, 10000), tier(200000, 30000)] })), null)
  assert.match(validateMemberDraft(member({ policy: 'free', freeTiers: [tier(100000, 1), tier(100000, 2)] })) ?? '', /trùng/)
  assert.match(validateMemberDraft(member({ policy: 'percent', percentTiers: [tier(100000, 150)] })) ?? '', /tối đa 100/)
  assert.match(validateMemberDraft(member({ policy: 'percent', percentTiers: [tier(0, 10)] })) ?? '', /mức nạp/)
})

test('nạp tiền: nạp lần đầu tối đa 100%', () => {
  assert.equal(validateMemberDraft(member({ firstDeposit: { percent: 20, minAmount: 50000 } })), null)
  assert.match(validateMemberDraft(member({ firstDeposit: { percent: 120, minAmount: 0 } })) ?? '', /tối đa 100/)
})
