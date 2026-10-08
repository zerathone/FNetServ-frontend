// task staff-service-order (FE-1) — logic thuần của màn "Gọi món hộ" trên /orders. Tách khỏi component
// để test được bằng `node --test` (tests/staff-order-model.test.ts). KHÔNG import `api/client` (kéo
// theo store/localStorage) — phân loại lỗi dùng duck-typing.
import type { acceptServiceOrder, StaffOrderPayload, StaffOrderResponse } from '../../api/orders.ts'
import type { PayRequestPayload } from '../../api/payment.ts'
import type { ServiceItem } from '../../api/services.ts'
import type { WorkstationRuntime } from '../../api/workstations.ts'
import { GUEST_HOST_NAME } from './counterGuest.ts'
import { QTY_MAX, QTY_MIN, clampQuantity } from './orderQueueModel.ts'
import { USER_GROUP, formatVnd, payGates, type ActionGate, type MachineInfo } from './orderPayModel.ts'

type AcceptPayload = Parameters<typeof acceptServiceOrder>[0]

export { GUEST_HOST_NAME, GUEST_USER_NAME, isCounterGuest } from './counterGuest.ts'

/** Giới hạn của `/service/staff-order`. */
export const CART_MAX_LINES = 50
export const UNGROUPED_LABEL = 'Chưa phân nhóm'

// ---------------------------------------------------------------------------------------------
// Đối tượng được gọi hộ
// ---------------------------------------------------------------------------------------------

export type StaffOrderTarget =
  | { kind: 'member'; userId: number; hostName: string; userName: string }
  | { kind: 'guest' }

export type MachineTarget = {
  hostName: string
  userId: number
  userName: string
  userGroupType: number
  status: number
  /** Nhãn loại tài khoản — "Hội viên", "Khách vãng lai (ngồi máy)"... */
  kindLabel: string
}

export function userGroupLabel(userGroupType: number) {
  switch (userGroupType) {
    case USER_GROUP.member:
      return 'Hội viên'
    case USER_GROUP.anonym:
      return 'Khách vãng lai (ngồi máy)'
    case USER_GROUP.staff:
      return 'Nhân viên'
    case USER_GROUP.combo:
      return 'Thẻ combo'
    case USER_GROUP.admin:
      return 'Quản trị'
    default:
      return 'Tài khoản khác'
  }
}

/** Bỏ dấu + hạ chữ thường — thu ngân gõ "tra da" vẫn ra "Trà đá". */
export function foldText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll('đ', 'd')
    .replaceAll('Đ', 'd')
    .toLocaleLowerCase('vi')
    .trim()
}

type RuntimeMachine = Pick<WorkstationRuntime, 'hostName' | 'userId' | 'userName' | 'userGroupType' | 'status'>

/**
 * Máy đang có tài khoản đăng nhập (`userId > 0`) — gồm cả khách vãng lai đang ngồi máy (CType=0) nên
 * KHÔNG gọi chung là "hội viên". Sắp theo tên máy kiểu số tự nhiên (PC2 trước PC10).
 */
export type MachineSearchField = 'customer' | 'host'

/** `field` = trường tìm (parity thanh tìm của /logs/system: "Tài khoản" | "Tên máy"); bỏ trống = tìm cả hai. */
export function listMachineTargets(
  machines: readonly RuntimeMachine[] | undefined,
  search = '',
  field?: MachineSearchField,
): MachineTarget[] {
  const needle = foldText(search)
  return (machines ?? [])
    .filter((machine) => machine.userId > 0)
    .map((machine) => ({
      hostName: machine.hostName,
      userId: machine.userId,
      userName: machine.userName ?? '',
      userGroupType: machine.userGroupType,
      status: machine.status,
      kindLabel: userGroupLabel(machine.userGroupType),
    }))
    .filter((machine) => {
      if (!needle) return true
      const haystack =
        field === 'host' ? machine.hostName : field === 'customer' ? machine.userName : `${machine.hostName} ${machine.userName}`
      return foldText(haystack).includes(needle)
    })
    .sort((left, right) => left.hostName.localeCompare(right.hostName, 'vi', { numeric: true }))
}

export function targetOfMachine(machine: MachineTarget): StaffOrderTarget {
  return { kind: 'member', userId: machine.userId, hostName: machine.hostName, userName: machine.userName }
}

export function sameTarget(left: StaffOrderTarget | null, right: StaffOrderTarget | null) {
  if (!left || !right) return left === right
  if (left.kind === 'guest' || right.kind === 'guest') return left.kind === right.kind
  return left.userId === right.userId && left.hostName === right.hostName
}

