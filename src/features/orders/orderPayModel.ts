// task service-payrequest-core (FE phần B) — logic thuần của nút Thanh toán / Cấn trừ trên /orders.
// Tách khỏi OrderWorkspace để test được bằng `node --test` (tests/order-pay-model.test.ts).
import type {
  PayRequestDryRunPayload,
  PayRequestPayload,
  PayRequestResponse,
  ServicePayFullCorePayload,
} from '../../api/payment.ts'
import {
  SERVICE_PAID_QR,
  lineAmount,
  quantityOf,
  type GroupedOrder,
  type QtyOverrides,
} from './orderQueueModel.ts'
import { GUEST_HOST_NAME, isCounterGuest } from './counterGuest.ts'

/** R_SERVICEMONEY_EXCEPT (9224) — backend chỉ bắt quyền này cho `deduct`, KHÔNG bắt cho tiền mặt. */
export const SERVICE_EXCEPT_RIGHT = 9224

export type PayMethod = 'cash' | 'deduct'

/** `ServicePaid` khách chọn ngay trên máy trạm (parity Qt `SERVICE_PAID_CASH` / `SERVICE_PAID_DEDUCT`). */
export const SERVICE_PAID_CASH = 4
export const SERVICE_PAID_DEDUCT = 5

/** Trạng thái máy theo convention `/workstations/runtime` (workstationModel.WORKSTATION_STATUS). */
export const MACHINE_STATUS = {
  INIT_INFO: 0,
  AVAILABLE: 1,
  DISCONNECT: 2,
  ONLINE: 3,
  WARNING: 4,
} as const

/** `UGTYPE` (DBUtils.h:36): ANONYM=1, MEMBER=2, ADMIN=3, STAFF=4, COMBOCARD=5. */
export const USER_GROUP = {
  anonym: 1,
  member: 2,
  admin: 3,
  staff: 4,
  combo: 5,
} as const

export type MachineInfo = {
  status: number
  userId: number
  userGroupType: number
}

/**
 * - `undefined`: chưa có dữ liệu máy (chưa tải / lỗi) ⇒ **fail-open**, backend vẫn là bên quyết định.
 * - `null`: đã tải danh sách nhưng không thấy máy này.
 */
export type MachineLookup = MachineInfo | null | undefined

export type ActionGate = { enabled: boolean; reason?: string }

export type PayGates = {
  accept: ActionGate
  cash: ActionGate
  deduct: ActionGate
}

const ENABLED: ActionGate = { enabled: true }

function blocked(reason: string): ActionGate {
  return { enabled: false, reason }
}

function machineStatusLabel(status: number) {
  switch (status) {
    case MACHINE_STATUS.AVAILABLE:
      return 'sẵn sàng (chưa có khách)'
    case MACHINE_STATUS.DISCONNECT:
      return 'mất kết nối'
    case MACHINE_STATUS.WARNING:
      return 'đang cảnh báo'
    default:
      return 'không hoạt động'
  }
}

/** Parity `OnOffRequestFunction` (servicewaitingwidget.cpp:764-821): AVAILABLE/DISCONNECT/WARNING ⇒ tắt. */
function isMachineIdle(status: number) {
  return (
    status === MACHINE_STATUS.AVAILABLE ||
    status === MACHINE_STATUS.DISCONNECT ||
    status === MACHINE_STATUS.WARNING
  )
}

/** Chấp nhận / Thanh toán / đổi số lượng: chung một điều kiện theo máy + loại tài khoản (parity Qt). */
export function machineGate(machine: MachineLookup): ActionGate {
  if (!machine) return ENABLED // chưa biết máy ⇒ không tự chặn
  if (isMachineIdle(machine.status)) {
    return blocked(`Máy đang ${machineStatusLabel(machine.status)} — không xử lý được đơn.`)
  }
  const known: number[] = [USER_GROUP.anonym, USER_GROUP.member, USER_GROUP.staff, USER_GROUP.combo]
  if (!known.includes(machine.userGroupType)) {
    return blocked('Loại tài khoản trên máy này không hỗ trợ xử lý đơn dịch vụ.')
  }
  return ENABLED
}

/**
 * Luật bật/tắt 3 nút của một đơn dịch vụ thường. Backend vẫn kiểm lại tất cả — đây chỉ là UX và
 * parity với `OnOffRequestFunction` (servicewaitingwidget.cpp:739-868).
 */
