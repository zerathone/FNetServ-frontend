import assert from 'node:assert/strict'
import test from 'node:test'
import type { OperationNotification } from '../src/api/notifications.ts'
import {
  DEFAULT_NOTIFICATION_PREFS,
  groupOfType,
  groupSummary,
  NOTIFICATION_GROUPS,
  shouldAlert,
  shouldPlaySound,
  type NotificationPrefs,
} from '../src/features/notifications/notificationPrefsModel.ts'

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
    memberId: 0,
    dedupeKey: 'k',
    state: 'new',
    count: 1,
    claimedByStaffId: 0,
    actions: [],
    ...overrides,
  }
}

function prefs(overrides: Partial<NotificationPrefs> = {}): NotificationPrefs {
  return { ...DEFAULT_NOTIFICATION_PREFS, groups: {}, types: {}, ...overrides }
}

test('default prefs keep legacy behaviour: every type toasts, no sound', () => {
  for (const group of NOTIFICATION_GROUPS) {
    for (const item of group.types) {
      assert.equal(shouldAlert(prefs(), notification({ type: item.type })), true, item.type)
    }
  }
  assert.equal(shouldPlaySound(prefs(), notification()), false)
})

test('master switch off silences everything except critical', () => {
  const off = prefs({ enabled: false })
  assert.equal(shouldAlert(off, notification()), false)
  assert.equal(shouldAlert(off, notification({ type: 'qr_payment_failed', severity: 'urgent' })), false)
  assert.equal(shouldAlert(off, notification({ type: 'qr_payment_failed', severity: 'critical' })), true)
})

test('group switch off silences its types but keeps their own choices', () => {
  const p = prefs({ groups: { payment: false }, types: { qr_payment_success: false } })
  assert.equal(shouldAlert(p, notification({ type: 'qr_no_signal' })), false)
  assert.equal(shouldAlert(p, notification({ type: 'service_request' })), true)
  const back = { ...p, groups: { payment: true } }
  assert.equal(shouldAlert(back, notification({ type: 'qr_no_signal' })), true)
  assert.equal(shouldAlert(back, notification({ type: 'qr_payment_success', severity: 'info' })), false)
})

test('type switch only affects that type', () => {
  const p = prefs({ types: { workstation_offline: false } })
  assert.equal(shouldAlert(p, notification({ type: 'workstation_offline', severity: 'info' })), false)
  assert.equal(shouldAlert(p, notification({ type: 'workstation_warning', severity: 'urgent' })), true)
})

test('unknown type follows the master switch only', () => {
  assert.equal(groupOfType('brand_new_type'), undefined)
  assert.equal(shouldAlert(prefs(), notification({ type: 'brand_new_type' })), true)
  assert.equal(shouldAlert(prefs({ enabled: false }), notification({ type: 'brand_new_type' })), false)
})

test('sound needs the sound switch, a non-info severity and an allowed type', () => {
  const on = prefs({ sound: true })
  assert.equal(shouldPlaySound(on, notification({ severity: 'attention' })), true)
  assert.equal(shouldPlaySound(on, notification({ type: 'payment_recorded', severity: 'info' })), false)
  assert.equal(shouldPlaySound({ ...on, types: { service_request: false } }, notification()), false)
})

test('groupSummary counts enabled types', () => {
  const payment = NOTIFICATION_GROUPS.find((group) => group.id === 'payment')!
  const { on, total } = groupSummary(prefs({ types: { qr_payment_success: false } }), payment)
  assert.equal(total, payment.types.length)
  assert.equal(on, total - 1)
})

test('catalog has no duplicate type across groups', () => {
  const seen = new Set<string>()
  for (const group of NOTIFICATION_GROUPS) {
    for (const item of group.types) {
      assert.equal(seen.has(item.type), false, `duplicate ${item.type}`)
      seen.add(item.type)
    }
  }
})