export function describeTarget(target: StaffOrderTarget) {
  return target.kind === 'guest'
    ? 'Khách vãng lai tại quầy'
    : `${target.hostName} · ${target.userName || 'Tài khoản đang đăng nhập'}`
}

// ---------------------------------------------------------------------------------------------
// Danh mục dịch vụ
// ---------------------------------------------------------------------------------------------

export type CatalogGroup = { key: string; name: string; services: ServiceItem[] }

/** Món đang bán: server cũ chưa trả `active` ⇒ coi như đang bán. */
export function isSellable(service: ServiceItem) {
  return service.active !== 0
}

/**
 * Nhóm danh mục: chỉ món đang bán; thiếu tên nhóm (`groupId=0`, hoặc trỏ tới nhóm không tồn tại — DB
 * không có FK) gộp vào "Chưa phân nhóm" xếp CUỐI. Tìm kiếm bỏ dấu, khớp tên món.
 */
export function buildCatalog(services: readonly ServiceItem[] | undefined, search = ''): CatalogGroup[] {
  const needle = foldText(search)
  const byKey = new Map<string, CatalogGroup>()
  for (const service of services ?? []) {
    if (!isSellable(service)) continue
    if (needle && !foldText(service.name).includes(needle)) continue
    const groupName = (service.groupName ?? '').trim()
    const key = groupName ? `g:${service.groupId ?? 0}:${groupName}` : 'none'
    let group = byKey.get(key)
    if (!group) {
      group = { key, name: groupName || UNGROUPED_LABEL, services: [] }
      byKey.set(key, group)
    }
    group.services.push(service)
  }
  const groups = [...byKey.values()]
  for (const group of groups) {
    group.services.sort((left, right) => left.name.localeCompare(right.name, 'vi', { numeric: true }))
  }
  return groups.sort((left, right) => {
    if (left.key === 'none') return 1
    if (right.key === 'none') return -1
    return left.name.localeCompare(right.name, 'vi', { numeric: true })
  })
}

// ---------------------------------------------------------------------------------------------
// Giỏ
// ---------------------------------------------------------------------------------------------

export type CartLine = { serviceId: number; quantity: number }

/** Số lượng tối đa của 1 món: 99, hoặc tồn kho nếu món có quản lý kho. Server vẫn là nguồn sự thật. */
export function stockLimit(service: Pick<ServiceItem, 'inventory' | 'inventoryManagement'>) {
  if (service.inventoryManagement === 1) return Math.max(0, Math.min(QTY_MAX, Math.trunc(service.inventory)))
  return QTY_MAX
}

export function setCartQuantity(cart: readonly CartLine[], service: ServiceItem, quantity: number): CartLine[] {
  const limit = stockLimit(service)
  const exists = cart.some((line) => line.serviceId === service.id)
  if (!exists && (limit < QTY_MIN || cart.length >= CART_MAX_LINES)) return [...cart]
  const next = Math.min(limit, clampQuantity(quantity))
  if (next < QTY_MIN) return cart.filter((line) => line.serviceId !== service.id)
  if (!exists) return [...cart, { serviceId: service.id, quantity: next }]
  return cart.map((line) => (line.serviceId === service.id ? { ...line, quantity: next } : line))
}

export function addToCart(cart: readonly CartLine[], service: ServiceItem, delta = 1): CartLine[] {
  const current = cart.find((line) => line.serviceId === service.id)?.quantity ?? 0
  return setCartQuantity(cart, service, current + delta)
}

export function removeFromCart(cart: readonly CartLine[], serviceId: number): CartLine[] {
  return cart.filter((line) => line.serviceId !== serviceId)
}

/** Tổng tạm tính để HIỂN THỊ — số tiền thật lấy từ response của server. */
export function cartTotal(cart: readonly CartLine[], services: readonly ServiceItem[] | undefined) {
  const byId = new Map((services ?? []).map((service) => [service.id, service]))
  return cart.reduce((sum, line) => sum + line.quantity * (byId.get(line.serviceId)?.price ?? 0), 0)
}

export type CartIssue = { serviceId: number; reason: 'unavailable' | 'stock'; name: string; limit: number }