export function payGates(
  order: Pick<GroupedOrder, 'servicePaid' | 'userId' | 'hostName'> & Partial<Pick<GroupedOrder, 'userName'>>,
  machine: MachineLookup,
  hasDeductRight: boolean,
): PayGates {
  const machineBase = machineGate(machine)

  if (order.servicePaid === SERVICE_PAID_QR) {
    const reason = 'Đơn đã trả QR — chỉ xác nhận phục vụ.'
    return { accept: blocked(reason), cash: blocked(reason), deduct: blocked(reason) }
  }

  // task staff-service-order: dòng treo của khách vãng lai tại quầy ("Gọi món hộ" lỗi giữa chừng) chỉ thu
  // tiền mặt kênh `guest` — KHÔNG ghi tab lên user singleton KHACHVANGLAI, KHÔNG cấn trừ.
  if (isCounterGuest(order)) {
    const reason = 'Khách vãng lai tại quầy chỉ thu tiền mặt.'
    return { accept: blocked(reason), cash: ENABLED, deduct: blocked(reason) }
  }

  const noCustomer = order.userId === 0
  const cash: ActionGate = !machineBase.enabled
    ? machineBase
    : order.servicePaid === SERVICE_PAID_DEDUCT
      ? blocked('Khách đã chọn cấn trừ — dùng nút Cấn trừ.')
      : noCustomer
        ? blocked('Đơn chưa gắn tài khoản khách — dùng Chấp nhận.')
        : ENABLED

  let deduct: ActionGate
  if (order.servicePaid === SERVICE_PAID_CASH) {
    deduct = blocked('Khách đã chọn tiền mặt tại máy — dùng nút Thanh toán.')
  } else if (!hasDeductRight) {
    deduct = blocked(`Thiếu quyền cấn trừ dịch vụ (${SERVICE_EXCEPT_RIGHT}).`)
  } else if (noCustomer) {
    deduct = blocked('Đơn chưa gắn tài khoản hội viên.')
  } else if (!order.hostName) {
    deduct = blocked('Không rõ tên máy — không cấn trừ được.')
  } else if (machine === null) {
    deduct = blocked('Không thấy máy này trong danh sách máy đang chạy.')
  } else if (machine === undefined) {
    deduct = ENABLED // chưa có dữ liệu máy ⇒ để backend quyết định
  } else if (isMachineIdle(machine.status)) {
    deduct = blocked(`Máy đang ${machineStatusLabel(machine.status)} — hội viên không online.`)
  } else if (machine.userGroupType !== USER_GROUP.member) {
    deduct = blocked('Chỉ cấn trừ cho hội viên (không áp dụng khách vãng lai / nhân viên / thẻ combo).')
  } else if (machine.userId !== order.userId) {
    deduct = blocked('Hội viên của đơn không còn đăng nhập ở máy này.')
  } else {
    deduct = ENABLED
  }

  return { accept: machineBase, cash, deduct }
}

/** Dòng gửi `/service/payrequest`: món chính + topping cùng một lần (parity Qt `expandSelectedRows`). */
export function payItems(order: GroupedOrder, overrides: QtyOverrides = {}) {
  return [order, ...order.children].map((line) => ({
    detailId: line.serviceDetailId,
    quantity: quantityOf(line, overrides),
    // BE bỏ qua `amount` client (tự tính lại từ DB); gửi để tương thích và để BE log khi lệch.
    amount: lineAmount(line, overrides),
  }))
}

/** Mọi thứ làm đổi bản chất giao dịch phải nằm trong fingerprint ⇒ đổi bất kỳ thứ gì là `idem` mới. */
export function payFingerprint(method: PayMethod, order: GroupedOrder, overrides: QtyOverrides = {}) {
  return {
    method,
    userId: order.userId,
    hostName: order.hostName || '',
    items: payItems(order, overrides),
  }
}

export function dryRunPayload(
  method: PayMethod,
  order: GroupedOrder,
  staffId: number,
  overrides: QtyOverrides = {},
): PayRequestDryRunPayload {
  // Khách vãng lai tại quầy: kênh `guest` (PY_GUESS_SERVICE) + máy `KHACH_TAI_QUAY`, không phải `cash`.
  const guest = method === 'cash' && isCounterGuest(order)
  return {
    staffId,
    userId: order.userId,
    hostName: guest ? GUEST_HOST_NAME : order.hostName || '',
    paymentMethod: guest ? 'guest' : method,
    items: payItems(order, overrides),
  }
}

export function payPayload(
  method: PayMethod,
  order: GroupedOrder,
  staffId: number,
  idem: string,
  overrides: QtyOverrides = {},
): PayRequestPayload {
  return { ...dryRunPayload(method, order, staffId, overrides), idem, fullCore: true }
}

// ---------------------------------------------------------------------------------------------
// Kết quả của một lần gọi (đã qua `parseEnvelope`, tức `status=1`)
// ---------------------------------------------------------------------------------------------

export type PayOutcome =
  | { kind: 'success'; message: string; clearKey: true }
  | { kind: 'info'; message: string; clearKey: boolean }
  /** Phiếu ĐÃ ghi nhưng ví CHƯA trừ (hoặc không xác nhận được) — cần banner cố định, KHÔNG toast thành công. */
  | { kind: 'manual-fix'; message: string; code: string | undefined; retryable: boolean }

function paidLabel(method: PayMethod) {
  return method === 'deduct' ? 'cấn trừ' : 'thanh toán'
}

/**
 * KNOWLEDGE §47: `status=1` KHÔNG có nghĩa là đã làm xong. Cấn trừ chỉ là thành công khi
 * `deductApplied === true`; field vắng mặt cũng không được coi là thành công.
 */
