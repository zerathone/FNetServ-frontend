import assert from 'node:assert/strict'
import test from 'node:test'
import type { Combo, ComboSaleResult } from '../src/api/combo.ts'
import {
  buildComboCardHtml,
  formatComboCredentialsText,
  toComboCardData,
} from '../src/features/checkout/comboCardPrintModel.ts'

const context = { fallbackIssuedAt: '2026-10-14 09:05:00', fallbackStaffName: 'thungan' }

const result = (patch: Partial<ComboSaleResult> = {}): ComboSaleResult => ({
  comboId: 1,
  userId: 10,
  paymentId: 20,
  comboDetailId: 30,
  idem: 'k-0',
  username: 'combo001',
  password: 'p@ss<1>',
  ...patch,
})

const combo = {
  comboId: 1,
  name: 'Combo đêm',
  price: 50_000,
  type: 1,
  duration: 0,
  machineGroups: [
    { machineGroupId: 1, name: 'VIP', fromTime: 20, toTime: 6 },
    { machineGroupId: 2, name: 'Thường', fromTime: 20, toTime: 6 },
  ],
  donates: [{ serviceId: 9, name: 'Nước suối', quantity: 2, unit: 'chai', provider: '', product: '', code: '' }],
} as unknown as Combo

const cafe = {
  cafeName: 'Net Hub',
  cafeAddress: '12 Nguyễn Huệ',
  cafePhone: '0909',
  cafePage: 'nethub.vn',
  cafeEmail: 'a@b.vn',
}

test('toComboCardData: dữ liệu server thắng danh mục; thiếu thì bù từ danh mục', () => {
  const server = toComboCardData(
    result({ price: 45_000, zone: 'Zone S', fromDate: '2026-10-14', fromTime: '20:00:00', toDate: '2026-10-15', toTime: '06:00:00', donates: [], comboType: 1 }),
    combo,
    context,
  )
  assert.equal(server.price, 45_000)
  assert.equal(server.zone, 'Zone S')
  assert.equal(toComboCardData(result({ zone: 'VIP|Thường| ' }), combo, context).zone, 'VIP, Thường')
  assert.deepEqual(server.donates, []) // server trả mảng rỗng ⇒ giữ nguyên, không bù từ danh mục
  assert.equal(server.fromDate, '2026-10-14')

  const old = toComboCardData(result(), combo, context)
  assert.equal(old.price, 50_000)
  assert.equal(old.zone, 'VIP, Thường')
  assert.deepEqual(old.donates, [{ name: 'Nước suối', quantity: 2 }])
  assert.equal(old.issuedAt, context.fallbackIssuedAt)
  assert.equal(old.staffName, 'thungan')
  assert.equal(old.fromDate, '') // BE cũ: không bịa hạn dùng

  const orphan = toComboCardData(result(), undefined, context)
  assert.equal(orphan.price, null)
  assert.equal(orphan.zone, '')
})

test('buildComboCardHtml: type 1 có Từ/Đến giờ, tài khoản/mật khẩu được escape', () => {
  const card = toComboCardData(
    result({ fromDate: '2026-10-14', fromTime: '20:00:00', toDate: '2026-10-15', toTime: '06:00:00' }),
    combo,
    context,
  )
  const html = buildComboCardHtml({ card, printerName: 'Quầy <1>', type: 2 })
  assert.match(html, /THẺ COMBO/)
  assert.match(html, /p@ss&lt;1&gt;/)
  assert.doesNotMatch(html, /p@ss<1>/)
  assert.match(html, /Quầy &lt;1&gt;/)
  assert.match(html, /14\/10\/2026 20:00/)
  assert.match(html, /15\/10\/2026 06:00/)
  assert.match(html, /Giờ sử dụng:/)
  assert.match(html, /Đến:/)
  assert.match(html, /50,000/)
  assert.match(html, /Dịch vụ tặng kèm:/)
  assert.match(html, /Nước suối/)
  assert.doesNotMatch(html, /Thời lượng:/)
  assert.match(html, /\.{32}/) // POS58 = 32 chấm
  assert.doesNotMatch(html, /\*{16}/) // chưa tick thông tin phòng máy
})

test('buildComboCardHtml: type 2 in Thời lượng + giờ bắt đầu; POS80 = 46 chấm', () => {
  const card = toComboCardData(
    result({ comboType: 2, duration: 5, fromDate: '2026-10-14', fromTime: '18:30:00', toDate: '2026-10-21', toTime: '18:30:00' }),
    combo,
    context,
  )
  const html = buildComboCardHtml({ card, printerName: 'Bếp', type: 1 })
  assert.match(html, /Thời lượng:/)
  assert.match(html, /5 tiếng/)
  assert.match(html, /\.{46}/)
})

test('buildComboCardHtml: khối phòng máy CHỈ khi truyền cafe', () => {
  const card = toComboCardData(result(), combo, context)
  const without = buildComboCardHtml({ card, printerName: 'Q', type: 2 })
  const withCafe = buildComboCardHtml({ card, printerName: 'Q', type: 2, cafe })
  assert.doesNotMatch(without, /Net Hub/)
  assert.match(withCafe, /Net Hub/)
  assert.match(withCafe, /nethub\.vn/)
})

test('buildComboCardHtml: không có dịch vụ tặng kèm / hạn dùng thì bỏ mục, không ném', () => {
  const card = toComboCardData(result(), { ...combo, donates: [] } as unknown as Combo, context)
  const html = buildComboCardHtml({ card, printerName: 'Q', type: 2 })
  assert.doesNotMatch(html, /Dịch vụ tặng kèm:/)
  assert.doesNotMatch(html, /Thời hạn sử dụng:/)
})

test('formatComboCredentialsText: mỗi thẻ một dòng tab-ngăn cách', () => {
  assert.equal(
    formatComboCredentialsText([
      { username: 'a', password: '1' },
      { username: 'b', password: '2' },
    ]),
    'a\t1\r\nb\t2',
  )
})