/** Tồn kho/món ngừng bán đổi sau khi đã bỏ vào giỏ (danh mục tải lại) — chặn gửi, báo thu ngân. */
export function cartIssues(cart: readonly CartLine[], services: readonly ServiceItem[] | undefined): CartIssue[] {
  const byId = new Map((services ?? []).map((service) => [service.id, service]))
  const issues: CartIssue[] = []
  for (const line of cart) {
    const service = byId.get(line.serviceId)
    if (!service || !isSellable(service)) {
      issues.push({ serviceId: line.serviceId, reason: 'unavailable', name: service?.name ?? `#${line.serviceId}`, limit: 0 })
    } else if (line.quantity > stockLimit(service)) {
      issues.push({ serviceId: line.serviceId, reason: 'stock', name: service.name, limit: stockLimit(service) })
    }
  }
  return issues
}

// ---------------------------------------------------------------------------------------------
// Bước 1 — tạo dòng Accept=0
// ---------------------------------------------------------------------------------------------

function sortedItems(cart: readonly CartLine[]) {
  return [...cart].sort((left, right) => left.serviceId - right.serviceId).map((line) => ({ serviceId: line.serviceId, quantity: line.quantity }))
}

/** Đổi khách / đổi món / đổi số lượng ⇒ ý định mới ⇒ idem mới. (Server cũng đối chiếu `idem_mismatch`.) */
export function staffOrderFingerprint(target: StaffOrderTarget, cart: readonly CartLine[]) {
  return {
    target:
      target.kind === 'guest'
        ? { kind: 'guest' }
        : { kind: 'member', userId: target.userId, hostName: target.hostName },
    items: sortedItems(cart),
  }
}

export function staffOrderPayload(target: StaffOrderTarget, cart: readonly CartLine[], idem: string): StaffOrderPayload {
  return target.kind === 'guest'
    ? { userId: 0, anonymous: true, hostName: GUEST_HOST_NAME, idem, items: sortedItems(cart) }
    : { userId: target.userId, anonymous: false, hostName: target.hostName, idem, items: sortedItems(cart) }
}

// ---------------------------------------------------------------------------------------------
// Bước 2 — duyệt / thu tiền các dòng vừa tạo
// ---------------------------------------------------------------------------------------------

/** `tab` = "Chấp nhận" (`/service/accept`, chỉ hội viên); `cash`/`deduct` đi `/service/payrequest`. */
export type SettleMethod = 'tab' | 'cash' | 'deduct'

export const SETTLE_LABEL: Record<SettleMethod, string> = {
  tab: 'Chấp nhận',
  cash: 'Thu tiền mặt',
  deduct: 'Cấn trừ',
}

/** Thông báo thành công ngắn: "Đã thu tiền #123 22.000 đ" | "Đã chấp nhận #123 …" | "Đã cấn trừ #123 …". */
export function describeSettled(method: SettleMethod, paymentId: number | undefined, amount: number) {
  const verb = method === 'tab' ? 'Đã chấp nhận' : method === 'deduct' ? 'Đã cấn trừ' : 'Đã thu tiền'
  const id = paymentId ? ` #${paymentId}` : ''
  return `${verb}${id} ${formatVnd(amount)}`
}

export function availableMethods(target: StaffOrderTarget): SettleMethod[] {
  return target.kind === 'guest' ? ['cash'] : ['tab', 'cash', 'deduct']
}

/**
 * Bật/tắt từng cách xử lý. Hội viên: dùng luật `payGates` (parity Qt) với `servicePaid=0` vì dòng luôn
 * tag 0 ⇒ không có khoá "khách đã chọn tại máy". Chưa có dữ liệu máy ⇒ fail-open, server vẫn kiểm.
 */
export function methodGates(
  target: StaffOrderTarget,
  machine: MachineInfo | null | undefined,
  hasDeductRight: boolean,
): Record<SettleMethod, ActionGate> {
  if (target.kind === 'guest') {
    const reason = 'Khách vãng lai tại quầy chỉ thu tiền mặt.'
    return { tab: { enabled: false, reason }, cash: { enabled: true }, deduct: { enabled: false, reason } }
  }
  const gates = payGates({ servicePaid: 0, userId: target.userId, hostName: target.hostName }, machine, hasDeductRight)
  return { tab: gates.accept, cash: gates.cash, deduct: gates.deduct }
}

/** Fingerprint bước 2 = các `detailId` đã sắp xếp + cách thu ⇒ đổi cách thu (vd cấn trừ lỗi → tiền mặt) là idem mới. */
export function settleFingerprint(detailIds: readonly number[], method: SettleMethod) {
  return { detailIds: [...detailIds].sort((left, right) => left - right), method }
}

