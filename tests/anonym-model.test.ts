import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maskIdCard,
  matchesAnonymous,
  validateAnonymousDetail,
} from '../src/features/anonyms/anonymModel.ts'

const customer = {
  id: 1,
  name: 'Nguyễn Văn An',
  idCard: '079123456789',
  address: 'Quận 1',
}

test('anonymous search covers name, CCCD and address while list masking keeps identity recognizable', () => {
  assert.equal(matchesAnonymous(customer, 'văn an'), true)
  assert.equal(matchesAnonymous(customer, '3456789'), true)
  assert.equal(matchesAnonymous(customer, 'quận 1'), true)
  assert.equal(matchesAnonymous(customer, 'không có'), false)
  assert.equal(maskIdCard(customer.idCard), '079••••6789')
})

test('anonymous detail validation mirrors required and max-length handler guards', () => {
  assert.equal(validateAnonymousDetail(customer), null)
  assert.match(
    validateAnonymousDetail({ ...customer, idCard: '' }) ?? '',
    /CCCD/,
  )
  assert.match(
    validateAnonymousDetail({ ...customer, name: 'x'.repeat(256) }) ?? '',
    /255/,
  )
})
