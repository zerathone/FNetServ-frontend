// Dữ liệu GIẢ cho trang Đơn dịch vụ (/orders) — sửa thoải mái ở đây rồi xem kết quả trên UI.
//
// Bật mock (chỉ chạy `npm run dev`, không bao giờ vào bản build):
//   thêm vào `fnet-web/.env.development.local` (file *.local không commit) một dòng
//     VITE_ORDERS_MOCK=1
//   rồi khởi động lại `npm run dev`. Bỏ dòng đó (hoặc đặt 0) để quay về server thật.
//
// Giá trị của VITE_ORDERS_MOCK:
//   1       dữ liệu mẫu bên dưới (mặc định)
//   empty   không có đơn nào, thống kê bằng 0 — xem màn hình trống
//   error   mọi endpoint của trang này trả lỗi — xem trạng thái lỗi
//   slow    như 1 nhưng mỗi request trễ 1,5 giây
//
// Danh sách máy đang chạy (/workstations/runtime) có biến RIÊNG vì trang Máy trạm dùng chung đường dẫn đó:
//     VITE_WORKSTATIONS_MOCK=1   (cũng nhận empty | error | slow | icons)
//     icons = mỗi kiểu icon trạng thái máy một máy mẫu (xem khối "Kịch bản icons" bên dưới)
// Không bật biến này thì trang Đơn dịch vụ vẫn chạy nhưng không biết trạng thái máy (nút không bị khóa theo
// máy, mất kịch bản PC-11). Bật thì trang Máy trạm cũng thấy 6 máy mẫu dưới đây.
//
// Cách hoạt động: api/client.ts hỏi file này TRƯỚC khi gọi server. Endpoint nào có trong `handlers` bên dưới
// thì trả dữ liệu giả; endpoint khác (vd tìm hội viên) vẫn đi ra server thật. Mọi thao tác Chấp nhận / Thanh
// toán / Cấn trừ / Hủy / Gọi món hộ chạy trong bộ nhớ trình duyệt: đơn nhảy qua lại giữa các tab, số liệu
// "Đơn hoàn thành" cập nhật theo. Tải lại trang (F5) là dữ liệu về lại như file này. Không ghi gì xuống server.
//
// Kịch bản có chủ ý để thử:
//   (Các mục về máy dưới đây chỉ có khi bật thêm VITE_WORKSTATIONS_MOCK.)
//   - PC-03 / PC-07 / PC-09: hội viên đang online → Chấp nhận, Thanh toán, Cấn trừ chạy được.
//   - PC-07: khách đã chọn tiền mặt tại máy (ServicePaid=4) → chỉ còn nút Thanh toán.
//   - PC-09: khách chọn cấn trừ (ServicePaid=5). Cấn trừ cho hội viên này (hoanglong, id 702) GHI PHIẾU nhưng
//     KHÔNG trừ được ví (code deduct_failed) → hiện banner "Thử trừ ví lại"; bấm thử lại thì thành công.
//   - PC-11: máy trống → nút xử lý bị khóa theo trạng thái máy.
//   - Hội viên có ví 180.000 đ: cấn trừ lớn hơn số dư → dryRun báo deduct_limited.
//   - Phiếu 9100: khách đã trả QR, chờ xác nhận phục vụ.

import { ApiError } from './client'
import type {
  CompletedOrderStats,
  CompletedPaymentMethod,
  PendingComboOrder,
  PendingOrder,
  PrintTargetsResponse,
  StaffOrderResponse,
} from './orders'
import type { BoardMachine, BoardResponse, BookedSlot } from './onlineBooking'
import type { PayRequestDryRunResponse, PayRequestResponse } from './payment'
import type { ServiceItem } from './services'
import type { WorkstationRuntime, WorkstationsRuntimeSnapshot } from './workstations'

export type MockResult = { handled: false } | { handled: true; data: unknown }

const MIN = 60_000
const WALLET = 180_000
/** Hội viên này cấn trừ lần đầu sẽ "ghi phiếu nhưng chưa trừ ví" để thử banner. */
const DEDUCT_FAIL_USER = 702

const pad = (n: number) => String(n).padStart(2, '0')

