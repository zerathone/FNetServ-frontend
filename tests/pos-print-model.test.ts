import assert from 'node:assert/strict'
import test from 'node:test'
import {
  eligiblePosPrinters,
  findPrinterByName,
  formatReceiptDate,
  formatReceiptDateTime,
  formatReceiptNumber,
  formatSystemDateTime,
  hasRoomInfo,
  pickPrinterId,
  readPosPrefs,
  roomInfoRowsHtml,
  writePosPrefs,
  type PosPrinterLike,
} from '../src/features/printers/posPrintModel.ts'

const printer = (patch: Partial<PosPrinterLike> = {}): PosPrinterLike => ({
  printerId: 1,
  printerName: 'Quầy',
  type: 2,
  active: 1,
  ipAddress: '192.168.1.50',
  ...patch,
})

test('eligiblePosPrinters chỉ giữ máy hoạt động, có IP, khổ nhiệt 58/80', () => {
  const list = [
    printer({ printerId: 1 }),
    printer({ printerId: 2, active: 0 }),
    printer({ printerId: 3, ipAddress: '  ' }),
    printer({ printerId: 4, type: 0 }),
    printer({ printerId: 5, type: 1 }),
    printer({ printerId: undefined }),
  ]
  assert.deepEqual(
    eligiblePosPrinters(list).map((item) => item.printerId),
    [1, 5],
  )
})

test('findPrinterByName không phân biệt hoa thường/khoảng trắng', () => {
  const list = [printer({ printerId: 7, printerName: 'Bếp Chính' })]
  assert.equal(findPrinterByName(list, '  bếp chính ')?.printerId, 7)
  assert.equal(findPrinterByName(list, ''), undefined)
  assert.equal(findPrinterByName(list, 'khác'), undefined)
})

test('pickPrinterId: lần chọn trước → trùng tên cấu hình → máy đầu → 0', () => {
  const list = [printer({ printerId: 1, printerName: 'A' }), printer({ printerId: 2, printerName: 'B' })]
  assert.equal(pickPrinterId(list, 2, 'A'), 2)
  assert.equal(pickPrinterId(list, 99, 'B'), 2) // 99 không còn hợp lệ
  assert.equal(pickPrinterId(list, undefined, 'zzz'), 1)
  assert.equal(pickPrinterId([], 1, 'A'), 0)
})

test('readPosPrefs/writePosPrefs: vòng khứ hồi, bỏ qua dữ liệu hỏng, không ném khi storage lỗi', () => {
  const store = new Map<string, string>()
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  }
  assert.deepEqual(readPosPrefs('combo', storage), {})
  writePosPrefs('combo', { printerId: 3, roomInfo: true, enabled: false }, storage)
  assert.deepEqual(readPosPrefs('combo', storage), { printerId: 3, roomInfo: true, enabled: false })
  assert.deepEqual(readPosPrefs('deposit', storage), {}) // scope độc lập

  store.set('fnet.print.combo', '{not json')
  assert.deepEqual(readPosPrefs('combo', storage), {})
  store.set('fnet.print.combo', JSON.stringify({ printerId: -5, roomInfo: 'yes', enabled: 1 }))
  assert.deepEqual(readPosPrefs('combo', storage), {})

  const throwing = {
    getItem: () => {
      throw new Error('blocked')
    },
    setItem: () => {
      throw new Error('blocked')
    },
  }
  assert.deepEqual(readPosPrefs('combo', throwing), {})
  assert.doesNotThrow(() => writePosPrefs('combo', { printerId: 1 }, throwing))
  assert.deepEqual(readPosPrefs('combo', null), {})
})

test('roomInfoRowsHtml: rỗng khi chưa có tên phòng máy; bỏ dòng rỗng; escape HTML', () => {
  const empty = { cafeName: '  ', cafeAddress: 'x', cafePhone: '', cafePage: '', cafeEmail: '' }
  assert.equal(hasRoomInfo(empty), false)
  assert.equal(roomInfoRowsHtml(empty), '')
  assert.equal(roomInfoRowsHtml(null), '')

  const html = roomInfoRowsHtml({
    cafeName: 'Net <Hub>',
    cafeAddress: '12 Nguyễn Huệ',
    cafePhone: '0909',
    cafePage: '',
    cafeEmail: '',
  })
  assert.match(html, /\*{16}/)
  assert.match(html, /Net &lt;Hub&gt;/)
  assert.match(html, /Địa chỉ:/)
  assert.match(html, /Điện thoại:/)
  assert.doesNotMatch(html, /Website:/)
  assert.doesNotMatch(html, /Email:/)
})

test('định dạng số/ngày/giờ khớp phiếu Qt', () => {
  assert.equal(formatReceiptNumber(1500000), '1,500,000')
  assert.equal(formatReceiptDate('2026-10-14'), '14/10/2026')
  assert.equal(formatReceiptDate('lạ'), 'lạ')
  assert.equal(formatReceiptDateTime('2026-10-14 09:05:30'), '14/10/2026 09:05')
  assert.equal(formatReceiptDateTime('không khớp'), 'không khớp')
  assert.equal(formatSystemDateTime(new Date(2026, 9, 14, 9, 5, 7)), '2026-10-14 09:05:07')
})
