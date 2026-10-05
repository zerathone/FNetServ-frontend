// task orders-qr-qty — logic thuần của hàng đợi gọi món (/orders). Tách khỏi OrderWorkspace để test
// được bằng `node --test` (tests/order-queue-model.test.ts).
import type { PendingOrder } from '../../api/orders'

/** R_DELETE_ORDER (define.h:61) — backend chặn `/service/cancel` bằng quyền này. */
export const ORDER_RIGHTS = {
  DELETE_ORDER: 44,
} as const

/** Parity delegate Qt `MyComboBoxQuantityNotZeroItemDelegate`: 1..99. Backend chặn ngoài khoảng. */
export const QTY_MIN = 1
export const QTY_MAX = 99

/** Đơn khách đã trả QR (webhook mode 3): `ServicePaid=1, Accept=0`. */
export const SERVICE_PAID_QR = 1

export type GroupedOrder = PendingOrder & {
  children: PendingOrder[]
  createdAtMs: number
}

/** Một phiếu QR = nhiều dòng cùng `voucherId` (parity Qt `addGroupRowToTable`). */
export type QrGroup = {
  voucherId: number
  userId: number
  userName: string
  hostName: string | null
  lines: PendingOrder[]
  createdAtMs: number
  paidTotal: number
}

export type QtyOverrides = Record<number, number>

