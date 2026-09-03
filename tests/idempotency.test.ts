import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createIdempotencyKey,
  fingerprintIntent,
  IdempotencyIntent,
} from '../src/lib/idempotency.ts'

test('idem key fits backend limit and contains a safe scope', () => {
  const key = createIdempotencyKey('Payment Wait/Payout')
  assert.match(key, /^payment-wait-payout-/)
  assert.ok(key.length <= 64)
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
