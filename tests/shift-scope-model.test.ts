import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ORDER_PAUSED_CODE,
  SHIFT_CHANGED_QUERY_KEYS,
  SHIFT_REQUIRED_CODE,
  SHIFT_REQUIRED_MESSAGE,
  classifyShiftBlock,
  describeStatsWindow,
  isShiftBlockResolved,
  isShiftWindow,
  pickErrorCode,
  scopeKeyPart,
  statsScopeFor,
  withShiftScope,
} from '../src/features/shifts/shiftScopeModel.ts'

// ---- scope=shift: mode 0 / không ca ⇒ KHÔNG gửi gì (lời gọi y hệt trước) ----

test('statsScopeFor: chế độ 0 hoặc không có ca => undefined (không gửi scope)', () => {
  assert.equal(statsScopeFor({ enabled: false, shift: null }), undefined)
  // Dù cache cũ còn một ca, chế độ 0 vẫn không gửi scope.
  assert.equal(statsScopeFor({ enabled: false, shift: { shiftId: 7 } }), undefined)
  assert.equal(statsScopeFor({ enabled: true, shift: null }), undefined)
})

test('statsScopeFor: chế độ ca bật và có ca mở => shift', () => {
  assert.equal(statsScopeFor({ enabled: true, shift: { shiftId: 7 } }), 'shift')
})

test('withShiftScope: không scope => path NGUYÊN VẸN (y hệt trước khi có tính năng ca)', () => {
  assert.equal(withShiftScope('/combo/sales/stats', undefined), '/combo/sales/stats')
  assert.equal(withShiftScope('/orders/completed/stats', undefined), '/orders/completed/stats')
})

test('withShiftScope: chỉ giá trị "shift" mới gắn tham số; context của React Query lọt vào thì bỏ qua', () => {
  assert.equal(withShiftScope('/combo/sales/stats', 'shift'), '/combo/sales/stats?scope=shift')
  assert.equal(withShiftScope('/x?date=2026-11-22', 'shift'), '/x?date=2026-11-22&scope=shift')
  assert.equal(withShiftScope('/combo/sales/stats', { queryKey: ['a'], signal: {} }), '/combo/sales/stats')
  assert.equal(withShiftScope('/combo/sales/stats', 'rolling'), '/combo/sales/stats')
  assert.equal(withShiftScope('/combo/sales/stats', null), '/combo/sales/stats')
})

test('scopeKeyPart: số theo ca và số 24 giờ không chung key cache', () => {
  assert.equal(scopeKeyPart('shift'), 'shift')
  assert.equal(scopeKeyPart(undefined), 'rolling')
  assert.notEqual(scopeKeyPart('shift'), scopeKeyPart(undefined))
})

test('SHIFT_CHANGED_QUERY_KEYS: phủ trạng thái ca + widget + hai ô thống kê, không phủ danh sách đơn (24 giờ)', () => {
  const flat = SHIFT_CHANGED_QUERY_KEYS.map((key) => key.join('/'))
  assert.deepEqual(flat.sort(), ['combo-sales-stats', 'orders-completed/stats', 'shift', 'shift-income'])
  // Danh sách đơn hoàn thành (key ['orders-completed','list']) KHÔNG được khớp tiền tố nào trong số này.
  const listKey = ['orders-completed', 'list']
  const matchesPrefix = (prefix: readonly string[]) => prefix.every((part, index) => listKey[index] === part)
  assert.equal(SHIFT_CHANGED_QUERY_KEYS.some(matchesPrefix), false)
})

// ---- nhãn khung thời gian: rẽ nhánh theo windowSource, KHÔNG theo window ----

test('describeStatsWindow: windowSource=shift => "Toàn quán từ khi mở ca (HH:mm dd/MM)"', () => {
  const label = describeStatsWindow('shift', '2026-11-22 08:05:00')
  assert.equal(label?.text, 'Toàn quán từ khi mở ca (08:05 22/11)')
  assert.match(label?.title ?? '', /cả quán/)
})

test('describeStatsWindow: rolling24h / date / máy chủ cũ không có windowSource => giữ nhãn cũ "Ca từ …"', () => {
  for (const source of ['rolling24h', 'date', undefined, null, 'lạ']) {
    const label = describeStatsWindow(source, '2026-11-21 09:30:15')
    assert.equal(label?.text, 'Ca từ 09:30 21/11')
    assert.equal(label?.title, 'Thời điểm bắt đầu tính thống kê này (giờ máy chủ).')
  }
})

test('describeStatsWindow: mốc sai định dạng / thiếu => null (ẩn dòng, không vỡ)', () => {
  assert.equal(describeStatsWindow('shift', undefined), null)
  assert.equal(describeStatsWindow('shift', ''), null)
  assert.equal(describeStatsWindow('rolling24h', 'hôm qua'), null)
})

test('isShiftWindow chỉ nhận đúng "shift"', () => {
  assert.equal(isShiftWindow('shift'), true)
  for (const value of ['rolling24h', 'date', '24h', 'day', undefined, null]) assert.equal(isShiftWindow(value), false)
})

