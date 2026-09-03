import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildCredentialPrintHtml,
  decodeCredentialFile,
  formatCredentialText,
  parseCredentialText,
} from '../src/features/printers/credentialPrintModel.ts'

test('đọc file hội viên legacy 4 cột', () => {
  const rows = parseCredentialText('member', 'HV001\tabc123\t50000\t2027-01-01\r\n')
  assert.deepEqual(rows, [{
    kind: 'member',
    username: 'HV001',
    password: 'abc123',
    initialMoney: 50_000,
    expiry: '2027-01-01',
  }])
  const noExpiry = parseCredentialText('member', 'HV002\tsecret\t0\t')
  assert.equal(noExpiry[0].kind === 'member' ? noExpiry[0].expiry : 'x', '')
})

test('đọc file voucher legacy 7 cột và WebUI 4 cột', () => {
  const legacy = parseCredentialText('voucher', '12\tCODE-12\t100000\t2027-02-01\t2026-08-11\t09:00:00\t1')
  assert.equal(legacy[0].kind, 'voucher')
  if (legacy[0].kind === 'voucher') {
    assert.equal(legacy[0].id, 12)
    assert.equal(legacy[0].walletType, 1)
  }

  const web = parseCredentialText('voucher', 'Mã thẻ\tMệnh giá\tHết hạn\tVí\nABC\t50.000 đ\t2027-01-01\tChính')
  assert.equal(web.length, 1)
  assert.equal(web[0].kind === 'voucher' ? web[0].value : 0, 50_000)
})

test('giải mã file Unicode UTF-16LE có BOM của MFC', () => {
  const content = 'HV001\tsecret\t0\t0000-00-00'
  const encoded = Buffer.from(content, 'utf16le')
  const bytes = new Uint8Array(Buffer.concat([Buffer.from([0xff, 0xfe]), encoded]))
  assert.equal(decodeCredentialFile(bytes), content)
})

test('xuất lại định dạng tab legacy và escape HTML in', () => {
  const records = parseCredentialText('member', 'HV001\t<secret>\t0\t0000-00-00')
  assert.equal(formatCredentialText(records), 'HV001\t<secret>\t0\t0000-00-00')
  const html = buildCredentialPrintHtml(records)
  assert.match(html, /&lt;secret&gt;/)
  assert.doesNotMatch(html, /<secret>/)
})

test('từ chối file sai shape', () => {
  assert.throws(() => parseCredentialText('member', 'HV001\tsecret'), /Dòng 1/)
  assert.throws(() => parseCredentialText('voucher', ''), /File trống/)
})
