// Dữ liệu GIẢ cho giao diện "Ca làm việc" — chạy khi server CHƯA có route /shift/* (S1 chưa merge).
//
// Bật mock (chỉ `npm run dev`, không bao giờ vào bản build): thêm vào `fnet-web/.env.development.local`
//   VITE_SHIFT_MOCK=open
// rồi khởi động lại `npm run dev`. Bỏ dòng đó (hoặc đặt 0) để quay về server thật.
//
// Giá trị của VITE_SHIFT_MOCK:
//   off      INT_SHIFT_MODE = 0: /shift/current trả {enabled:false} -> web phải y hệt trước (không dialog, không widget)
//   none     chưa có ca (mode 2): hiện Dialog Mở ca, gợi ý tiền đầu ca từ lastClosed; mở xong thành `open`
//   open     đang có ca, số liệu mẫu; chốt thành công (không cảnh báo)
//   pending  đang có ca; /shift/close trả SHIFT_PENDING_ORDERS (khoá nút chốt + hiện số đơn chờ)
//   warn     đang có ca; chốt thành công nhưng kèm `warnings` (còn ca khác đang mở)
//   error    đang có ca; /shift/summary và /shift/close trả lỗi máy chủ
//
// Trạng thái ca lưu trong bộ nhớ trang (F5 là về lại như ban đầu). Để thấy số đơn chờ ở Dialog Chốt ca cũng nên
// bật VITE_ORDERS_MOCK=1 (cảnh báo đọc /orders/pending, /orders/pending/combo của mock đó).
//
// Hình dạng dữ liệu mock = hợp đồng S1 mục 4.3–4.5 (GIẢ ĐỊNH ở chỗ hợp đồng mơ hồ — xem handoff S2 "Kết quả thực hiện").
import { ApiError } from '../../api/client'

type Json = Record<string, unknown>

type MockShift = {
  shiftId: number
  staffId: number
  staffName: string
  status: number
  openTime: string
  openingCash: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

// Nguồn đúng thứ tự server: nạp hội viên, khách vãng lai, combo, thẻ nạp, dịch vụ, công nợ.
const SOURCES = [
  { key: 'member', name: 'Nạp hội viên', count: 24, cash: 1_850_000, online: 400_000, qr: 1_200_000, deduct: 0 },
  { key: 'guest', name: 'Khách vãng lai', count: 9, cash: 380_000, online: 0, qr: 120_000, deduct: 0 },
  { key: 'combo', name: 'Combo', count: 7, cash: 210_000, online: 150_000, qr: 300_000, deduct: 90_000 },
  { key: 'card', name: 'Thẻ nạp tiền', count: 3, cash: 150_000, online: 0, qr: 50_000, deduct: 0 },
  { key: 'service', name: 'Dịch vụ', count: 31, cash: 520_000, online: 60_000, qr: 340_000, deduct: 180_000 },
  { key: 'debt', name: 'Công nợ (trả nợ)', count: 1, cash: 100_000, online: 0, qr: 0, deduct: 0 },
]

let current: MockShift | null = null
let seeded = ''
let closedResult: Json | null = null

function ensureSeed(mode: string) {
  if (seeded === mode) return
  seeded = mode
  closedResult = null
  current =
    mode === 'none' || mode === 'off'
      ? null
      : {
          shiftId: 128,
          staffId: 7,
          staffName: 'Nguyễn Thu Ngân',
          status: 1,
          openTime: stamp(new Date(Date.now() - 3.5 * 3600_000)),
          openingCash: 500_000,
        }
}

function summaryFor(shift: MockShift): Json {
  const sources = SOURCES.map((s) => ({ ...s, total: s.cash + s.online + s.qr }))
  const sum = (key: 'count' | 'cash' | 'online' | 'qr' | 'deduct') => sources.reduce((acc, s) => acc + s[key], 0)
  const refund = { count: 1, cash: -50_000, online: 0 }
  const cash = sum('cash')
  return {
    sources,
    refund,
    // Hoàn tiền đã nằm trong các nguồn (số âm) — mock giữ nguyên quy ước đó: không trừ thêm lần nữa.
    totals: { count: sum('count'), cash, online: sum('online'), qr: sum('qr'), deduct: sum('deduct'), total: cash + sum('online') + sum('qr') },
    expectedCash: shift.openingCash + cash,
  }
}

export async function mockShiftRequest(mode: string, path: string, body?: unknown): Promise<unknown> {
  ensureSeed(mode)
  await delay(250)
  const req = (body ?? {}) as Json

  if (path === '/shift/current') {
    if (mode === 'off') return { enabled: false, mode: 0 }
    return {
      enabled: true,
      mode: 2,
      serverTime: stamp(new Date()),
      shift: current,
      lastClosed: current
        ? null
        : {
            shiftId: 127,
            staffName: 'Trần Văn Ca Trước',
            closeTime: stamp(new Date(Date.now() - 9 * 3600_000)),
            countedCash: 1_200_000,
          },
    }
  }

  if (mode === 'off') throw new ApiError('Tính năng ca chưa bật', { code: 'SHIFT_DISABLED' })

  if (path === '/shift/open') {
    const cash = typeof req.openingCash === 'number' ? req.openingCash : 0
    if (cash < 0 || cash > 10_000_000_000) {
      throw new ApiError('Tiền mặt đầu ca không hợp lệ', { code: 'INVALID_INPUT' })
    }
    if (current) return { ...current, resumed: true }
    closedResult = null
    current = {
      shiftId: 129,
      staffId: 7,
      staffName: 'Nguyễn Thu Ngân',
      status: 1,
      openTime: stamp(new Date()),
      openingCash: cash,
    }
    return { ...current, resumed: false }
  }

  if (path === '/shift/close' && closedResult && !current) return { ...closedResult, alreadyClosed: true }
  if (!current) throw new ApiError('Không có ca đang mở', { code: 'SHIFT_NOT_FOUND' })

  if (path === '/shift/summary') {
    if (mode === 'error') throw new ApiError('Mock: máy chủ lỗi khi tính tóm tắt ca')
    return summaryFor(current)
  }

  if (path === '/shift/close') {
    if (mode === 'error') throw new ApiError('Mock: máy chủ lỗi khi chốt ca')
    if (mode === 'pending') {
      throw new ApiError('Còn đơn chờ duyệt, chưa thể chốt ca', {
        code: 'SHIFT_PENDING_ORDERS',
        // Giống sendFail của server: data = {code, ...số lượng}.
        details: { code: 'SHIFT_PENDING_ORDERS', pendingService: 3, pendingCombo: 1, qrPaidUnconfirmed: { count: 1, amount: 55_000 } },
      })
    }
    const summary = summaryFor(current)
    const expected = summary.expectedCash as number
    const counted = typeof req.countedCash === 'number' ? req.countedCash : null
    const shift = {
      ...current,
      status: 2,
      closeTime: stamp(new Date()),
      countedCash: counted,
      expectedCash: expected,
      cashDiff: counted === null ? null : counted - expected,
      note: typeof req.note === 'string' ? req.note : '',
    }
    closedResult = {
      alreadyClosed: false,
      shift,
      summary,
      ...(mode === 'warn' ? { warnings: { pendingService: 2, pendingCombo: 0, qrPaidUnconfirmed: { count: 0, amount: 0 } } } : {}),
    }
    current = null
    return closedResult
  }

  throw new ApiError(`Mock: route ${path} chưa được mô phỏng`)
}
