import assert from 'node:assert/strict'
import test from 'node:test'
import {
  advColumnLabel,
  advHasCriteria,
  buildAdvQuery,
  buildChangeGroupBody,
  buildCleanQuery,
  defaultAdvForm,
  defaultCleanForm,
  describeChangeGroupError,
  describeDeleteError,
  isCountMismatch,
  isRbacDenied,
  monthsBefore,
  summarizeDeleteResult,
  sumRemainMoney,
  toAdvFilter,
  toIsoDate,
  validateAdvForm,
  validateCleanForm,
} from '../src/features/customers/userAdminModel.ts'

const today = new Date(2026, 9, 2) // 2026-10-02

test('monthsBefore clamps to the last day of a shorter month', () => {
  assert.equal(toIsoDate(monthsBefore(new Date(2026, 7, 31), 6)), '2026-02-28')
  assert.equal(toIsoDate(monthsBefore(today, 6)), '2026-04-02')
  assert.equal(toIsoDate(monthsBefore(new Date(2026, 0, 15), 1)), '2025-12-15')
})

test('clean form defaults match CCleanMemberDlg (6 months, remain <= 1000, no debit)', () => {
  const form = defaultCleanForm(today)
  assert.equal(form.useLastLogin, true)
  assert.equal(form.lastLogin, '2026-04-02')
  assert.equal(form.useMaxRemain, true)
  assert.equal(form.maxRemain, '1000')
  assert.equal(form.debit, 'no')
  assert.deepEqual(validateCleanForm(form, today), {})
})

test('clean form validation: last login must be before today, remain required and numeric', () => {
  const form = defaultCleanForm(today)
  assert.ok(validateCleanForm({ ...form, lastLogin: '2026-10-02' }, today).lastLogin)
  assert.ok(validateCleanForm({ ...form, lastLogin: '2026-10-03' }, today).lastLogin)
  assert.ok(validateCleanForm({ ...form, lastLogin: '2026-02-31' }, today).lastLogin)
  assert.ok(validateCleanForm({ ...form, lastLogin: '' }, today).lastLogin)
  assert.equal(validateCleanForm({ ...form, lastLogin: '2026-10-01' }, today).lastLogin, undefined)
  assert.ok(validateCleanForm({ ...form, maxRemain: '' }, today).maxRemain)
  assert.ok(validateCleanForm({ ...form, maxRemain: '12a' }, today).maxRemain)
  assert.ok(validateCleanForm({ ...form, maxRemain: '2147483648' }, today).maxRemain)
  // Tiêu chí đã tắt thì không bị validate.
  assert.deepEqual(
    validateCleanForm({ ...form, useLastLogin: false, lastLogin: '', useMaxRemain: false, maxRemain: '' }, today),
    {},
  )
})

test('clean query sends contract params and drops values of disabled criteria', () => {
  const form = defaultCleanForm(today)
  assert.equal(
    buildCleanQuery(form, 0),
    'lastLogin=2026-04-02&maxRemain=1000&debit=no&limit=200&offset=0',
  )
  assert.equal(
    buildCleanQuery(
      { ...form, useLastLogin: false, useMaxRemain: false, debit: 'all', sortLastLogin: 'asc', sortRemain: 'desc' },
      2,
    ),
    'useLastLogin=0&useMaxRemain=0&debit=all&sortLastLogin=asc&sortRemain=desc&limit=200&offset=400',
  )
  // Không còn tham số cũ gây lỗi im lặng.
  assert.ok(!buildCleanQuery(form, 0).includes('months'))
  assert.ok(!buildCleanQuery(form, 0).includes('ignoreBalance'))
})

test('sumRemainMoney adds up the ticked rows', () => {
  assert.equal(sumRemainMoney([{ remainMoney: 500 }, { remainMoney: 1_000 }]), 1_500)
  assert.equal(sumRemainMoney([]), 0)
})

test('advanced form defaults: sort by paid desc, nothing else enabled', () => {
  const form = defaultAdvForm(today)
  assert.equal(form.sortPaid, 'desc')
  assert.equal(form.useLapse, false)
  assert.equal(form.lapseFrom, '2026-09-02')
  assert.equal(form.lapseTo, '2026-10-02')
  assert.deepEqual(toAdvFilter(form), { sortPaid: 'desc' })
  assert.equal(advHasCriteria(toAdvFilter(form)), false)
})

test('advanced validation: empty ticked field, non-digits, 11 digit cap, min > max', () => {
  const base = defaultAdvForm(today)
  assert.ok(validateAdvForm({ ...base, useMaxPaid: true }, today).maxPaid)
  assert.ok(validateAdvForm({ ...base, useMaxPaid: true, maxPaid: '1e5' }, today).maxPaid)
  assert.ok(validateAdvForm({ ...base, useMaxPaid: true, maxPaid: '123456789012' }, today).maxPaid)
  assert.deepEqual(validateAdvForm({ ...base, useMaxPaid: true, maxPaid: '12345678901' }, today), {})
  const range = { ...base, useMaxPaid: true, maxPaid: '100', useMinPaid: true, minPaid: '200' }
  assert.ok(validateAdvForm(range, today).minPaid)
  const remain = { ...base, useMaxRemain: true, maxRemain: '5', useMinRemain: true, minRemain: '6' }
  assert.ok(validateAdvForm(remain, today).minRemain)
})

