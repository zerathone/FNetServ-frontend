import assert from 'node:assert/strict'
import test from 'node:test'
import type { ComboCardRow } from '../src/api/users.ts'
import {
  COMBO_CARD_COLUMNS,
  comboCardToSeed,
  describeTimeRange,
  describeValidity,
  describeZones,
  formatDmy,
  normalizeHm,
  sortComboCards,
} from '../src/features/customers/comboCardModel.ts'

const row = (over: Partial<ComboCardRow> = {}): ComboCardRow => ({
  userId: 1,
  userName: 'TESTCOMBO-A',
  fromDate: '2026-11-23',
  fromTime: '00:00',
  toDate: '2026-11-24',
  toTime: '00:00',
  zone: 'Standard',
  note: 'Bán thẻ Combo tại quầy',
  ...over,
})

test('cột đúng thứ tự và nhãn MFC', () => {
  assert.deepEqual(
    COMBO_CARD_COLUMNS.map((c) => c.label),
    ['Tên đăng nhập', 'Máy', 'Thời hạn sử dụng', 'Thời điểm sử dụng', 'Ghi chú'],
  )
})

test('normalizeHm: bỏ giây, đệm số 0, từ chối rác', () => {
  assert.equal(normalizeHm('18:30:00'), '18:30')
  assert.equal(normalizeHm('8:05'), '08:05')
  assert.equal(normalizeHm(''), '')
  assert.equal(normalizeHm(undefined), '')
  assert.equal(normalizeHm('abc'), '')
})

test('formatDmy: ISO → dd/MM/yyyy, ngày rỗng 0000-00-00 không in ra', () => {
  assert.equal(formatDmy('2026-11-23'), '23/11/2026')
  assert.equal(formatDmy('2026-11-23 10:00:00'), '23/11/2026')
  assert.equal(formatDmy('0000-00-00'), '')
  assert.equal(formatDmy(undefined), '')
})

test('describeValidity: cùng nội dung MFC (từ → đến, có giờ)', () => {
  const v = describeValidity(row())
  assert.ok(v)
  assert.deepEqual(v.from, { date: '23/11/2026', time: '00:00' })
  assert.deepEqual(v.to, { date: '24/11/2026', time: '00:00' })
  assert.equal(v.text, '23/11/2026 00:00 → 24/11/2026 00:00')
})

test('describeValidity: thiếu cả hai ngày ⇒ null; server cũ không có giờ vẫn hiện ngày', () => {
  assert.equal(describeValidity(row({ fromDate: '', toDate: '' })), null)
  const old = describeValidity(row({ fromTime: undefined, toTime: undefined }))
  assert.ok(old)
  assert.equal(old.text, '23/11/2026 → 24/11/2026')
})

test('describeTimeRange: from == to ⇒ cả ngày nhưng giữ số liệu thô cho tooltip', () => {
  const r = describeTimeRange(row())
  assert.equal(r.kind, 'all-day')
  assert.equal(r.kind === 'all-day' && r.text, '00:00 → 00:00')
})

test('describeTimeRange: khung giờ thật và qua đêm đều là range', () => {
  const day = describeTimeRange(row({ fromTime: '08:00', toTime: '17:00' }))
  assert.deepEqual(day, { kind: 'range', from: '08:00', to: '17:00', text: '08:00 → 17:00' })
  const night = describeTimeRange(row({ fromTime: '22:00', toTime: '06:00' }))
  assert.equal(night.kind, 'range')
})

test('describeTimeRange: thiếu giờ (server cũ) ⇒ unknown', () => {
  assert.deepEqual(describeTimeRange(row({ fromTime: undefined, toTime: undefined })), { kind: 'unknown' })
  assert.deepEqual(describeTimeRange(row({ fromTime: '08:00', toTime: '' })), { kind: 'unknown' })
})

test('describeZones: một nhóm ⇒ một viên, không có "+N"', () => {
  const z = describeZones('Standard')
  assert.ok(z)
  assert.deepEqual(z.visible, ['Standard'])
  assert.equal(z.hiddenCount, 0)
  assert.equal(z.text, 'Standard')
})

test('describeZones: tách theo "|", bỏ khoảng trắng và phần rỗng', () => {
  const z = describeZones(' Standard | VIP ||')
  assert.ok(z)
  assert.deepEqual(z.visible, ['Standard', 'VIP'])
  assert.equal(z.hiddenCount, 0)
})

test('describeZones: quá 2 nhóm ⇒ gộp "+N", tooltip còn đủ tên', () => {
  const z = describeZones('A|B|C|D')
  assert.ok(z)
  assert.deepEqual(z.visible, ['A', 'B'])
  assert.deepEqual(z.hidden, ['C', 'D'])
  assert.equal(z.hiddenCount, 2)
  assert.equal(z.text, 'A, B, C, D')
})

test('describeZones: rỗng / thiếu ⇒ null', () => {
  assert.equal(describeZones(''), null)
  assert.equal(describeZones(undefined), null)
  assert.equal(describeZones(' | '), null)
})

test('sortComboCards: null giữ thứ tự server và không đổi mảng gốc', () => {
  const rows = [row({ userId: 3 }), row({ userId: 2 }), row({ userId: 1 })]
  const out = sortComboCards(rows, null, 'asc')
  assert.deepEqual(out.map((r) => r.userId), [3, 2, 1])
  assert.notEqual(out, rows)
})

test('sortComboCards: theo hạn dùng tăng/giảm, so cả giờ', () => {
  const a = row({ userId: 1, toDate: '2026-11-24', toTime: '18:00' })
  const b = row({ userId: 2, toDate: '2026-11-24', toTime: '09:00' })
  const c = row({ userId: 3, toDate: '2026-11-20', toTime: '23:00' })
  assert.deepEqual(sortComboCards([a, b, c], 'validity', 'asc').map((r) => r.userId), [3, 2, 1])
  assert.deepEqual(sortComboCards([a, b, c], 'validity', 'desc').map((r) => r.userId), [1, 2, 3])
})

test('sortComboCards: tên đăng nhập so số tự nhiên và ổn định khi bằng nhau', () => {
  const rows = [
    row({ userId: 1, userName: 'CB10', zone: 'A' }),
    row({ userId: 2, userName: 'CB2', zone: 'A' }),
    row({ userId: 3, userName: 'CB1', zone: 'A' }),
  ]
  assert.deepEqual(sortComboCards(rows, 'userName', 'asc').map((r) => r.userName), ['CB1', 'CB2', 'CB10'])
  assert.deepEqual(sortComboCards(rows, 'zone', 'asc').map((r) => r.userId), [1, 2, 3])
})

test('comboCardToSeed: giữ userId/userName/note, các trường ví bằng 0', () => {
  const seed = comboCardToSeed(row({ userId: 9, userName: 'X', note: 'ghi chú' }))
  assert.equal(seed.userId, 9)
  assert.equal(seed.userName, 'X')
  assert.equal(seed.note, 'ghi chú')
  assert.equal(seed.moneyRemain, 0)
  assert.equal(seed.groupName, '')
})
