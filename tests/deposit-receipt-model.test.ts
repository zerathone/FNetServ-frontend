import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildDepositReceiptHtml,
  depositMethodLabel,
  isPrintableDepositAmount,
  parseDepositPrintConfig,
  type DepositReceiptInput,
} from '../src/features/payments/depositReceiptModel.ts'

const b64 = (text: string) => Buffer.from(text, 'utf-8').toString('base64')

test('parseDepositPrintConfig: giải mã base64 đúng như MFC (GetConfig(true)), hỗ trợ tiếng Việt', () => {
  const json = JSON.stringify({ paper_type: 1, printer: 'Quầy bếp', cafe_info: true, note: 'Cảm ơn quý khách' })
  assert.deepEqual(parseDepositPrintConfig(b64(json)), {
    printer: 'Quầy bếp',
    cafeInfo: true,
    note: 'Cảm ơn quý khách',
  })
})

test('parseDepositPrintConfig: nhận cả JSON thô; mặc định cafe_info=false, note rỗng', () => {
  assert.deepEqual(parseDepositPrintConfig(JSON.stringify({ paper_type: 2, printer: 'P' })), {
    printer: 'P',
    cafeInfo: false,
    note: '',
  })
})

test('parseDepositPrintConfig: không hợp lệ như MFC LoadConfig ⇒ null, không ném', () => {
  assert.equal(parseDepositPrintConfig(undefined), null)
  assert.equal(parseDepositPrintConfig(''), null)
  assert.equal(parseDepositPrintConfig('!!!không phải base64 hay json'), null)
  assert.equal(parseDepositPrintConfig(b64('[1,2]')), null)
  assert.equal(parseDepositPrintConfig(b64(JSON.stringify({ paper_type: 1, printer: '' }))), null)
  assert.equal(parseDepositPrintConfig(b64(JSON.stringify({ paper_type: -1, printer: 'P' }))), null)
  assert.equal(parseDepositPrintConfig(b64(JSON.stringify({ printer: 'P' }))), null)
})

test('depositMethodLabel: tiền mặt vs chuyển khoản (QR cũng là chuyển khoản)', () => {
  assert.equal(depositMethodLabel('cash'), 'Tiền mặt')
  assert.equal(depositMethodLabel('transfer'), 'Chuyển khoản')
  assert.equal(depositMethodLabel('qr'), 'Chuyển khoản')
})

test('isPrintableDepositAmount: chỉ số dương hữu hạn (số âm là rút tiền)', () => {
  assert.equal(isPrintableDepositAmount(50_000), true)
  assert.equal(isPrintableDepositAmount(0), false)
  assert.equal(isPrintableDepositAmount(-1000), false)
  assert.equal(isPrintableDepositAmount(null), false)
  assert.equal(isPrintableDepositAmount(undefined), false)
  assert.equal(isPrintableDepositAmount(Number.NaN), false)
})

const input = (patch: Partial<DepositReceiptInput> = {}): DepositReceiptInput => ({
  issueDate: '2026-10-14 09:05:07',
  staffName: 'thungan',
  amount: 150_000,
  username: 'hoivien<1>',
  methodLabel: 'Tiền mặt',
  machine: 'PC-05',
  printerName: 'Quầy',
  note: 'Cảm ơn',
  type: 2,
  ...patch,
})

test('buildDepositReceiptHtml: đủ dòng, số tiền dấu phẩy, escape HTML', () => {
  const html = buildDepositReceiptHtml(input())
  assert.match(html, /NẠP TIỀN TÀI KHOẢN/)
  assert.match(html, /2026-10-14 09:05:07/)
  assert.match(html, /150,000/)
  assert.match(html, /hoivien&lt;1&gt;/)
  assert.doesNotMatch(html, /hoivien<1>/)
  assert.match(html, /Máy sử dụng:/)
  assert.match(html, /PC-05/)
  assert.match(html, /Ghi chú:/)
  assert.match(html, /\.{32}/)
  assert.doesNotMatch(html, /\*{16}/)
})

test('buildDepositReceiptHtml: bỏ dòng máy/ghi chú khi rỗng; khối phòng máy chỉ khi truyền cafe', () => {
  const bare = buildDepositReceiptHtml(input({ machine: '', note: '  ', type: 1 }))
  assert.doesNotMatch(bare, /Máy sử dụng:/)
  assert.doesNotMatch(bare, /Ghi chú:/)
  assert.match(bare, /\.{46}/)

  const withCafe = buildDepositReceiptHtml(
    input({ cafe: { cafeName: 'Net Hub', cafeAddress: 'A', cafePhone: '1', cafePage: '', cafeEmail: '' } }),
  )
  assert.match(withCafe, /Net Hub/)
  assert.match(withCafe, /\*{16}/)
})
