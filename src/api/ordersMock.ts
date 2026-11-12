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
import type { MapDecorType, MapItem, MapLayout } from './workstationMapTypes.ts'
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

// Nhóm máy giả: 3 nhóm để xem chế độ Biểu tượng gom theo nhóm. Trả cho GET /machinegroup (xem workstationHandlers) và gán vào từng máy.
export const MOCK_MACHINE_GROUPS = [
  { id: 1, name: 'Thường' },
  { id: 2, name: 'VIP' },
  { id: 3, name: 'Phòng Game' },
] as const

export function station(
  hostName: string,
  status: number,
  who: { userId: number; userName: string | null; userGroupType: number },
  index: number,
  groupId: number = 1,
): WorkstationRuntime {
  const group = MOCK_MACHINE_GROUPS.find((g) => g.id === groupId) ?? MOCK_MACHINE_GROUPS[0]
  const online = status === 3
  return {
    hostName,
    ip: `192.168.1.${20 + index}`,
    status,
    flagMask: 0,
    version: '2.1.5',
    verNew: false,
    machineGroupId: group.id,
    machineGroupName: group.name,
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
      station('PC-09', 3, { userId: 702, userName: 'hoanglong', userGroupType: 2 }, 9, 3),
      station('PC-11', 1, { userId: 0, userName: null, userGroupType: 0 }, 11, 3),
      station('VIP-04', 3, { userId: 9100, userName: 'ob-dm4vip9', userGroupType: 5 }, 4, 2),
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
// Kịch bản `VITE_WORKSTATIONS_MOCK=icons` (task ws-status-icons): trang Máy trạm có MỌI tổ hợp icon để xem bằng mắt.
// Lưu ý: kịch bản này đứng TRƯỚC mock Theo dõi hoạt động (VITE_HEALTH_MONITOR_MOCK) cho đường /workstations/runtime —
// xem api/client.ts — nên để cả hai bật vẫn thấy máy ở đây.
//
//   SẴN SÀNG    AV-01 | AV-DEBT nợ | AV-RES vé xanh | AV-LATE vé đỏ + nợ | LOCK-01 "Giữ máy"
//   HỘI VIÊN    MB-01 | MB-DEBT nợ | MB-U18 dưới 18 | MB-U18-DEBT dưới 18 + nợ
//   TRẢ TRƯỚC   GU-PRE | GU-PRE-U18 vãng lai dưới 18 (phải có cờ — xem ghi chú cuối)
//   TRẢ SAU     GU-POST | GU-POST-U18 | GU-POST-RES vé xanh khi đang chơi
//   COMBO       CB-01 | CB-PRE (cả hai đăng nhập bằng THẺ COMBO ⇒ dùng màu "trả trước") | ONL-NOSESS online nhưng chưa có phiên (chân đế trống)
//   ADMIN       ADMIN-01
//   TẮT         OFF-01 | OFF-DEBT nợ | OFF-RES vé xanh | OFF-LATE vé đỏ | INIT-01 đang khởi tạo
//   VỪA TẮT     TURNOFF-01 / TURNOFF-DEBT / TURNOFF-UPG đang bật, TỰ TẮT sau 20 giây ⇒ viền đỏ (mở chi tiết = gỡ viền)
//               TURNBACK-01 tắt sau 20 giây rồi BẬT LẠI sau 60 giây ⇒ viền đỏ tự gỡ khi kết nối lại
//   CẢNH BÁO    WARN-01 | WARN-U18 (viền cam thắng viền vàng, vẫn có icon học sinh) | WARN-DEBT
//   NÂNG CẤP    UPG-01 sẵn sàng | UPG-MB hội viên | UPG-OFF tắt (tím phủ ghi đè mọi trạng thái)
//   HOẠT ĐỘNG   SV-ORDER gọi món | SV-ACCEPT nhận món chờ thu tiền + nợ | SV-PAUSE tạm dừng | SV-XFER đợi chuyển phí |
//               SV-CHANGE đang chuyển máy | SV-MULTI 7 cờ (chip gộp "+N"); LOCK-01 = giữ máy (chip khóa)
//               LEFT-DEBT (sẵn sàng) / OFF-SVCDEBT (tắt) = khách đã rời còn nợ dịch vụ ⇒ nút lọc "Nợ dịch vụ"
//               ⚠️ chip "nhận món" còn phụ thuộc useServiceAcceptCleared (đọc đơn dịch vụ) — có thể bị ẩn nếu đơn mock đã hết nợ.
// Muốn bắt đầu lại đồng hồ 20/60 giây: F5. Đặt chỗ lấy từ GET /onlinebook/board (cũng mock ở đây, chỉ khi mode = icons).
//
// ⚠️ Cờ dưới 18 (0x1) do SERVER bật từ ngày sinh của tài khoản đang chơi (WorkstationHandlers.cpp). `anonymoustb` của khách
// vãng lai KHÔNG có ngày sinh nên ngoài đời cờ này hiện chưa bao giờ bật cho vãng lai — các máy GU-*-U18 chỉ để xem hình.
// ---------------------------------------------------------------------------------------------
const iconDemoStartedAt = Date.now()
const WS_FLAG_UNDER18 = 0x00000001
const WS_FLAG_NOT_PAID = 0x00000008
const WS_FLAG_SERVICE_ORDER = 0x00000002
const WS_FLAG_SERVICE_ACCEPT = 0x00000004
const WS_FLAG_CLIENT_PAUSE = 0x00000010
const WS_FLAG_CHANGING_PC = 0x00000040
const WS_FLAG_TRANSFER_PAYMENT = 0x00000100

type Who = { userId: number; userName: string | null; userGroupType: number }

type IconDemoOptions = {
  prepaid?: boolean
  flags?: number
  /** Client dưới phiên bản bắt buộc (`minVerExpired`). */
  old?: boolean
  noSession?: boolean
  lockLogin?: boolean
}

// Chia máy mẫu thành 3 nhóm theo thứ tự tạo: 1-14 Thường (sẵn sàng / hội viên / vãng lai), 15-30 VIP (combo, admin, tắt, vừa tắt, cảnh báo),
// còn lại Phòng Game (nâng cấp + PC-20…31). Số máy mỗi nhóm khác nhau để thấy đủ kiểu tiêu đề nhóm.
function iconDemoGroupId(index: number): number {
  return index <= 14 ? 1 : index <= 30 ? 2 : 3
}

function workstationsIconDemo(): WorkstationsRuntimeSnapshot {
  const seconds = (Date.now() - iconDemoStartedAt) / 1000
  const turnedOff = seconds > 20
  const backOn = seconds > 60

  const guest: Who = { userId: 9001, userName: null, userGroupType: 1 }
  const member: Who = { userId: 508, userName: 'quocdat', userGroupType: 2 }
  const combo: Who = { userId: 9100, userName: 'ob-dm4vip9', userGroupType: 5 }
  const none: Who = { userId: 0, userName: null, userGroupType: 0 }

  let index = 0
  const make = (hostName: string, status: number, who: Who, options: IconDemoOptions = {}): WorkstationRuntime => {
    index += 1
    const base = station(hostName, status, who, index, iconDemoGroupId(index))
    return {
      ...base,
      flagMask: options.flags ?? 0,
      lockLogin: Boolean(options.lockLogin),
      session: options.noSession || !base.session ? null : { ...base.session, prepaid: Boolean(options.prepaid) },
      ...(options.old ? { version: '1.9.0', minVerExpired: true } : {}),
    }
  }
  // Người chơi (user #) khác nhau cho từng máy hội viên/vãng lai để không trùng khóa khi gộp theo tài khoản.
  const person = (base: Who, extra: number): Who => ({ ...base, userId: base.userId + extra })

  return {
    serverTimeMs: Date.now(),
    items: [
      // --- sẵn sàng ---
      make('AV-01', 1, none),
      make('AV-DEBT', 1, none, { flags: WS_FLAG_NOT_PAID }),
      make('AV-RES', 1, none),
      make('AV-LATE', 1, none, { flags: WS_FLAG_NOT_PAID }),
      make('LOCK-01', 1, none, { lockLogin: true }),
      // --- hội viên ---
      make('MB-01', 3, member),
      make('MB-DEBT', 3, person(member, 1), { flags: WS_FLAG_NOT_PAID }),
      make('MB-U18', 3, person(member, 2), { flags: WS_FLAG_UNDER18 }),
      make('MB-U18-DEBT', 3, person(member, 3), { flags: WS_FLAG_UNDER18 | WS_FLAG_NOT_PAID }),
      // --- vãng lai ---
      make('GU-PRE', 3, guest, { prepaid: true }),
      make('GU-PRE-U18', 3, person(guest, 1), { prepaid: true, flags: WS_FLAG_UNDER18 }),
      make('GU-POST', 3, person(guest, 2)),
      make('GU-POST-U18', 3, person(guest, 3), { flags: WS_FLAG_UNDER18 }),
      make('GU-POST-RES', 3, person(guest, 4)),
      // --- combo / online chưa có phiên / admin ---
      make('CB-01', 3, combo),
      make('CB-PRE', 3, person(combo, 1), { prepaid: true }),
      make('ONL-NOSESS', 3, person(guest, 5), { noSession: true }),
      make('ADMIN-01', 3, none),
      // --- tắt từ trước ---
      make('OFF-01', 2, none),
      make('OFF-DEBT', 2, none, { flags: WS_FLAG_NOT_PAID }),
      make('OFF-RES', 2, none),
      make('OFF-LATE', 2, none),
      make('INIT-01', 0, none),
      // --- vừa tắt trong phiên xem (đổi trạng thái theo đồng hồ) ---
      make('TURNOFF-01', turnedOff ? 2 : 3, turnedOff ? none : person(member, 4)),
      make('TURNOFF-DEBT', turnedOff ? 2 : 3, turnedOff ? none : person(member, 5), { flags: WS_FLAG_NOT_PAID }),
      make('TURNOFF-UPG', turnedOff ? 2 : 3, turnedOff ? none : person(member, 6), { old: true }),
      make('TURNBACK-01', turnedOff && !backOn ? 2 : 3, turnedOff && !backOn ? none : person(member, 7)),
      // --- cảnh báo ---
      make('WARN-01', 4, person(member, 8)),
      make('WARN-U18', 4, person(member, 9), { flags: WS_FLAG_UNDER18 }),
      make('WARN-DEBT', 4, person(member, 10), { flags: WS_FLAG_NOT_PAID }),
      // --- client quá phiên bản bắt buộc ---
      make('UPG-01', 1, none, { old: true }),
      make('UPG-MB', 3, person(member, 11), { old: true }),
      make('UPG-OFF', 2, none, { old: true }),
      // --- hoạt động phụ (chip ở mép dưới ô): gọi món / nhận món chờ thu tiền / đợi chuyển phí / tạm dừng / chuyển máy ---
      make('SV-ORDER', 3, person(member, 12), { flags: WS_FLAG_SERVICE_ORDER }),
      make('SV-ACCEPT', 3, person(member, 13), { flags: WS_FLAG_SERVICE_ACCEPT | WS_FLAG_NOT_PAID }),
      make('SV-PAUSE', 3, person(guest, 6), { flags: WS_FLAG_CLIENT_PAUSE }),
      make('SV-XFER', 3, person(member, 14), { flags: WS_FLAG_TRANSFER_PAYMENT }),
      make('SV-CHANGE', 3, person(member, 15), { flags: WS_FLAG_CHANGING_PC }),
      // Khách ĐÃ RỜI máy mà còn nợ dịch vụ đã nhận (MFC rung chuông + thẻ service_debit): nút lọc "Nợ dịch vụ" đếm 2 máy này.
      make('LEFT-DEBT', 1, none, { flags: WS_FLAG_SERVICE_ACCEPT }),
      make('OFF-SVCDEBT', 2, none, { flags: WS_FLAG_SERVICE_ACCEPT }),
      // 7 cờ cùng lúc: thấy chip gộp "+N" khi quá 4 chip.
      make('SV-MULTI', 3, person(member, 16), {
        flags:
          WS_FLAG_SERVICE_ORDER | WS_FLAG_SERVICE_ACCEPT | WS_FLAG_TRANSFER_PAYMENT | WS_FLAG_CLIENT_PAUSE |
          WS_FLAG_CHANGING_PC | WS_FLAG_UNDER18 | WS_FLAG_NOT_PAID,
      }),
      ...Array.from({ length: 12 }, (_v, i) => make(`PC-${String(i + 20)}`, i % 3 === 0 ? 2 : 1, none)),
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
    machines: [
      machine('AV-RES', [slot(60, 120)]), // vé xanh: bắt đầu sau 60 phút (< lockWindowMin)
      machine('AV-LATE', [slot(-5, 120)]), // vé đỏ: quá giờ 5 phút, còn trong lateHoldMin 15 phút
      machine('GU-POST-RES', [slot(30, 60)]),
      machine('OFF-RES', [slot(45, 60)]),
      machine('OFF-LATE', [slot(-10, 120)]),
    ],
  }
}

// Danh sách máy: bật riêng bằng VITE_WORKSTATIONS_MOCK để không lẫn dữ liệu giả vào trang Máy trạm
// (trang đó dùng chung đường dẫn này).
const workstationHandlers: Record<string, Handler> = {
  // Danh sách nhóm máy (trang Máy trạm dùng để gom + đặt tên nhóm). Chỉ khi bật VITE_WORKSTATIONS_MOCK.
  'GET /machinegroup': () =>
    MOCK_MACHINE_GROUPS.map((group) => ({ ...group, description: '', active: 1, anonymPrice: null })),
  'GET /workstations/runtime': (_b, _q, mode) =>
    mode === 'empty'
      ? { serverTimeMs: Date.now(), items: [] }
      : mode === 'icons'
        ? workstationsIconDemo()
        : workstations(),
}

// ---------------------------------------------------------------------------------------------
// Sơ đồ máy trạm (task ws-map) — mock trong bộ nhớ, chỉ ở kịch bản `icons`. Có sẵn một sơ đồ mẫu: tường + cửa vào + quầy +
// đồ vật làm mốc + 24 máy đầu của danh sách mẫu; các máy còn lại CHƯA xếp để thấy dải "Chưa xếp vị trí". Lưu (POST) cập nhật
// bản trong bộ nhớ và tăng `rev`; gửi `rev` cũ ⇒ 409 MAP_CONFLICT như server thật. F5 là về lại sơ đồ mẫu.
// ---------------------------------------------------------------------------------------------
let mockMap: { rev: number; layout: MapLayout } | null = null

function buildDemoMapLayout(): MapLayout {
  const items: MapItem[] = []
  const cols = 18
  const rows = 11
  for (let c = 0; c < cols; c += 1) items.push(c === 8 ? { t: 'entrance', c, r: 0 } : { t: 'wall_h', c, r: 0 })
  for (let r = 1; r < rows; r += 1) items.push({ t: 'wall_v', c: 0, r }, { t: 'wall_v', c: cols - 1, r })
  for (let c = 1; c < cols - 1; c += 1) items.push({ t: 'wall_h', c, r: rows - 1 })
  const decor: Array<[MapDecorType, number, number]> = [
    ['fire_extinguisher', 1, 1], ['reception', 3, 1], ['bar', 12, 1], ['wc', 15, 1],
    ['billiard', 14, 4], ['table_football', 14, 6], ['ping_pong', 15, 6], ['hookah', 15, 8],
    ['vr', 10, 4], ['vr', 11, 4], ['racing', 12, 4], ['console', 10, 6], ['console', 11, 6],
    ['sofa', 10, 8], ['sofa', 11, 8], ['sofa', 12, 8],
  ]
  for (const [t, c, r] of decor) items.push({ t, c, r })
  workstationsIconDemo()
    .items.slice(0, 24)
    .forEach((machine, index) => items.push({ t: 'pc', host: machine.hostName, c: 2 + (index % 8), r: 3 + Math.floor(index / 8) }))
  return { v: 1, cols, rows, items }
}

// Endpoint chỉ mock ở kịch bản `icons` — các mode khác để đi ra server thật / mock riêng của trang đó.
const iconModeHandlers: Record<string, Handler> = {
  'GET /onlinebook/board': () => iconDemoBoard(),
  'GET /workstations/registered': () => ({
    items: workstationsIconDemo().items.map((machine) => ({ hostName: machine.hostName, machineGroupId: machine.machineGroupId })),
  }),
  'GET /workstations/map': () => {
    mockMap ??= { rev: 1, layout: buildDemoMapLayout() }
    return { exists: true, rev: mockMap.rev, updatedAt: '2026-11-11 09:00:00', updatedBy: 1, layout: mockMap.layout }
  },
  'POST /workstations/map': (body) => {
    if (mockMap && num(body.rev) !== mockMap.rev) {
      throw new ApiError('Mock: có người vừa lưu sơ đồ khác', { httpStatus: 409, code: 'MAP_CONFLICT' })
    }
    mockMap = { rev: (mockMap?.rev ?? 0) + 1, layout: body.layout as MapLayout }
    return { rev: mockMap.rev }
  },
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