export function settleItems(created: StaffOrderResponse) {
  return created.items.map((line) => ({ detailId: line.detailId, quantity: line.quantity, amount: line.amount }))
}

export function acceptPayload(created: StaffOrderResponse, staffId: number, idem: string): AcceptPayload {
  return {
    staffId: String(staffId),
    userId: created.userId,
    hostName: created.hostName,
    idem,
    items: settleItems(created).map((line) => ({ ...line, alreadyPaid: false })),
    fullCore: true,
  }
}

/** Vãng lai ⇒ `guest` (PY_GUESS_SERVICE) với `hostName` server trả (`KHACH_TAI_QUAY`). */
export function payRequestPayloadOf(
  created: StaffOrderResponse,
  method: 'cash' | 'deduct',
  staffId: number,
  idem: string,
): PayRequestPayload {
  return {
    staffId,
    userId: created.userId,
    hostName: created.hostName,
    idem,
    paymentMethod: created.anonymous ? 'guest' : method,
    items: settleItems(created),
    fullCore: true,
  }
}

// ---------------------------------------------------------------------------------------------
// Lỗi bước 2 → nút nào được bấm
// ---------------------------------------------------------------------------------------------

/**
 * - `clear`: server TỪ CHỐI rõ ràng (status=0 + `code` nghiệp vụ, hoặc 403 RBAC) — chưa ghi gì.
 * - `ambiguous`: timeout / mất mạng / 5xx / lỗi không có `code` / `db_error` — không biết đã commit chưa.
 * - `manual-fix`: server trả status=1 nhưng phiếu cấn trừ đã ghi mà chưa trừ ví — phiếu ĐÃ ghi.
 */
export type SettleFailureKind = 'clear' | 'ambiguous' | 'manual-fix'

/** MyISAM không rollback ⇒ `db_error` có thể đã ghi dở — coi là mơ hồ, không cho huỷ. */
const AMBIGUOUS_CODES = new Set(['db_error'])

export function classifyStepFailure(error: unknown): SettleFailureKind {
  if (!error || typeof error !== 'object') return 'ambiguous'
  const candidate = error as { name?: unknown; code?: unknown; httpStatus?: unknown }
  if (candidate.name === 'RbacDeniedError') return 'clear'
  if (
    candidate.name === 'ApiError' &&
    typeof candidate.code === 'string' &&
    candidate.code !== '' &&
    !AMBIGUOUS_CODES.has(candidate.code) &&
    typeof candidate.httpStatus === 'number' &&
    candidate.httpStatus < 500
  ) {
    return 'clear'
  }
  return 'ambiguous'
}

export type FailureActions = {
  /** "Thử lại" — LUÔN cùng `idem` (idempotent), an toàn mọi trường hợp. */
  retry: boolean
  /** "Đổi cách thu" — chỉ khi chắc chắn chưa ghi gì và còn cách khác. */
  changeMethod: boolean
  /** "Huỷ đơn" — `/service/cancel` huỷ phiếu BẤT KỂ dòng còn Accept=0 hay không ⇒ cấm khi chưa chắc. */
  cancel: boolean
  /** Vãng lai: đơn treo bị gộp chung userId với khách khác ⇒ gợi ý huỷ thay vì để lại. */
  suggestCancel: boolean
}

export function failureActions(kind: SettleFailureKind, guest: boolean): FailureActions {
  if (kind === 'clear') {
    return { retry: true, changeMethod: !guest, cancel: true, suggestCancel: guest }
  }
  return { retry: true, changeMethod: false, cancel: false, suggestCancel: false }
}

export function describeFailureKind(kind: SettleFailureKind, guest: boolean) {
  switch (kind) {
    case 'clear':
      return guest
        ? 'Máy chủ đã từ chối nên chưa thu tiền. Đơn vãng lai nên được hủy để không bị gộp chung với khách khác.'
        : 'Máy chủ đã từ chối nên chưa ghi gì. Có thể thử lại, đổi cách thu hoặc hủy đơn.'
    case 'ambiguous':
      return 'Chưa biết máy chủ đã ghi hay chưa (mất kết nối hoặc lỗi hệ thống). Chỉ được thử lại — hủy đơn bị khóa để tránh hủy nhầm phiếu đã thu tiền. Đơn vẫn nằm ở danh sách Đơn chờ nếu cần xử lý ở đó.'
    case 'manual-fix':
      return 'Phiếu đã được ghi. Không hủy và không đổi cách thu — chỉ thử lại, hoặc kiểm tra số dư hội viên rồi xử lý thủ công theo nhật ký.'
  }
}
