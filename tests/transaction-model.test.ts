import assert from 'node:assert/strict'
import test from 'node:test'
import type { VoucherLog } from '../src/api/logs.ts'
import {
  PAYMENT_TYPES,
  hasServiceDetails,
  hasTransferDetails,
  isVoucherRefundable,
} from '../src/features/transactions/transactionModel.ts'

function voucher(patch: Partial<VoucherLog> = {}): VoucherLog {
  return {
    voucherId: 100,
    userId: 42,
    userName: 'member01',
    voucherNo: '',
    voucherDate: '2026-07-30',
    voucherTime: '10:00:00',
    amount: 50_000,
    autoAmount: 50_000,
    paymentType: PAYMENT_TYPES.TIME_FEE,
    servicePaid: 1,
    staffId: 7,
    staffName: 'cashier',
    machineName: 'PC-01',
    note: '',
    ...patch,
  }
}

test('refund parity only enables the transaction types allowed by the MFC menu', () => {
  assert.equal(isVoucherRefundable(voucher()), true)
  assert.equal(
    isVoucherRefundable(voucher({ paymentType: PAYMENT_TYPES.MEMBER_RECHARGE_QR })),
    true,
  )
  assert.equal(
    isVoucherRefundable(
      voucher({ paymentType: PAYMENT_TYPES.SERVICE_QR, servicePaid: 3 }),
    ),
    true,
  )
  assert.equal(
    isVoucherRefundable(voucher({ paymentType: PAYMENT_TYPES.SERVICE_QR })),
    false,
  )
  assert.equal(isVoucherRefundable(voucher({ voucherNo: 'recall' })), false)
  assert.equal(isVoucherRefundable(voucher({ amount: -50_000 })), false)
})

test('detail capabilities follow the active voucher context menus', () => {
  assert.equal(hasServiceDetails(PAYMENT_TYPES.SERVICE_CASH), true)
  assert.equal(hasServiceDetails(PAYMENT_TYPES.TIME_FEE), false)
  assert.equal(hasTransferDetails(PAYMENT_TYPES.TRANSFER_SERVICE), true)
  assert.equal(hasTransferDetails(PAYMENT_TYPES.TRANSFER_FEE), true)
  assert.equal(hasTransferDetails(PAYMENT_TYPES.SERVICE_CASH), false)
})