/** Mốc tương đối: `ago(15)` = 15 phút trước, tách thành chuỗi ngày/giờ đúng dạng server. */
function ago(minutes: number): { date: string; time: string } {
  const d = new Date(Date.now() - minutes * MIN)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`,
  }
}

// ---------------------------------------------------------------------------------------------
// Danh mục món + máy trạm
// ---------------------------------------------------------------------------------------------

const SERVICES: ServiceItem[] = [
  { id: 1, name: 'Mì tôm trứng', price: 20_000, unit: 'tô', inventory: 40, inventoryManagement: 1, active: 1, groupId: 1, groupName: 'Đồ ăn' },
  { id: 2, name: 'Thêm xúc xích', price: 5_000, unit: 'cái', inventory: 60, inventoryManagement: 1, active: 1, groupId: 1, groupName: 'Đồ ăn' },
  { id: 3, name: 'Cơm sườn', price: 45_000, unit: 'phần', inventory: 12, inventoryManagement: 1, active: 1, groupId: 1, groupName: 'Đồ ăn' },
  { id: 4, name: 'Bánh mì', price: 15_000, unit: 'ổ', inventory: 25, inventoryManagement: 1, active: 1, groupId: 1, groupName: 'Đồ ăn' },
  { id: 5, name: 'Nước suối', price: 10_000, unit: 'chai', inventory: 80, inventoryManagement: 1, active: 1, groupId: 2, groupName: 'Đồ uống' },
  { id: 6, name: 'Cà phê sữa', price: 25_000, unit: 'ly', inventory: 0, inventoryManagement: 0, active: 1, groupId: 2, groupName: 'Đồ uống' },
  { id: 7, name: 'Bò húc', price: 20_000, unit: 'lon', inventory: 3, inventoryManagement: 1, active: 1, groupId: 2, groupName: 'Đồ uống' },
  { id: 8, name: 'Snack khoai tây', price: 12_000, unit: 'gói', inventory: 30, inventoryManagement: 1, active: 1, groupId: 3, groupName: 'Ăn vặt' },
]

export function station(
  hostName: string,
  status: number,
  who: { userId: number; userName: string | null; userGroupType: number },
  index: number,
): WorkstationRuntime {
  const online = status === 3
  return {
    hostName,
    ip: `192.168.1.${20 + index}`,
    status,
    flagMask: 0,
    version: '2.1.5',
    verNew: false,
    machineGroupId: 1,
    machineGroupName: 'Thường',
    ...who,
    note: null,
    lockLogin: false,
    session: online
      ? {
          sessionId: 8000 + index,
          loginType: 0,
          prepaid: false,
          startedAt: null,
          usedSeconds: 40 * 60,
          remainingSeconds: null,
          totalAmount: null,
          remainingMoney: who.userGroupType === 2 ? WALLET : null,
          comboName: null,
          anonymId: null,
        }
      : null,
    winLicense: null,
    updatedAtMs: Date.now(),
  }
}

export function workstations(): WorkstationsRuntimeSnapshot {
  return {
    serverTimeMs: Date.now(),
    items: [
      station('PC-02', 3, { userId: 9001, userName: null, userGroupType: 1 }, 2),
      station('PC-03', 3, { userId: 508, userName: 'quocdat', userGroupType: 2 }, 3),
      station('PC-07', 3, { userId: 611, userName: 'minhthu', userGroupType: 2 }, 7),
      station('PC-09', 3, { userId: 702, userName: 'hoanglong', userGroupType: 2 }, 9),
      station('PC-11', 1, { userId: 0, userName: null, userGroupType: 0 }, 11),
      station('VIP-04', 3, { userId: 9100, userName: 'ob-dm4vip9', userGroupType: 5 }, 4),
    ],
  }
}

// ---------------------------------------------------------------------------------------------
// Dữ liệu đơn (nằm trong bộ nhớ, đổi theo thao tác)
// ---------------------------------------------------------------------------------------------

let nextDetailId = 6000
let nextVoucherId = 9400
let cancelledCount = 2

let pending: PendingOrder[] = []
let accepted: PendingOrder[] = []
let completed: PendingOrder[] = []
let combos: PendingComboOrder[] = []

type Base = Pick<PendingOrder, 'userId' | 'userName' | 'hostName'>

function order(
  id: number,
  who: Base,
  serviceName: string,
  quantity: number,
  price: number,
  minutesAgo: number,
  extra: Partial<PendingOrder> = {},
): PendingOrder {
  const at = ago(minutesAgo)
  return {
    serviceDetailId: id,
    ...who,
    serviceName,
    quantity,
    price,
    amount: quantity * price,
    servicePaid: 0,
    serviceDate: at.date,
    serviceTime: at.time,
    parentId: null,
    topping: null,
    unit: 'phần',
    voucherId: 0,
    serviceAmount: quantity * price,
    unitPrice: price,
    ...extra,
  }
}

function paid(line: PendingOrder, method: CompletedPaymentMethod, minutesAgo: number): PendingOrder {
  const at = ago(minutesAgo)
  return { ...line, servicePaid: 1, paymentMethod: method, paidDate: at.date, paidTime: at.time }
}

function seed() {
  nextDetailId = 6000
  nextVoucherId = 9400
  cancelledCount = 2

  const quocdat: Base = { userId: 508, userName: 'quocdat', hostName: 'PC-03' }
  const minhthu: Base = { userId: 611, userName: 'minhthu', hostName: 'PC-07' }
  const hoanglong: Base = { userId: 702, userName: 'hoanglong', hostName: 'PC-09' }
  const thanhtam: Base = { userId: 640, userName: 'thanhtam', hostName: 'PC-11' }
  const quay: Base = { userId: 0, userName: '', hostName: 'PC-02' }

  pending = [
    order(5001, quocdat, 'Mì tôm trứng', 1, 20_000, 6, { unit: 'tô' }),
    order(5002, quocdat, 'Thêm xúc xích', 1, 5_000, 6, { unit: 'cái', parentId: 5001, topping: 1 }),
    order(5003, minhthu, 'Nước suối', 2, 10_000, 4, { unit: 'chai', servicePaid: 4 }),
    order(5004, hoanglong, 'Cà phê sữa', 1, 25_000, 9, { unit: 'ly', servicePaid: 5 }),
    order(5007, thanhtam, 'Bánh mì', 1, 15_000, 12, { unit: 'ổ' }),
    order(5008, quay, 'Snack khoai tây', 1, 12_000, 2, { unit: 'gói' }),
    // Phiếu 9100: khách đã trả QR, chờ xác nhận phục vụ.
    order(5005, quocdat, 'Cơm sườn', 1, 45_000, 15, { voucherId: 9100, servicePaid: 1 }),
    order(5006, quocdat, 'Nước suối', 2, 5_000, 15, { voucherId: 9100, servicePaid: 1, unit: 'chai' }),
  ]

  accepted = [
    order(5101, quocdat, 'Bò húc', 1, 20_000, 35, { voucherId: 9201, unit: 'lon' }),
    order(5102, minhthu, 'Snack khoai tây', 1, 12_000, 28, { voucherId: 9202, servicePaid: 4, unit: 'gói' }),
    order(5103, hoanglong, 'Bò húc', 1, 20_000, 22, { voucherId: 9203, servicePaid: 5, unit: 'lon' }),
  ]

  completed = [
    paid(order(5201, quocdat, 'Mì tôm trứng', 2, 20_000, 120, { voucherId: 9301, unit: 'tô' }), 'cash', 110),
    paid(order(5202, minhthu, 'Cơm sườn', 1, 45_000, 95, { voucherId: 9302 }), 'qr', 90),
    paid(order(5203, hoanglong, 'Cà phê sữa', 2, 25_000, 80, { voucherId: 9303, unit: 'ly' }), 'deduct', 75),
    paid(order(5204, quay, 'Nước suối', 3, 10_000, 60, { voucherId: 9304, unit: 'chai' }), 'cash', 58),
    paid(order(5205, thanhtam, 'Bánh mì', 2, 15_000, 45, { voucherId: 9305, unit: 'ổ' }), 'online', 40),
    paid(order(5206, minhthu, 'Bò húc', 1, 20_000, 30, { voucherId: 9306, unit: 'lon' }), 'transfer', 25),
  ]

  combos = [
    comboOrder(7001, 'Combo 5 giờ đêm', 60_000, 'hoanglong', 702, 'PC-09', 8),
    comboOrder(7002, 'Combo 3 giờ chiều', 40_000, 'minhthu', 611, 'PC-07', 3),
  ]
}

function comboOrder(
  comboCardId: number,
  comboName: string,
  price: number,
  userName: string,
  userId: number,
  hostName: string,
  minutesAgo: number,
): PendingComboOrder {
  const at = ago(minutesAgo)
  const expire = ago(-60)
  return {
    comboCardId,
    comboId: comboCardId - 6900,
    comboName,
    price,
    ownerId: userId,
    ownerName: userName,
    comboUserId: userId,
    comboUserName: userName,
    hostName,
    createdAt: `${at.date} ${at.time}`,
    expireDate: `${expire.date} ${expire.time}`,
    paymentMethod: 'cash',
    accept: 0,
    zone: 'Khu thường',
  }
}

seed()

// ---------------------------------------------------------------------------------------------
// Chuyển trạng thái đơn
// ---------------------------------------------------------------------------------------------

const lineTotal = (line: PendingOrder) => line.serviceAmount ?? line.amount

/** Đổi số lượng theo payload (BE tính lại = SL x đơn giá), giữ nguyên nếu không đổi. */
function withQuantity(line: PendingOrder, quantity: number | undefined): PendingOrder {
  if (!quantity || quantity === line.quantity) return line
  const unit = line.unitPrice ?? line.price
  return { ...line, quantity, amount: quantity * unit, serviceAmount: quantity * unit }
}

function takeById(list: PendingOrder[], ids: number[]): { taken: PendingOrder[]; rest: PendingOrder[] } {
  const wanted = new Set(ids)
  return { taken: list.filter((l) => wanted.has(l.serviceDetailId)), rest: list.filter((l) => !wanted.has(l.serviceDetailId)) }
}

function settle(lines: PendingOrder[], method: CompletedPaymentMethod, voucherId: number): number {
  const at = ago(0)
  const settled = lines.map<PendingOrder>((l) => ({
    ...l,
    voucherId,
    servicePaid: 1,
    paymentMethod: method,
    paidDate: at.date,
    paidTime: at.time,
  }))
  completed = [...settled, ...completed]
  return lines.reduce((sum, l) => sum + lineTotal(l), 0)
}

// idem đã xử lý: gọi lại cùng idem trả `duplicated`, riêng ca "ghi phiếu chưa trừ ví" thì thử lại được.
const seenPayments = new Map<string, PayRequestResponse>()
const failedDeducts = new Map<string, { paymentId: number; total: number }>()

function finishPayment(
  idem: string,
  lines: PendingOrder[],
  method: 'cash' | 'deduct',
  voucherId: number,
): PayRequestResponse {
  const retry = failedDeducts.get(idem)
  if (retry) {
    failedDeducts.delete(idem)
    const response: PayRequestResponse = {
      paymentId: retry.paymentId,
      paid: 0,
      fullCore: true,
      total: retry.total,
      amount: retry.total,
      retried: true,
      deductApplied: true,
    }
    seenPayments.set(idem, response)
    return response
  }
  const previous = seenPayments.get(idem)
  if (previous) return { ...previous, duplicated: true }

  const total = settle(lines, method === 'deduct' ? 'deduct' : 'cash', voucherId)
  let response: PayRequestResponse
  if (method === 'deduct' && lines.some((l) => l.userId === DEDUCT_FAIL_USER)) {
    failedDeducts.set(idem, { paymentId: voucherId, total })
    response = {
      paymentId: voucherId,
      paid: lines.length,
      fullCore: true,
      total,
      amount: total,
      deductApplied: false,
      needsManualFix: true,
      code: 'deduct_failed',
      step: 'wallet',
    }
  } else if (method === 'deduct') {
    response = { paymentId: voucherId, paid: lines.length, fullCore: true, total, amount: total, deductApplied: true }
  } else {
    response = { paymentId: voucherId, paid: lines.length, fullCore: true, total }
  }
  seenPayments.set(idem, response)
  return response
}

function dryRun(lines: PendingOrder[], method: string, total: number): PayRequestDryRunResponse {
  if (lines.length === 0) {
    return { ok: false, dryRun: true, code: 'invalid_lines', message: 'Đơn đã được xử lý trước đó.', total: 0 }
  }
  if (method !== 'deduct') return { ok: true, dryRun: true, total }
  const head = lines[0]
  if (total > WALLET) {
    return {
      ok: false,
      dryRun: true,
      code: 'deduct_limited',
      message: 'Số dư ví không đủ để cấn trừ.',
      total,
      walletMain: WALLET,
      debit: total,
      minBalance: 0,
      memberName: head.userName,
    }
  }
  return { ok: true, dryRun: true, total, walletMain: WALLET, debit: total, minBalance: 0, memberName: head.userName }
}

// ---------------------------------------------------------------------------------------------
// Đọc body request (đã qua JSON.stringify ở apiPost nên là object thuần)
// ---------------------------------------------------------------------------------------------

type Body = Record<string, unknown>
const asBody = (body: unknown): Body => (body && typeof body === 'object' ? (body as Body) : {})
const asArray = (value: unknown): Body[] => (Array.isArray(value) ? (value as Body[]) : [])
const num = (value: unknown) => (typeof value === 'number' ? value : Number(value) || 0)
const str = (value: unknown) => (typeof value === 'string' ? value : '')

function stats(): CompletedOrderStats {
  const keys: CompletedPaymentMethod[] = ['cash', 'qr', 'deduct', 'online', 'transfer']
  const vouchers = new Map<number, { method: CompletedPaymentMethod | undefined; amount: number }>()
  for (const l of completed) {
    const current = vouchers.get(l.voucherId ?? 0) ?? { method: l.paymentMethod, amount: 0 }
    current.amount += lineTotal(l)
    vouchers.set(l.voucherId ?? 0, current)
  }
  const byType = keys.map((key) => {
    const rows = [...vouchers.values()].filter((v) => v.method === key)
    return { key, count: rows.length, amount: rows.reduce((sum, v) => sum + v.amount, 0) }
  })
  const start = ago(24 * 60)
  return {
    date: ago(0).date,
    shiftStart: `${start.date} ${start.time}`,
    completed: {
      count: byType.reduce((sum, r) => sum + r.count, 0),
      amount: byType.reduce((sum, r) => sum + r.amount, 0),
      byType,
    },
    cancelled: { count: cancelledCount },
  }
}

function emptyStats(): CompletedOrderStats {
  const keys: CompletedPaymentMethod[] = ['cash', 'qr', 'deduct', 'online', 'transfer']
  return {
    date: ago(0).date,
    shiftStart: `${ago(24 * 60).date} ${ago(24 * 60).time}`,
    completed: { count: 0, amount: 0, byType: keys.map((key) => ({ key, count: 0, amount: 0 })) },
    cancelled: { count: 0 },
  }
}

// ---------------------------------------------------------------------------------------------
// Bảng route: "METHOD /path" -> hàm trả dữ liệu
// ---------------------------------------------------------------------------------------------

type Handler = (body: Body, query: URLSearchParams, mode: string) => unknown

const handlers: Record<string, Handler> = {
  'GET /orders/pending': (_b, q, mode) => {
    if (mode === 'empty') return []
    const includePaid = q.get('includePaid') === '1'
    return pending.filter((l) => includePaid || l.servicePaid !== 1)
  },
  'GET /orders/accepted-unpaid': (_b, q, mode) => {
    if (mode === 'empty') return []
    const userId = q.get('userId')
    return userId ? accepted.filter((l) => String(l.userId) === userId) : accepted
  },
  'GET /orders/accepted-unpaid/summary': (_b, _q, mode) => ({
    count: mode === 'empty' ? 0 : new Set(accepted.map((l) => l.voucherId)).size,
    amount: mode === 'empty' ? 0 : accepted.reduce((sum, l) => sum + lineTotal(l), 0),
  }),
  'GET /orders/completed-today': (_b, _q, mode) => (mode === 'empty' ? [] : completed),
  'GET /orders/completed/stats': (_b, _q, mode) => (mode === 'empty' ? emptyStats() : stats()),
  'GET /orders/pending/combo': (_b, _q, mode) => ({ windowHours: 24, items: mode === 'empty' ? [] : combos }),
  'GET /services': () => SERVICES,

  'POST /service/accept': (body) => {
    const items = asArray(body.items)
    const ids = items.map((i) => num(i.detailId))
    const { taken, rest } = takeById(pending, ids)
    if (taken.length === 0) return { accepted: 0 }
    pending = rest
    const voucherId = taken.find((l) => l.voucherId)?.voucherId || nextVoucherId++
    const alreadyPaid = items.some((i) => i.alreadyPaid === true)
    const lines = taken.map((l) => withQuantity(l, num(items.find((i) => num(i.detailId) === l.serviceDetailId)?.quantity)))
    let amount: number
    if (alreadyPaid) {
      amount = settle(lines, 'qr', voucherId)
    } else {
      accepted = [...accepted, ...lines.map((l) => ({ ...l, voucherId }))]
      amount = lines.reduce((sum, l) => sum + lineTotal(l), 0)
    }
    const low = lines.find((l) => l.serviceName === 'Bò húc')
    return {
      accepted: taken.length,
      paymentId: voucherId,
      amount,
      inventoryWarnings: low ? [{ serviceId: 7, serviceName: low.serviceName, inventory: 2 }] : [],
    }
  },

  'POST /service/cancel': (body) => {
    let cancelled = 0
    for (const item of asArray(body.items)) {
      const id = num(item.id)
      if (str(item.type) === 'combo') {
        const before = combos.length
        combos = combos.filter((c) => c.comboCardId !== id)
        cancelled += before - combos.length
      } else {
        const before = pending.length
        pending = pending.filter((l) => l.serviceDetailId !== id)
        cancelled += before - pending.length
      }
    }
    cancelledCount += cancelled
    return { cancelled }
  },

  'POST /service/payrequest': (body) => {
    const items = asArray(body.items)
    const method = str(body.paymentMethod)
    const { taken, rest } = takeById(pending, items.map((i) => num(i.detailId)))
    const lines = taken.map((l) => withQuantity(l, num(items.find((i) => num(i.detailId) === l.serviceDetailId)?.quantity)))
    const total = lines.reduce((sum, l) => sum + lineTotal(l), 0)
    if (body.dryRun === true) return dryRun(lines, method, total)
    if (lines.length === 0) return { paid: 0, fullCore: true, total: 0 } satisfies PayRequestResponse
    pending = rest
    return finishPayment(str(body.idem), lines, method === 'deduct' ? 'deduct' : 'cash', nextVoucherId++)
  },

  'POST /service/pay': (body) => {
    const vouchers = asArray(body.vouchers)
    const ids = vouchers.flatMap((v) => (Array.isArray(v.detailIds) ? (v.detailIds as number[]) : []))
    const { taken, rest } = takeById(accepted, ids)
    const method = str(body.paymentMethod)
    const total = taken.reduce((sum, l) => sum + lineTotal(l), 0)
    if (body.dryRun === true) return dryRun(taken, method, total)
    if (taken.length === 0) return { paid: 0, fullCore: true, total: 0 }
    accepted = rest
    const voucherId = taken[0].voucherId || nextVoucherId++
    return { ...finishPayment(str(body.idem), taken, method === 'deduct' ? 'deduct' : 'cash', voucherId), voucherId }
  },

  'POST /service/clearaccepted': (body) => {
    const results: Array<{ voucherId: number; cancelledAmount: number; remain: number; voucherDeleted: boolean }> = []
    let processed = 0
    for (const v of asArray(body.vouchers)) {
      const ids = Array.isArray(v.detailIds) ? (v.detailIds as number[]) : []
      const { taken, rest } = takeById(accepted, ids)
      if (taken.length === 0) continue
      accepted = rest
      processed += taken.length
      cancelledCount += taken.length
      const voucherId = num(v.voucherId)
      const remain = accepted.filter((l) => l.voucherId === voucherId).reduce((sum, l) => sum + lineTotal(l), 0)
      results.push({
        voucherId,
        cancelledAmount: taken.reduce((sum, l) => sum + lineTotal(l), 0),
        remain,
        voucherDeleted: remain === 0,
      })
    }
    return { processed, results }
  },

  'POST /orders/combo/accept': (body) => {
    const comboCardId = num(body.comboCardId)
    const found = combos.some((c) => c.comboCardId === comboCardId)
    combos = combos.filter((c) => c.comboCardId !== comboCardId)
    return { comboCardId, paymentId: nextVoucherId++, accepted: found, duplicated: !found, applied: found }
  },
  'POST /orders/combo/reject': (body) => {
    const comboCardId = num(body.comboCardId)
    const found = combos.some((c) => c.comboCardId === comboCardId)
    combos = combos.filter((c) => c.comboCardId !== comboCardId)
    return { comboCardId, rejected: found, duplicated: !found }
  },

  'POST /service/staff-order': (body): StaffOrderResponse => {
    const anonymous = body.anonymous === true
    const userId = anonymous ? 0 : num(body.userId)
    const hostName = anonymous ? 'KHACH_TAI_QUAY' : str(body.hostName)
    const member = workstations().items.find((m) => m.userId === userId)
    const who: Base = { userId, userName: anonymous ? '' : (member?.userName ?? `user${userId}`), hostName }
    const lines = asArray(body.items).flatMap((item) => {
      const service = SERVICES.find((s) => s.id === num(item.serviceId))
      if (!service) return []
      return [order(nextDetailId++, who, service.name, num(item.quantity) || 1, service.price, 0, { unit: service.unit })]
    })
    pending = [...pending, ...lines]
    return {
      userId,
      hostName,
      anonymous,
      items: lines.map((l) => ({ detailId: l.serviceDetailId, serviceId: 0, quantity: l.quantity, amount: l.amount })),
      amount: lines.reduce((sum, l) => sum + l.amount, 0),
      inventoryWarnings: [],
    }
  },

  // Không có máy in trong mock: dialog in phiếu hiện "chưa có máy in".
  'POST /orders/print-targets': (): PrintTargetsResponse => ({
    header: {
      hostName: '',
      userId: 0,
      userName: '',
      voucherId: 0,
      staffId: 0,
      staffName: '',
      paidDate: '',
      paidTime: '',
      orderDate: '',
      orderTime: '',
    },
    printers: [],
    unrouted: [],
    notFound: [],
  }),
}

// ---------------------------------------------------------------------------------------------
// Kịch bản `VITE_WORKSTATIONS_MOCK=icons`: một máy cho MỖI kiểu icon trên trang Máy trạm (task ws-status-icons).
//   AV-*  sẵn sàng (AV-DEBT còn nợ, AV-RES có đặt chỗ sắp tới, AV-LATE khách đặt chỗ đến trễ)
//   MB-*  hội viên | GU-PRE vãng lai trả trước | GU-POST vãng lai trả sau | CB-01 combo | ADMIN-01 admin
//   OFF-* tắt từ trước (OFF-DEBT còn nợ) | TURNOFF-01 đang bật, tự TẮT sau 20 giây ⇒ thử viền đỏ "vừa tắt"
//   WARN-01 cảnh báo | UPG-01 sẵn sàng + client quá cũ | UPG-OFF tắt + client quá cũ
// Đặt chỗ lấy từ GET /onlinebook/board (cũng mock ở đây, chỉ khi mode = icons).
// ---------------------------------------------------------------------------------------------
const iconDemoStartedAt = Date.now()
const HAVE_NOT_PAID_FLAG = 0x00000008

function workstationsIconDemo(): WorkstationsRuntimeSnapshot {
  const guest = { userId: 9001, userName: null, userGroupType: 1 }
  const member = { userId: 508, userName: 'quocdat', userGroupType: 2 }
  const none = { userId: 0, userName: null, userGroupType: 0 }
  const withSession = (machine: WorkstationRuntime, prepaid: boolean): WorkstationRuntime => ({
    ...machine,
    session: machine.session ? { ...machine.session, prepaid } : machine.session,
  })
  const flagged = (machine: WorkstationRuntime, flagMask: number): WorkstationRuntime => ({ ...machine, flagMask })
  const old = (machine: WorkstationRuntime): WorkstationRuntime => ({ ...machine, version: '1.9.0', minVerExpired: true })
  const turnedOff = Date.now() - iconDemoStartedAt > 20_000

  return {
    serverTimeMs: Date.now(),
    items: [
      station('AV-01', 1, none, 1),
      flagged(station('AV-DEBT', 1, none, 2), HAVE_NOT_PAID_FLAG),
      station('AV-RES', 1, none, 3),
      station('AV-LATE', 1, none, 4),
      station('MB-01', 3, member, 5),
      flagged(station('MB-DEBT', 3, { ...member, userId: 509 }, 6), HAVE_NOT_PAID_FLAG),
      withSession(station('GU-PRE', 3, guest, 7), true),
      withSession(station('GU-POST', 3, { ...guest, userId: 9002 }, 8), false),
      station('CB-01', 3, { userId: 9100, userName: 'ob-dm4vip9', userGroupType: 5 }, 9),
      station('ADMIN-01', 3, none, 10),
      station('OFF-01', 2, none, 11),
      flagged(station('OFF-DEBT', 2, none, 12), HAVE_NOT_PAID_FLAG),
      station('TURNOFF-01', turnedOff ? 2 : 3, turnedOff ? none : { ...member, userId: 510 }, 13),
      station('WARN-01', 4, member, 14),
      old(station('UPG-01', 1, none, 15)),
      old(station('UPG-OFF', 2, none, 16)),
      ...Array.from({ length: 12 }, (_v, i) => station(`PC-${String(i + 20)}`, i % 3 === 0 ? 2 : 1, none, 20 + i)),
    ],
  }
}

function iconDemoBoard(): BoardResponse {
  const nowMs = Date.now()
  const iso = (offsetMin: number) => new Date(nowMs + offsetMin * MIN).toISOString()
  const slot = (fromMin: number, lenMin: number): BookedSlot => ({
    from: iso(fromMin),
    to: iso(fromMin + lenMin),
    source: 'online',
    state: 'confirmed',
  })
  const machine = (pc: string, bookedSlots: BookedSlot[]): BoardMachine => ({
    pc,
    machineGroupId: 1,
    machineGroup: 'Thường',
    pcState: 'on_idle',
    bookedSlots,
    bookableNow: null,
    available: false,
    prices: [],
  })
  return {
    serverTime: iso(0),
    enabled: true,
    fee: 0,
    maxHours: 5,
    minHours: 1,
    minLeadMin: 15,
    maxAheadMin: 4320,
    requireOffWithinMin: 0,
    lateHoldMin: 15,
    lockWindowMin: 180,
    slotBufferMin: 0,
    horizon: { from: iso(0), to: iso(360) },
    machines: [machine('AV-RES', [slot(60, 120)]), machine('AV-LATE', [slot(-5, 120)])],
  }
}

// Danh sách máy: bật riêng bằng VITE_WORKSTATIONS_MOCK để không lẫn dữ liệu giả vào trang Máy trạm
// (trang đó dùng chung đường dẫn này).
const workstationHandlers: Record<string, Handler> = {
  'GET /workstations/runtime': (_b, _q, mode) =>
    mode === 'empty'
      ? { serverTimeMs: Date.now(), items: [] }
      : mode === 'icons'
        ? workstationsIconDemo()
        : workstations(),
}

// Endpoint chỉ mock ở kịch bản `icons` — các mode khác để đi ra server thật / mock riêng của trang đó.
const iconModeHandlers: Record<string, Handler> = {
  'GET /onlinebook/board': () => iconDemoBoard(),
}

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

export type MockModes = { orders?: string; workstations?: string }

/** Gọi từ api/client.ts. `handled:false` = endpoint không thuộc mock, client tự gọi server thật. */
export async function mockOrdersRequest(
  modes: MockModes,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<MockResult> {
  const url = new URL(path, 'http://mock.local')
  const key = `${method} ${url.pathname}`
  const ordersHandler = modes.orders ? handlers[key] : undefined
  const stationHandler = modes.workstations
    ? (workstationHandlers[key] ?? (modes.workstations === 'icons' ? iconModeHandlers[key] : undefined))
    : undefined
  const handler = ordersHandler ?? stationHandler
  const mode = ordersHandler ? modes.orders : modes.workstations
  if (!handler || !mode) return { handled: false }
  await delay(mode === 'slow' ? 1500 : 150)
  if (mode === 'error') {
    throw new ApiError('Mock: server trả lỗi', { httpStatus: 500 })
  }
  return { handled: true, data: handler(asBody(body), url.searchParams, mode) }
}