test('advanced validation: lapse range rules', () => {
  const base = { ...defaultAdvForm(today), useLapse: true }
  assert.deepEqual(validateAdvForm(base, today), {})
  assert.ok(validateAdvForm({ ...base, lapseTo: '2026-10-03' }, today).lapseTo)
  assert.ok(validateAdvForm({ ...base, lapseFrom: '2026-10-02', lapseTo: '2026-10-01' }, today).lapseFrom)
  assert.ok(validateAdvForm({ ...base, lapseFrom: '' }, today).lapseFrom)
  assert.deepEqual(validateAdvForm({ ...base, lapseFrom: '2026-10-02', lapseTo: '2026-10-02' }, today), {})
})

test('advanced filter and query carry only enabled criteria; lapse goes in pairs', () => {
  const form = {
    ...defaultAdvForm(today),
    useMinPaid: true,
    minPaid: '50000',
    sortPaid: 'none' as const,
    useLapse: true,
    sortRemain: 'asc' as const,
    idNumber: 'yes' as const,
    phone: 'no' as const,
  }
  const filter = toAdvFilter(form)
  assert.deepEqual(filter, {
    minPaid: '50000',
    sortRemain: 'asc',
    idNumber: '1',
    phone: '0',
    lapseFrom: '2026-09-02',
    lapseTo: '2026-10-02',
  })
  assert.equal(
    buildAdvQuery(filter, 50, 100),
    'minPaid=50000&sortRemain=asc&idNumber=1&phone=0&lapseFrom=2026-09-02&lapseTo=2026-10-02&limit=50&offset=100',
  )
})

test('advHasCriteria ignores sort-only filters (server answers NO_FILTER for them)', () => {
  assert.equal(advHasCriteria(null), false)
  assert.equal(advHasCriteria({}), false)
  assert.equal(advHasCriteria({ sortPaid: 'desc', sortRemain: 'asc' }), false)
  assert.equal(advHasCriteria({ lapseFrom: '2026-09-01' }), false)
  assert.equal(advHasCriteria({ lapseFrom: '2026-09-01', lapseTo: '2026-10-01' }), true)
  assert.equal(advHasCriteria({ phone: '0' }), true)
  assert.equal(advHasCriteria({ maxRemain: '0' }), true)
})

test('lapse relabels paid/used columns, leaves others and non-lapse searches alone', () => {
  const lapse = { lapseFrom: '2026-09-01', lapseTo: '2026-10-01' }
  assert.equal(advColumnLabel('moneyPaid', 'Số tiền nạp', lapse), 'Đã nạp trong khoảng')
  assert.equal(advColumnLabel('moneyUsed', 'Số tiền đã dùng', lapse), 'Đã dùng (tổng)')
  assert.equal(advColumnLabel('moneyRemain', 'Số tiền còn lại', lapse), 'Số tiền còn lại')
  assert.equal(advColumnLabel('moneyPaid', 'Số tiền nạp', { maxPaid: '1' }), 'Số tiền nạp')
})

test('change-group body carries the filter snapshot and expectedCount only on confirm', () => {
  const filter = { minPaid: '1', sortPaid: 'desc' as const }
  assert.deepEqual(buildChangeGroupBody(filter, 7, false), {
    minPaid: '1',
    sortPaid: 'desc',
    groupId: 7,
    confirm: false,
  })
  assert.deepEqual(buildChangeGroupBody(filter, 7, true, 42), {
    minPaid: '1',
    sortPaid: 'desc',
    groupId: 7,
    confirm: true,
    expectedCount: 42,
  })
})

test('delete summary never reports success for a preview-only or empty result', () => {
  assert.equal(summarizeDeleteResult(3, { deleted: false }).tone, 'error')
  assert.equal(summarizeDeleteResult(3, { deleted: true, deletedCount: 0, failed: [1, 2, 3] }).tone, 'error')
  const partial = summarizeDeleteResult(3, { deleted: true, deletedCount: 2, failed: [9] })
  assert.equal(partial.tone, 'error')
  assert.match(partial.message, /2\/3/)
  assert.deepEqual(summarizeDeleteResult(2, { deleted: true, deletedCount: 2, failed: [] }), {
    tone: 'success',
    message: 'Đã xóa 2 tài khoản.',
  })
})

test('guard errors map from err.details.code to Vietnamese, never the English server text', () => {
  const debit = { message: 'users still have unpaid debit', details: { code: 'HAS_DEBIT', totalDebit: 150000 } }
  assert.match(describeDeleteError(debit), /nợ/)
  assert.match(describeDeleteError(debit), /150\.000/)
  assert.match(describeDeleteError({ message: 'x', details: { code: 'STAFF_REQUIRES_ADMIN' } }), /quản trị/)
  assert.match(describeDeleteError({ message: 'x', details: { code: 'STAFF_HAS_PAYMENT' } }), /thanh toán/)
  assert.equal(describeChangeGroupError({ message: 'x', details: { code: 'NO_FILTER' } }), 'Cần ít nhất một điều kiện lọc.')
  assert.match(describeChangeGroupError({ message: 'x', details: { code: 'COUNT_MISMATCH', count: 5 } }), /tải lại/)
  assert.equal(isCountMismatch({ details: { code: 'COUNT_MISMATCH' } }), true)
  assert.equal(isCountMismatch({ details: { code: 'NO_FILTER' } }), false)
})

test('RbacDeniedError is recognised so the caller does not toast a second time', () => {
  assert.equal(isRbacDenied({ name: 'RbacDeniedError' }), true)
  assert.equal(isRbacDenied(new Error('x')), false)
  assert.equal(isRbacDenied(null), false)
})
