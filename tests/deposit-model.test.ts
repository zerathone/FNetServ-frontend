import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEPOSIT_METHOD_OPTIONS,
  canSubmitDeposit,
  parseDepositMoneyUnits,
  toDepositApiPaymentMethod,
  toggleDepositAmountSign,
} from '../src/features/payments/depositModel.ts'

test('deposit form exposes the three methods from the MFC flow', () => {
  assert.deepEqual(
    DEPOSIT_METHOD_OPTIONS.map((option) => option.id),
    ['cash', 'transfer', 'qr'],
  )
})

test('all three shipped deposit methods are available', () => {
  assert.equal(canSubmitDeposit('cash', 10_000), true)
  assert.equal(canSubmitDeposit('transfer', 10_000), true)
  assert.equal(canSubmitDeposit('qr', 10_000), true)
})

test('cash and transfer map to the shipped deposit contract while QR stays isolated', () => {
  assert.equal(toDepositApiPaymentMethod('cash'), 'cash')
  assert.equal(toDepositApiPaymentMethod('transfer'), 'bank_transfer')
  assert.throws(() => toDepositApiPaymentMethod('qr'), /\/pyqr/)
})

test('invalid amounts are rejected before a deposit request', () => {
  assert.equal(canSubmitDeposit('cash', null), false)
  assert.equal(canSubmitDeposit('cash', 0), false)
  assert.equal(canSubmitDeposit('cash', -10_000), false)
  assert.equal(canSubmitDeposit('cash', -10_000, true), true)
  assert.equal(canSubmitDeposit('transfer', -10_000, true), true)
  assert.equal(canSubmitDeposit('qr', -10_000, true), false)
  assert.equal(canSubmitDeposit('qr', 9_999), false)
})

test('deposit denomination list follows the 4 x 3 MFC matrix limit', () => {
  assert.deepEqual(
    parseDepositMoneyUnits('10000, 20000,30000').units,
    [10_000, 20_000, 30_000],
  )
  assert.match(parseDepositMoneyUnits('').error, /1 đến 12/)
  assert.match(
    parseDepositMoneyUnits(
      '1,2,3,4,5,6,7,8,9,10,11,12,13',
    ).error,
    /1 đến 12/,
  )
  assert.match(parseDepositMoneyUnits('10000,-20000').error, /số nguyên dương/)
})

test('minus command toggles the amount sign and clear remains null', () => {
  assert.equal(toggleDepositAmountSign(10_000), -10_000)
  assert.equal(toggleDepositAmountSign(-10_000), 10_000)
  assert.equal(toggleDepositAmountSign(null), null)
})
