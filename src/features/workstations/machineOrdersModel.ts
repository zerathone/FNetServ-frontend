// Logic thuần: đơn hàng khách đã gọi/mua trong PHIÊN CHƠI hiện tại của một máy (nhóm "Đơn hàng" ở
// drawer): món dịch vụ + combo. Server (GET /workstations/orders) đã lọc theo máy + phiên và tính sẵn
// số đếm; ở đây chỉ gom topping vào món chính, trộn combo vào và chia khu để hiển thị.
// Chỉ import `type` để chạy được bằng `node --test` (tests/machine-orders-model.test.ts).
import type {
  WorkstationComboItem,
  WorkstationOrderItem,
  WorkstationOrderStatus,
  WorkstationOrdersResponse,
} from '../../api/workstations'

export type MachineOrderTopping = {
  id: number
  name: string
  quantity: number
  amount: number
}

export type MachineOrderLine = {
  /** id riêng theo loại — món và combo có thể trùng số, nên key/khóa luôn kèm `kind`. */
  id: number
  kind: 'service' | 'combo'
  status: WorkstationOrderStatus
  name: string
  quantity: number
  amount: number
  createdAtMs: number
  toppings: MachineOrderTopping[]
}

export type MachineOrdersSummary = WorkstationOrdersResponse['summary']

/** "YYYY-MM-DD" + "HH:MM:SS" -> epoch ms; thiếu hoặc không parse được -> 0. */
export function parseOrderTime(date?: string, time?: string) {
  if (!date || !time) return 0
  const parsed = new Date(`${date}T${time}`).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function newestFirst(left: MachineOrderLine, right: MachineOrderLine) {
  if (!left.createdAtMs) return 1
  if (!right.createdAtMs) return -1
  return right.createdAtMs - left.createdAtMs
}

/**
 * Topping = dòng có parentId trỏ tới một món chính CÓ TRONG danh sách; topping mồ côi (món chính không
 * nằm trong phiên) vẫn hiện như một dòng riêng thay vì biến mất. Cùng quy tắc topping với Server nên không
 * tự đếm lại ở đây — số đếm lấy từ `summary`.
 */
export function groupMachineOrders(
  items: WorkstationOrderItem[],
  combos: WorkstationComboItem[] = [],
): MachineOrderLine[] {
  const mainIds = new Set(
    items.filter((item) => !item.parentId || item.parentId === 0).map((item) => item.serviceDetailId),
  )
  const isTopping = (item: WorkstationOrderItem) =>
    Boolean(item.parentId && item.parentId > 0 && mainIds.has(item.parentId))

  const services: MachineOrderLine[] = items
    .filter((item) => !isTopping(item))
    .map((item) => ({
      id: item.serviceDetailId,
      kind: 'service' as const,
      status: item.status,
      name: item.serviceName,
      quantity: item.quantity,
      amount: item.amount,
      createdAtMs: parseOrderTime(item.serviceDate, item.serviceTime),
      toppings: items
        .filter((child) => child.parentId === item.serviceDetailId)
        .map((child) => ({
          id: child.serviceDetailId,
          name: child.serviceName,
          quantity: child.quantity,
          amount: child.amount,
        })),
    }))

  // Combo luôn là 1 dòng (mỗi lần mua = 1 thẻ). `createdAt` = "YYYY-MM-DD HH:MM:SS".
  const comboLines: MachineOrderLine[] = combos.map((combo) => {
    const [date, time] = combo.createdAt.split(' ')
    return {
      id: combo.comboCardId,
      kind: 'combo' as const,
      status: combo.status,
      name: combo.comboName,
      quantity: 1,
      amount: combo.price,
      createdAtMs: parseOrderTime(date, time),
      toppings: [],
    }
  })

  return [...services, ...comboLines].sort(newestFirst)
}

/** Khu "Chờ duyệt" (cần thu ngân xử lý, đứng trên) và khu "Đã gọi / đã mua" (còn lại). */
export function splitMachineOrders(lines: MachineOrderLine[]) {
  return {
    waiting: lines.filter((line) => line.status === 'waiting'),
    done: lines.filter((line) => line.status !== 'waiting'),
  }
}

export const MACHINE_ORDER_STATUS_LABEL: Record<WorkstationOrderStatus, string> = {
  waiting: 'Đang chờ',
  accepted: 'Đã duyệt',
  paid: 'Đã thu',
}

/** Số đơn đang chờ thu ngân duyệt = món chờ + combo chờ (thứ đang đợi người xử lý). */
export function machineOrdersWaitingTotal(summary: MachineOrdersSummary) {
  return summary.waitingCount + summary.comboWaitingCount
}

/** Dòng tóm tắt compact của nhóm: "3 món đã gọi · 1 combo · 2 đang chờ"; chỉ nhắc phần có số. */
export function machineOrdersSummary(summary: MachineOrdersSummary) {
  if (summary.orderedCount === 0 && summary.comboCount === 0) return 'Chưa gọi món'
  const parts: string[] = []
  if (summary.orderedCount > 0) parts.push(`${summary.orderedCount} món đã gọi`)
  if (summary.comboCount > 0) parts.push(`${summary.comboCount} combo`)
  const waiting = machineOrdersWaitingTotal(summary)
  if (waiting > 0) parts.push(`${waiting} đang chờ`)
  return parts.join(' · ')
}
