import assert from 'node:assert/strict'
import test from 'node:test'
import type { PrintTargetPrinter, PrintTargetsResponse } from '../src/api/orders.ts'
import {
  buildServiceTicketHtml,
  describePrintFailure,
  escapeHtml,
  formatTicketDate,
  jobStateOf,
  printerPaper,
  splitPrinters,
  ticketCustomerLabel,
  ticketHostLabel,
  ticketTotal,
} from '../src/features/orders/printTicketModel.ts'

function printer(patch: Partial<PrintTargetPrinter> = {}): PrintTargetPrinter {
  return {
    printerId: 1,
    name: 'Bếp',
    type: 1,
    paperWidth: 384, // BE-2 đang đảo — model KHÔNG được tin giá trị này
    hasIp: true,
    printable: true,
    items: [{ detailId: 5, serviceName: 'Mì tôm', quantity: 2, unit: 'tô', amount: 30_000 }],
    ...patch,
  }
}

const header: PrintTargetsResponse['header'] = {
  hostName: 'PC-01',
  userId: 7,
  userName: 'an',
  voucherId: 0,
  staffId: 2,
  staffName: 'thungan',
  paidDate: '',
  paidTime: '',
  orderDate: '2026-10-08',
  orderTime: '09:15:30',
}

test('printerPaper: Type 1 = POS80/576, Type 2 = POS58/384, con lai khong in duoc (khop browserHtmlRaster)', () => {
  assert.deepEqual(printerPaper(1), { type: 1, label: 'POS 80 mm', widthDots: 576 })
  assert.deepEqual(printerPaper(2), { type: 2, label: 'POS 58 mm', widthDots: 384 })
  assert.equal(printerPaper(0), null)
  assert.equal(printerPaper(7), null)
})

test('splitPrinters: printable = BE printable + kho nhiet; con lai vao nhom khong ho tro kem ly do', () => {
  const { printable, unsupported } = splitPrinters({
    printers: [
      printer({ printerId: 1 }),
      printer({ printerId: 2, type: 0, printable: false }),
      printer({ printerId: 3, type: 2, hasIp: false, printable: false }),
      printer({ printerId: 4, type: 2, printable: false, hasIp: true }),
    ],
  })
  assert.deepEqual(printable.map((p) => p.printerId), [1])
  assert.deepEqual(unsupported.map((u) => u.printer.printerId), [2, 3, 4])
  assert.match(unsupported[0].reason, /không phải máy in nhiệt/i)
  assert.match(unsupported[1].reason, /IP/)
})

test('buildServiceTicketHtml: co ten mon, so luong, tong; escape HTML; phieu chua co phieu thu hien "Goi luc"', () => {
  const html = buildServiceTicketHtml({
    header: { ...header, userName: '<b>x</b>' },
    printerName: 'Bếp & Bar',
    type: 1,
    items: [
      { detailId: 1, serviceName: 'Mì <tôm>', quantity: 2, unit: 'tô', amount: 30_000 },
      { detailId: 2, serviceName: 'Trà', quantity: 1, unit: '', amount: 5_000 },
    ],
  })
  assert.ok(html.includes('PHIẾU DỊCH VỤ'))
  assert.ok(html.includes('Mì &lt;tôm&gt;'))
  assert.ok(html.includes('&lt;b&gt;x&lt;/b&gt;'))
  assert.ok(html.includes('Bếp &amp; Bar'))
  assert.equal(html.includes('<b>x</b>'), false)
  assert.ok(html.includes('2 tô'))
  assert.ok(html.includes('35.000'))
  assert.ok(html.includes('Gọi lúc: 08/10/2026 09:15'))
  assert.equal(html.includes('Phiếu:'), false)
})

test('buildServiceTicketHtml: da thu tien => "Thu luc" + so phieu; khach vang lai/quay duoc doi nhan', () => {
  const html = buildServiceTicketHtml({
    header: {
      ...header,
      hostName: 'KHACH_TAI_QUAY',
      userName: 'KHACHVANGLAI',
      voucherId: 321,
      paidDate: '2026-10-08',
      paidTime: '10:02:11',
    },
    printerName: 'Quầy',
    type: 2,
    items: printer().items,
  })
  assert.ok(html.includes('Thu lúc: 08/10/2026 10:02'))
  assert.ok(html.includes('#321'))
  assert.ok(html.includes('Khách vãng lai'))
  assert.ok(html.includes('Tại quầy'))
  assert.equal(html.includes('KHACHVANGLAI'), false)
})

test('nhan ten khach/may: KHACHVANGLAI, KHACH_TAI_QUAY, rong => nhan than thien', () => {
  assert.equal(ticketCustomerLabel({ userName: 'KHACHVANGLAI', hostName: '' }), 'Khách vãng lai')
  assert.equal(ticketCustomerLabel({ userName: '', hostName: '' }), 'Khách vãng lai')
  assert.equal(ticketCustomerLabel({ userName: 'an', hostName: '' }), 'an')
  assert.equal(ticketHostLabel({ hostName: 'KHACH_TAI_QUAY' }), 'Tại quầy')
  assert.equal(ticketHostLabel({ hostName: 'KHACHVANGLAI' }), 'Tại quầy')
  assert.equal(ticketHostLabel({ hostName: 'PC-01' }), 'PC-01')
})

test('ticketTotal / formatTicketDate / escapeHtml', () => {
  assert.equal(ticketTotal(printer().items), 30_000)
  assert.equal(ticketTotal([]), 0)
  assert.equal(formatTicketDate('2026-10-08'), '08/10/2026')
  assert.equal(formatTicketDate('khong ro'), 'khong ro')
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#039;&amp;&#039;&lt;/a&gt;')
})

test('describePrintFailure / jobStateOf: ConnectFailed, partiallySent, loi la', () => {
  const connect = describePrintFailure({ message: 'x', details: { result: 'ConnectFailed', partiallySent: false } })
  assert.match(connect.message, /Không kết nối được máy in/)
  assert.equal(connect.partiallySent, false)

  const partial = describePrintFailure({ message: 'Đứt kết nối', details: { result: 'SendFailed', partiallySent: true } })
  assert.equal(partial.partiallySent, true)
  assert.match(partial.message, /in một phần/)

  assert.deepEqual(describePrintFailure(null), { message: 'Không gửi được lệnh in.', partiallySent: false })
  assert.deepEqual(describePrintFailure(new Error('PRINTER_INACTIVE')), { message: 'PRINTER_INACTIVE', partiallySent: false })

  assert.deepEqual(jobStateOf({ status: 'fulfilled', value: undefined }), { status: 'done' })
  const failed = jobStateOf({ status: 'rejected', reason: new Error('lỗi') })
  assert.equal(failed.status, 'failed')
})