// ---- SHIFT_REQUIRED / ORDER_PAUSED ----

test('classifyShiftBlock: SHIFT_REQUIRED => câu cố định + nút Mở ca, bỏ qua message máy chủ', () => {
  const block = classifyShiftBlock('SHIFT_REQUIRED', 'Quầy đang tạm ngưng nhận thanh toán QR, vui lòng quay lại sau', {
    code: 'SHIFT_REQUIRED',
    reason: 'staff_no_shift',
  })
  assert.equal(block?.code, SHIFT_REQUIRED_CODE)
  assert.equal(block?.message, 'Bạn chưa mở ca. Hãy mở ca rồi thử lại.')
  assert.equal(block?.message, SHIFT_REQUIRED_MESSAGE)
  assert.deepEqual(block?.actions, ['open-shift'])
})

test('classifyShiftBlock: ORDER_PAUSED ngừng thủ công => message máy chủ + nút Tiếp tục nhận đơn', () => {
  const block = classifyShiftBlock('ORDER_PAUSED', 'Quán đang tạm ngừng nhận đơn, vui lòng quay lại sau', {
    code: 'ORDER_PAUSED',
    source: 'manual',
  })
  assert.equal(block?.code, ORDER_PAUSED_CODE)
  assert.equal(block?.message, 'Quán đang tạm ngừng nhận đơn, vui lòng quay lại sau')
  assert.deepEqual(block?.actions, ['resume-intake'])
})

test('classifyShiftBlock: ORDER_PAUSED không có ca => nút Mở ca; nguồn lạ/thiếu => không nút (không đoán)', () => {
  assert.deepEqual(
    classifyShiftBlock('ORDER_PAUSED', 'Quán chưa mở ca, tạm ngừng nhận đơn. Vui lòng quay lại sau', { source: 'no_shift' })?.actions,
    ['open-shift'],
  )
  assert.deepEqual(classifyShiftBlock('ORDER_PAUSED', 'x', { source: 'khac' })?.actions, [])
  assert.deepEqual(classifyShiftBlock('ORDER_PAUSED', 'x', undefined)?.actions, [])
  assert.deepEqual(classifyShiftBlock('ORDER_PAUSED', 'x', '')?.actions, [])
})

test('classifyShiftBlock: ORDER_PAUSED thiếu message => câu dự phòng tiếng Việt, không để trống', () => {
  const block = classifyShiftBlock('ORDER_PAUSED', '   ', { source: 'manual' })
  assert.match(block?.message ?? '', /tạm ngừng nhận đơn/)
})

test('classifyShiftBlock: mã khác / không có mã => null (lỗi thường, xử lý như cũ)', () => {
  for (const code of ['SHIFT_DISABLED', 'RBAC_DENIED', 'idem_mismatch', '', undefined, null, 403]) {
    assert.equal(classifyShiftBlock(code, 'x', {}), null)
  }
})

test('pickErrorCode: data.code trước, rồi code ở cấp ngoài (S4 ghi cả hai); không có => undefined', () => {
  assert.equal(pickErrorCode({ code: 'SHIFT_REQUIRED', reason: 'no_open_shift' }, undefined), 'SHIFT_REQUIRED')
  assert.equal(pickErrorCode({ code: 'ORDER_PAUSED' }, 'KHAC'), 'ORDER_PAUSED')
  assert.equal(pickErrorCode(undefined, 'SHIFT_REQUIRED'), 'SHIFT_REQUIRED')
  assert.equal(pickErrorCode({ reason: 'x' }, 'ORDER_PAUSED'), 'ORDER_PAUSED')
  assert.equal(pickErrorCode({ code: 7 }, undefined), '7')
  assert.equal(pickErrorCode(undefined, undefined), undefined)
  assert.equal(pickErrorCode('', ''), undefined)
  assert.equal(pickErrorCode({ code: null }, 123), undefined)
})

test('isShiftBlockResolved: chỉ coi là xong khi trạng thái ca đã tải LẠI sau lúc báo lỗi', () => {
  const base = { enabled: true, hasShift: true, intakePaused: false }
  // Cache cũ (chưa tải lại) ⇒ chưa xong dù cache đang nói có ca: tránh báo "đã xong" sai.
  assert.equal(isShiftBlockResolved('SHIFT_REQUIRED', { ...base, fresh: false }), false)
  assert.equal(isShiftBlockResolved('ORDER_PAUSED', { ...base, fresh: false }), false)
  // Đã tải lại.
  assert.equal(isShiftBlockResolved('SHIFT_REQUIRED', { ...base, fresh: true }), true)
  assert.equal(isShiftBlockResolved('SHIFT_REQUIRED', { ...base, hasShift: false, fresh: true }), false)
  assert.equal(isShiftBlockResolved('SHIFT_REQUIRED', { ...base, enabled: false, hasShift: false, fresh: true }), true)
  assert.equal(isShiftBlockResolved('ORDER_PAUSED', { ...base, fresh: true }), true)
  assert.equal(isShiftBlockResolved('ORDER_PAUSED', { ...base, intakePaused: true, fresh: true }), false)
})