export function parseCreatedAt(date?: string, time?: string) {
  if (!date || !time) return 0
  const parsed = new Date(`${date}T${time}`).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

export function isQrPaid(order: PendingOrder) {
  return order.servicePaid === SERVICE_PAID_QR
}

/** Đơn thường (ServicePaid 0/4/5): gom topping vào món chính, chờ lâu xếp trước. */
export function groupOrders(orders: PendingOrder[]): GroupedOrder[] {
  const normal = orders.filter((order) => !isQrPaid(order))
  const mainIds = new Set(
    normal
      .filter((order) => !order.parentId || order.parentId === 0)
      .map((order) => order.serviceDetailId),
  )
  const mains = normal.filter(
    (order) => !order.parentId || order.parentId === 0 || !mainIds.has(order.parentId),
  )
  const toppings = normal.filter(
    (order) => order.parentId && order.parentId > 0 && mainIds.has(order.parentId),
  )
  return mains
    .map((main) => ({
      ...main,
      children: toppings.filter((item) => item.parentId === main.serviceDetailId),
      createdAtMs: parseCreatedAt(main.serviceDate, main.serviceTime),
    }))
    .sort((left, right) => {
      if (!left.createdAtMs) return 1
      if (!right.createdAtMs) return -1
      return left.createdAtMs - right.createdAtMs
    })
}

/** Đơn đã trả QR gom theo phiếu. Dòng thiếu voucherId (BE cũ) bị bỏ qua — không đoán phiếu. */
export function groupQrOrders(orders: PendingOrder[]): QrGroup[] {
  const byVoucher = new Map<number, QrGroup>()
  for (const order of orders) {
    if (!isQrPaid(order) || !order.voucherId) continue
    let group = byVoucher.get(order.voucherId)
    if (!group) {
      group = {
        voucherId: order.voucherId,
        userId: order.userId,
        userName: order.userName,
        hostName: order.hostName ?? null,
        lines: [],
        createdAtMs: parseCreatedAt(order.serviceDate, order.serviceTime),
        paidTotal: 0,
      }
      byVoucher.set(order.voucherId, group)
    }
    group.lines.push(order)
    group.paidTotal += paidAmountOf(order)
  }
  return [...byVoucher.values()].sort((left, right) => {
    if (!left.createdAtMs) return 1
    if (!right.createdAtMs) return -1
    return left.createdAtMs - right.createdAtMs
  })
}

/** Số đã thu của 1 dòng QR = ServiceAmount (BE trả ở `amount`/`serviceAmount` khi includePaid=1). */
export function paidAmountOf(order: PendingOrder) {
  return order.serviceAmount ?? order.amount
}

/**
 * Đơn ĐÃ DUYỆT (Accept=1) nhưng còn nợ tiền (ServicePaid IN 0,4,5) — gom theo phiếu (`voucherId`),
 * vì `/service/pay`/`/service/clearaccepted` nhận theo voucher (toàn bộ dòng cùng phiếu 1 lần),
 * không nhận theo từng dòng lẻ (handoff `HANDOFF_orders-accepted-unpaid-actions.md` §5.2).
 */
export type AcceptedUnpaidGroup = {
  voucherId: number
  userId: number
  userName: string
  hostName: string | null
  lines: PendingOrder[]
  createdAtMs: number
  total: number
}

/** Dòng thiếu voucherId bị bỏ qua — không đoán phiếu (parity `groupQrOrders`). */
export function groupAcceptedUnpaidOrders(orders: PendingOrder[]): AcceptedUnpaidGroup[] {
  const byVoucher = new Map<number, AcceptedUnpaidGroup>()
  for (const order of orders) {
    if (!order.voucherId) continue
    let group = byVoucher.get(order.voucherId)
    if (!group) {
      group = {
        voucherId: order.voucherId,
        userId: order.userId,
        userName: order.userName,
        hostName: order.hostName ?? null,
        lines: [],
        createdAtMs: parseCreatedAt(order.serviceDate, order.serviceTime),
        total: 0,
      }
      byVoucher.set(order.voucherId, group)
    }
    group.lines.push(order)
    group.total += paidAmountOf(order)
  }
  return [...byVoucher.values()].sort((left, right) => {
    if (!left.createdAtMs) return 1
    if (!right.createdAtMs) return -1
    return left.createdAtMs - right.createdAtMs
  })
}

export function acceptedUnpaidSelectKey(group: AcceptedUnpaidGroup) {
  return `au:${group.voucherId}`
}

/** Payload chung `/service/pay` và `/service/clearaccepted`: cả 2 đều nhận theo voucher. */
export function acceptedUnpaidDetailIds(group: AcceptedUnpaidGroup) {
  return group.lines.map((line) => line.serviceDetailId)
}

/** Đơn giá snapshot lúc đặt (BE: ServiceAmount / ServiceQuantity). Fallback giá hiện tại. */
export function unitPriceOf(order: PendingOrder) {
  return order.unitPrice ?? order.price
}

export function clampQuantity(value: number) {
  if (!Number.isFinite(value)) return QTY_MIN
  return Math.min(QTY_MAX, Math.max(QTY_MIN, Math.trunc(value)))
}

export function quantityOf(order: PendingOrder, overrides: QtyOverrides) {
  return overrides[order.serviceDetailId] ?? order.quantity
}

/**
 * Tiền tạm hiển thị — cùng công thức backend tính lại (`svcRecalcAmount`): giữ nguyên SL thì
 * đúng số đã ghi khi đặt, đổi SL thì SL × đơn giá. Sau Chấp nhận phải hiển thị theo response.
 */
export function lineAmount(order: PendingOrder, overrides: QtyOverrides) {
  const quantity = quantityOf(order, overrides)
  if (quantity === order.quantity) return order.serviceAmount ?? order.amount
  return quantity * unitPriceOf(order)
}

export function orderAmount(order: GroupedOrder, overrides: QtyOverrides = {}) {
  return (
    lineAmount(order, overrides) +
    order.children.reduce((sum, child) => sum + lineAmount(child, overrides), 0)
  )
}

/**
 * Parity Qt `OnOffRequestFunction`: chỉ đổi SL dòng đứng một mình — không có topping kèm, bản thân
 * không phải topping, ServicePaid 0/4/5.
 */
export function canChangeQuantity(order: GroupedOrder) {
  if (order.children.length > 0) return false
  if (order.topping === 1) return false
  if (order.parentId && order.parentId > 0) return false
  return order.servicePaid === 0 || order.servicePaid === 4 || order.servicePaid === 5
}

/** Payload `/service/accept` cho đơn thường. `amount` chỉ để tương thích — BE tính lại. */
export function serviceItems(order: GroupedOrder, overrides: QtyOverrides = {}) {
  return [order, ...order.children].map((line) => ({
    detailId: line.serviceDetailId,
    quantity: quantityOf(line, overrides),
    amount: lineAmount(line, overrides),
    alreadyPaid: false,
  }))
}

/** Payload `/service/accept` cho phiếu QR: MỌI dòng `alreadyPaid:true`, BE trừ kho theo SL trong DB. */
export function qrAcceptItems(group: QrGroup) {
  return group.lines.map((line) => ({
    detailId: line.serviceDetailId,
    quantity: line.quantity,
    amount: paidAmountOf(line),
    alreadyPaid: true,
  }))
}

/** Parity chuỗi Qt `on_actClear_triggered` (servicewaitingwidget.cpp:1658-1663). */
export function customerInfoOf(userName: string | undefined) {
  return userName ? `Tài khoản ${userName}` : 'Khách vãng lai'
}

export type CancelItem = {
  type: 'service'
  id: number
  machineName: string
  customerInfo: string
  serviceName: string
  quantity: number
  amount: number
}

function cancelItemOf(line: PendingOrder, userName: string, hostName: string | null | undefined, amount: number): CancelItem {
  return {
    type: 'service',
    id: line.serviceDetailId,
    machineName: hostName || '',
    customerInfo: customerInfoOf(userName),
    serviceName: line.serviceName,
    quantity: line.quantity,
    amount,
  }
}

/** `/service/cancel` cho đơn thường — gửi đủ field để log hủy (serverlogtb) có máy/khách/món/SL/tiền. */
export function serviceCancelItems(order: GroupedOrder): CancelItem[] {
  return [order, ...order.children].map((line) =>
    cancelItemOf(line, order.userName, order.hostName, line.serviceAmount ?? line.amount),
  )
}

export function qrCancelItems(group: QrGroup): CancelItem[] {
  return group.lines.map((line) => cancelItemOf(line, group.userName, group.hostName, paidAmountOf(line)))
}

/** Khóa chọn nhiều: đơn thường theo detailId, đơn QR theo voucherId (handoff §P2). */
export function serviceSelectKey(order: GroupedOrder) {
  return `svc:${order.serviceDetailId}`
}

export function qrSelectKey(group: QrGroup) {
  return `qr:${group.voucherId}`
}

/** P5: parity Qt `checkServiceInventoryWarning` — "+ <món>: còn [x]." ; rỗng ⇒ null (không toast). */
export function describeInventoryWarnings(
  warnings: Array<{ serviceName: string; inventory: number }> | undefined,
) {
  if (!warnings || warnings.length === 0) return null
  return `Sắp hết hàng: ${warnings.map((w) => `${w.serviceName} còn ${w.inventory}`).join('; ')}.`
}

/** KNOWLEDGE §47: `accepted/cancelled === 0` ⇒ KHÔNG báo thành công. */
export function describeProcessedCount(count: number, verb: string) {
  if (count <= 0) {
    return { tone: 'info' as const, message: 'Đơn đã được xử lý trước đó.' }
  }
  return { tone: 'success' as const, message: `Đã ${verb} ${count} dòng dịch vụ.` }
}
