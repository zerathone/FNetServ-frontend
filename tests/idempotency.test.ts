import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIdempotencyKey,
  fingerprintIntent,
  IdempotencyIntent,
} from '../src/lib/idempotency.ts'

test('idem key fits paymenttb.zOid VARCHAR(50) and keeps a safe scope prefix', () => {
  const key = createIdempotencyKey('Payment Wait/Payout')
  assert.match(key, /^payment-wait-[0-9a-f-]+$/)
  assert.ok(key.length <= 50)
})

test('long scopes never push the random part past 50 chars', () => {
  for (const scope of ['order-service-accept', 'workstation-workspace-money', 'x'.repeat(80)]) {
    const key = createIdempotencyKey(scope)
    assert.ok(key.length <= 50, `${scope} -> ${key.length}`)
    // UUID 36 ký tự còn nguyên ở cuối (không bị cắt mất tính ngẫu nhiên)
    assert.match(key, /-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  }
})

test('same intent reuses key across retry', () => {
  const intent = new IdempotencyIntent('deposit')
  const fingerprint = fingerprintIntent({ userId: 10, amount: 50_000 })
  assert.equal(intent.getKey(fingerprint), intent.getKey(fingerprint))
})

test('changed or cleared intent receives a new key', () => {
  const intent = new IdempotencyIntent('deposit')
  const first = intent.getKey(fingerprintIntent({ userId: 10, amount: 50_000 }))
  const changed = intent.getKey(fingerprintIntent({ userId: 10, amount: 100_000 }))
  assert.notEqual(first, changed)

  intent.clear()
  const afterCancel = intent.getKey(fingerprintIntent({ userId: 10, amount: 100_000 }))
  assert.notEqual(changed, afterCancel)
})
