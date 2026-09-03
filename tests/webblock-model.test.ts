import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canMutateWebBlock,
  matchesProtectedDomain,
  validateWebBlock,
} from '../src/features/webblock/webBlockModel.ts'

const localItem = {
  id: 1,
  url: 'facebook.com',
  title: 'Mạng xã hội',
  active: true,
  description: '',
  addedBy: 2,
}

test('web-block source guard keeps master records read-only like the MFC list', () => {
  assert.equal(canMutateWebBlock(localItem), true)
  assert.equal(canMutateWebBlock({ ...localItem, addedBy: 3 }), false)
})

test('web-block validation follows live handler limits', () => {
  assert.equal(validateWebBlock(localItem), null)
  assert.match(validateWebBlock({ ...localItem, url: '' }) ?? '', /địa chỉ/i)
  assert.match(
    validateWebBlock({ ...localItem, description: 'x'.repeat(251) }) ?? '',
    /250/,
  )
})

test('web-block protects the active server and known bootstrap domain', () => {
  assert.equal(matchesProtectedDomain('https://billing.local/path', ['billing.local']), true)
  assert.equal(matchesProtectedDomain('facebook.com', ['billing.local']), false)
  assert.match(
    validateWebBlock(localItem, ['facebook.com']) ?? '',
    /máy chủ/,
  )
})