export function classifyPayResult(method: PayMethod, response: PayRequestResponse): PayOutcome {
  const paymentId = response.paymentId ? ` #${response.paymentId}` : ''

  if (response.duplicated) {
    if (method === 'deduct' && response.deductApplied !== true) {
      return manualFix(response)
    }
    return {
      kind: 'info',
      message: `Đơn đã được ${paidLabel(method)} trước đó${paymentId} — không xử lý lần hai.`,
      clearKey: true,
    }
  }

  if (method === 'deduct') {
    if (response.needsManualFix === true || response.deductApplied !== true) {
      return manualFix(response)
    }
    return {
      kind: 'success',
      message: response.retried
        ? `Đã trừ ví lại thành công · Phiếu${paymentId}.`
        : `Cấn trừ thành công · Phiếu${paymentId}.`,
      clearKey: true,
    }
  }

  // cash
  if ((response.paid ?? 0) <= 0) {
    return { kind: 'info', message: 'Đơn đã được xử lý trước đó.', clearKey: false }
  }
  const total = typeof response.total === 'number' ? ` · ${formatVnd(response.total)}` : ''
  return {
    kind: 'success',
    message: `Đã thu tiền mặt ${response.paid} dòng · Phiếu${paymentId}${total}.`,
    clearKey: true,
  }
}

function manualFix(response: PayRequestResponse): PayOutcome {
  const paymentId = response.paymentId ? ` #${response.paymentId}` : ''
  return {
    kind: 'manual-fix',
    code: response.code,
    // Chỉ `deduct_failed` (chưa có phiếu dấu) mới chạy lại an toàn. `member_offline` ⇒ user chốt:
    // không trừ ví khi hội viên đã offline; `deduct_incomplete` ⇒ trừ dở, không biết bước nào đã xong.
    retryable: response.code === 'deduct_failed',
    message:
      response.code === 'deduct_incomplete'
        ? `Phiếu cấn trừ${paymentId} đã ghi nhưng trừ ví dở dang.`
        : `Phiếu cấn trừ${paymentId} đã ghi nhưng CHƯA trừ ví hội viên.`,
  }
}

export type PayErrorPlan = {
  /** Danh sách đơn đã đổi — tải lại. */
  refetch: boolean
  /** `idem` đã trùng với giao dịch khác ⇒ bỏ key cũ để lần sau sinh key mới. */
  resetKey: boolean
}

/**
 * Lỗi nghiệp vụ của nhánh `fullCore` (status=0 ⇒ `ApiError.code`). Không ghi gì trong mọi trường hợp
 * này (phiếu chỉ ghi khi trả `status=1`), nên giữ nguyên `idem` là an toàn trừ `idem_mismatch`.
 */
export function classifyPayError(code: string | undefined): PayErrorPlan {
  switch (code) {
    case 'invalid_lines':
    case 'nothing_paid':
      return { refetch: true, resetKey: false }
    case 'idem_mismatch':
      return { refetch: true, resetKey: true }
    default:
      return { refetch: false, resetKey: false }
  }
}

// ---------------------------------------------------------------------------------------------
// Banner "đã ghi phiếu nhưng chưa trừ ví"
// ---------------------------------------------------------------------------------------------

export type DeductAlert = {
  /** Khóa theo phiếu — một phiếu chỉ có một banner. */
  paymentId: number
  hostName: string
  customerLabel: string
  amount: number
  code: string | undefined
  retryable: boolean
  /** Request gốc (CÙNG `idem`) để "Thử trừ ví lại" — tải lại trang thì mất, log serverlogtb là đường chính. */
  retry: DeductRetry
}

/**
 * Gửi lại đúng endpoint gốc: đơn chưa duyệt đi `/service/payrequest`, đơn ĐÃ DUYỆT đi `/service/pay`
 * (task service-pay-fullcore). Cả hai đều nhận ra phiếu đã ghi qua `idem` và chỉ chạy lại bước trừ ví.
 */
export type DeductRetry =
  | { endpoint: 'payrequest'; request: PayRequestPayload }
  | { endpoint: 'service-pay'; request: ServicePayFullCorePayload }

export function upsertAlert(alerts: DeductAlert[], next: DeductAlert) {
  return [...alerts.filter((alert) => alert.paymentId !== next.paymentId), next]
}

export function removeAlert(alerts: DeductAlert[], paymentId: number) {
  return alerts.filter((alert) => alert.paymentId !== paymentId)
}

export function describeAlertReason(code: string | undefined) {
  switch (code) {
    case 'member_offline':
      return 'Hội viên không còn online tại máy nên không trừ ví nữa (không tự trừ khi hội viên đã thoát). Xử lý thủ công theo log.'
    case 'deduct_incomplete':
      return 'Trừ ví đã chạy dở — hệ thống KHÔNG tự chạy lại để tránh trừ hai lần. Kiểm tra số dư hội viên rồi xử lý thủ công.'
    case 'deduct_failed':
      return 'Có thể bấm "Thử trừ ví lại" nếu hội viên vẫn đang online đúng máy này.'
    default:
      return 'Không xác nhận được kết quả trừ ví — kiểm tra số dư hội viên rồi xử lý thủ công.'
  }
}

export function formatVnd(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}
