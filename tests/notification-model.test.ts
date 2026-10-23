import assert from 'node:assert/strict'
import test from 'node:test'
import type { OperationNotification, OperationNotificationSnapshot } from '../src/api/notifications.ts'
import {
  chainEvents,
  logEventsForHost,
  mergeNotificationEvent,
  notificationDescription,
  notificationIsDisplayable,
  notificationTarget,
  notificationTitle,
} from '../src/features/notifications/notificationModel.ts'

function notification(overrides: Partial<OperationNotification> = {}): OperationNotification {
  return {
    id: 'ntf_1',
    seq: 1,
    type: 'service_request',
    domain: 'order',
    severity: 'attention',
    createdAtMs: 1,
    updatedAtMs: 1,
    hostName: 'PC-01',
    memberId: 12,
    dedupeKey: 'order:PC-01',
    state: 'new',
    count: 1,
    claimedByStaffId: 0,
    actions: [],
    ...overrides,
  }
}

test('notification event updates an existing RAM item without duplicating it', () => {
  const snapshot: OperationNotificationSnapshot = {
    bootId: 'b_1',
    seq: 1,
    oldestSeq: 1,
    dropped: false,
    items: [notification()],
  }
  const next = mergeNotificationEvent(snapshot, notification({ state: 'claimed', count: 2 }))
  assert.equal(next?.items.length, 1)
  assert.equal(next?.items[0].state, 'claimed')
  assert.equal(next?.items[0].count, 2)
})

const day = '2026-10-23'
const logRow = (id: number, time: string, status: string, machineName = 'PC01') => ({
  id,
  machineName,
  userName: '',
  enterDate: day,
  enterTime: time,
  status,
})

test('system-log events: mapped, tone-coded, exact host match only', () => {
  const rows = [
    logRow(4, '15:38:16', 'Sẵn sàng'),
    logRow(3, '15:38:12', 'Mất kết nối'),
    logRow(9, '15:36:00', 'Mất kết nối', 'PC010'), // LIKE '%PC01%' của server trả nhầm máy khác
  ]
  const events = logEventsForHost('PC01', rows)
  assert.deepEqual(events.map((event) => event.label), ['Mất kết nối', 'Sẵn sàng'])
  assert.deepEqual(events.map((event) => event.tone), ['urgent', 'ok'])
})

test('chain splits when two neighbouring events are more than 5 minutes apart', () => {
  const events = logEventsForHost('PC01', [
    logRow(1, '15:00:00', 'Mất kết nối'),
    logRow(2, '15:04:59', 'Sẵn sàng'), // 4'59" ⇒ cùng chuỗi
    logRow(3, '15:09:00', 'Mất kết nối'), // 4'01" sau sự kiện liền trước ⇒ vẫn nối (không so mốc đầu)
    logRow(4, '15:14:30', 'Sẵn sàng'), // 5'30" ⇒ tách
    logRow(5, '15:15:00', 'Đang sử dụng'),
  ])
  assert.deepEqual(chainEvents(events).map((chain) => chain.length), [3, 2])
})

test('system-log event shows the logged-in account next to the status', () => {
  const events = logEventsForHost('PC03', [
    { ...logRow(2, '15:05:29', 'Đang sử dụng', 'PC03'), userName: 'TESTORDER' },
    logRow(1, '15:05:16', 'Sẵn sàng', 'PC03'),
  ])
  assert.deepEqual(events.map((event) => event.label), ['Sẵn sàng', 'Đang sử dụng · TESTORDER'])
})

test('unknown type without server title is hidden; known types and titled ones show', () => {
  assert.equal(notificationIsDisplayable(notification({ type: 'mystery' })), false)
  assert.equal(notificationIsDisplayable(notification({ type: 'mystery', title: 'Có tiêu đề' })), true)
  assert.equal(notificationTitle(notification({ type: 'workstation_warning' })), 'Cảnh báo')
  assert.equal(
    notificationTitle(notification({ type: 'service_debit' })),
    'Khách rời máy còn nợ dịch vụ',
  )
})

test('operation notification actions route to authoritative frontend workspaces', () => {
  assert.equal(notificationTarget(notification()), '/orders')
  assert.equal(
    notificationTarget(notification({ type: 'payment_recorded', domain: 'payment' })),
    '/logs/voucher',
  )
  assert.equal(
    notificationTarget(notification({ type: 'workstation_warning', domain: 'workstation' })),
    '/workstations',
  )
  assert.match(notificationDescription(notification({ count: 3 })), /lặp 3 lần/)
})
