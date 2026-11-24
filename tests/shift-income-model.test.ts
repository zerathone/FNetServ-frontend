import assert from 'node:assert/strict'
import test from 'node:test'
import {
  availableMethods,
  buildShiftIncomeFromSummary,
  loginDayWindow,
  pickIncomeSource,
  selectSources,
  summarize,
  ROW_KEYS,
  type MethodSelection,
  type SourceSelection,
} from '../src/features/shift-income/shiftIncomeModel.ts'

type Src = { key: string; name: string; count: number; cash: number; online: number; qr: number; total: number; deduct: number }

const src = (key: string, count: number, cash: number, online: number, qr: number, deduct = 0): Src => ({
  key,
  name: key,
  count,
  cash,
  online,
  qr,
  deduct,
  total: cash + online + qr,
})

// Số khớp mock `/shift/summary` (features/shifts/shiftMock.ts): 6 nguồn của máy chủ.
const SERVER_SOURCES: Src[] = [
  src('member', 24, 1_850_000, 400_000, 1_200_000),
  src('anonymous', 9, 380_000, 0, 120_000),
  src('combo', 7, 210_000, 150_000, 300_000, 90_000),
  src('card', 3, 150_000, 0, 50_000),
  src('service', 31, 520_000, 60_000, 340_000, 180_000),
  src('debt', 1, 100_000, 0, 0),
]

const selectAll: SourceSelection = Object.fromEntries(ROW_KEYS.map((key) => [key, true])) as SourceSelection
const noDeduct: MethodSelection = { cash: true, bank: true, qr: true, deduct: false }

test('loginDayWindow: từ 00:00 ngày đăng nhập (giờ máy chủ), qua đêm vẫn giữ ngày đăng nhập', () => {
  const now = new Date(2026, 10, 24, 9, 2, 0) // 24/11 09:02 (giờ trình duyệt)
  assert.deepEqual(loginDayWindow('2026-11-24 00:00:00', now), {
    fromDate: '2026-11-24',
    fromTime: '00:00:00',
    toDate: '2026-11-24',
    sinceLabel: '00:00 24/11',
  })
  // Đăng nhập 23/11, làm qua đêm sang 24/11 => vẫn tính từ 00:00 23/11.
  assert.deepEqual(loginDayWindow('2026-11-23 00:00:00', now), {
    fromDate: '2026-11-23',
    fromTime: '00:00:00',
    toDate: '2026-11-24',
    sinceLabel: '00:00 23/11',
  })
})

test('loginDayWindow: máy chủ cũ không gửi / chuỗi hỏng => 00:00 hôm nay; đồng hồ trình duyệt chậm => toDate không trước fromDate', () => {
  const now = new Date(2026, 10, 24, 0, 30, 0)
  assert.equal(loginDayWindow('', now).fromDate, '2026-11-24')
  assert.equal(loginDayWindow('abc', now).sinceLabel, '00:00 24/11')
  const lagging = loginDayWindow('2026-11-25 00:00:00', now)
  assert.equal(lagging.fromDate, '2026-11-25')
  assert.equal(lagging.toDate, '2026-11-25')
})

test('pickIncomeSource: có ca (chế độ ca bật) => shift, KHÔNG cần quyền xem báo cáo', () => {
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: false, shiftEnabled: true, hasShift: true }), 'shift')
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: true, shiftEnabled: true, hasShift: true }), 'shift')
})

test('pickIncomeSource: chế độ 0 hoặc không ca => như trước (có quyền 931043 => report, không => ẩn)', () => {
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: true, shiftEnabled: false, hasShift: false }), 'report')
  // Chế độ 0 mà cache còn một ca: vẫn như trước.
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: true, shiftEnabled: false, hasShift: true }), 'report')
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: true, shiftEnabled: true, hasShift: false }), 'report')
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: false, shiftEnabled: false, hasShift: false }), 'none')
  assert.equal(pickIncomeSource({ staffId: 5, canViewReport: false, shiftEnabled: true, hasShift: false }), 'none')
})

test('pickIncomeSource: chưa đăng nhập / staffId không hợp lệ => none', () => {
  for (const staffId of [null, 0, -1]) {
    assert.equal(pickIncomeSource({ staffId, canViewReport: true, shiftEnabled: true, hasShift: true }), 'none')
  }
})

test('buildShiftIncomeFromSummary: gộp 6 nguồn vào 3 nhóm, chuyển khoản = cột online, anonymous -> anonym', () => {
  const { income, unmapped } = buildShiftIncomeFromSummary({ sources: SERVER_SOURCES })
  assert.deepEqual(unmapped, [])
  assert.equal(income.hasDeduct, true)
  assert.deepEqual(
    income.sources.map((s) => s.key),
    ['topup', 'combo', 'service'],
  )
  const topup = income.sources[0]
  assert.deepEqual(
    topup.parts.map((p) => p.key),
    ['member', 'anonym', 'card', 'debt'],
  )
  // Nạp tiền = member + anonymous + card + debt.
  assert.equal(topup.count, 24 + 9 + 3 + 1)
  assert.equal(topup.cash, 1_850_000 + 380_000 + 150_000 + 100_000)
  assert.equal(topup.bank, 400_000)
  assert.equal(topup.qr, 1_200_000 + 120_000 + 50_000)
  const combo = income.sources[1]
  assert.equal(combo.bank, 150_000)
  assert.equal(combo.deduct, 90_000)
})

test('buildShiftIncomeFromSummary: tổng widget (bỏ cấn trừ) = totals.total của máy chủ', () => {
  const { income } = buildShiftIncomeFromSummary({ sources: SERVER_SOURCES })
  const methods = availableMethods(income)
  const summary = summarize(selectSources(income, selectAll), methods, noDeduct)
  const serverTotal = SERVER_SOURCES.reduce((sum, s) => sum + s.total, 0)
  assert.equal(summary.total, serverTotal)
  assert.equal(summary.count, SERVER_SOURCES.reduce((sum, s) => sum + s.count, 0))
  // Tick cấn trừ thì cộng thêm đúng cột cấn trừ.
  const withDeduct = summarize(selectSources(income, selectAll), methods, { ...noDeduct, deduct: true })
  assert.equal(withDeduct.total, serverTotal + 90_000 + 180_000)
})

test('buildShiftIncomeFromSummary: ca chưa có phiếu => đủ 3 nguồn, mọi số 0', () => {
  const { income, unmapped } = buildShiftIncomeFromSummary({ sources: [] })
  assert.deepEqual(unmapped, [])
  assert.equal(income.sources.length, 3)
  assert.ok(income.sources.every((s) => s.parts.every((p) => p.cash + p.bank + p.qr + p.deduct + p.count === 0)))
  assert.equal(summarize(selectSources(income, selectAll), availableMethods(income), noDeduct).total, 0)
})

test('buildShiftIncomeFromSummary: khoá nguồn lạ không bị nuốt âm thầm (trả về để ghi log), nguồn trùng khoá được cộng dồn', () => {
  const { income, unmapped } = buildShiftIncomeFromSummary({
    sources: [src('service', 2, 10_000, 0, 0), src('service', 3, 5_000, 1_000, 0), src('moi_xuat_hien', 1, 999, 0, 0)],
  })
  assert.deepEqual(unmapped, ['moi_xuat_hien'])
  const service = income.sources.find((s) => s.key === 'service')
  assert.equal(service?.count, 5)
  assert.equal(service?.cash, 15_000)
  assert.equal(service?.bank, 1_000)
})
