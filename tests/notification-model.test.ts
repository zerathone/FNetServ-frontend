import assert from 'node:assert/strict'
import test from 'node:test'
import type { OperationNotification, OperationNotificationSnapshot } from '../src/api/notifications.ts'
import {
  mergeNotificationEvent,
  notificationDescription,
  notificationTarget,
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
