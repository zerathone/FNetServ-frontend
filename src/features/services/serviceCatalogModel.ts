import type {
  PendingOrder,
  ServiceGroupRow,
  ServiceGroupSaveBody,
  ServiceSaveBody,
} from '../../api/serviceCatalog.ts'
import type { ServiceItem } from '../../api/services.ts'

// Hàm thuần cho trang danh mục dịch vụ (thêm/sửa/ngừng bán + nhóm). Không import `client` — chạy được
// bằng `node --test`. Server là lớp kiểm cuối; ở đây chỉ chặn sớm cho người dùng đỡ gửi request hỏng.

/** Mã quyền (cùng bảng mã với Qt/iCafe — FNet RBAC dùng chung). */
export const RIGHT_SERVICE_ADD = 61
export const RIGHT_SERVICE_EDIT = 62
export const RIGHT_SERVICE_DISABLE = 63
export const RIGHT_SERVICE_GROUP = 66

export const NAME_MAX = 50
export const PRICE_MAX = 999_999_999
export const SORT_ORDER_MAX = 255

export const GROUP_TYPE_NORMAL = 0
export const GROUP_TYPE_TOPPING = 2

/** iCafe cấm tên này (dòng hệ thống FFOOD — FNet tra theo tên). */
const RESERVED_NAME = 'FFOOD'

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
// Cột `utf8` 3 byte + MySQL không strict ⇒ ký tự ngoài BMP (emoji) bị cắt ngầm; server cũng chặn.
const NON_BMP = /[\ud800-\udbff][\udc00-\udfff]/

export function validateCatalogName(raw: string, label = 'Tên'): string | null {
  const name = raw.trim()
  if (!name) return `${label} không được để trống.`
  if (name.length > NAME_MAX) return `${label} tối đa ${NAME_MAX} ký tự.`
  if (CONTROL_CHARS.test(name)) return `${label} không được chứa ký tự điều khiển.`
  if (NON_BMP.test(name)) return `${label} không được chứa biểu tượng cảm xúc/ký tự đặc biệt.`
  return null
}

export function validateServiceName(raw: string): string | null {
  const error = validateCatalogName(raw, 'Tên dịch vụ')
  if (error) return error
  if (raw.trim().toUpperCase() === RESERVED_NAME) return `Tên [${raw.trim()}] là tên hệ thống, vui lòng chọn tên khác.`
  return null
}

/**
 * Giá nguyên đồng. Chấp nhận "15000" và "15.000" (dấu chấm nghìn kiểu Việt); từ chối số lẻ, âm, chữ,
 * dấu phẩy — "15,5" mà tự bỏ dấu sẽ thành 155đ, sai tiền mà không báo lỗi.
 */
export function parsePrice(input: string): number | null {
  const text = input.trim()
  if (/^\d{1,9}$/.test(text)) return Number(text)
  if (/^\d{1,3}(\.\d{3}){1,2}$/.test(text)) {
    const value = Number(text.replace(/\./g, ''))
    return value <= PRICE_MAX ? value : null
  }
  return null
}

/** Số nguyên không âm (cảnh báo tồn, thứ tự nhóm). */
export function parseNonNegativeInt(input: string, max = 9_999_999): number | null {
  const text = input.trim()
  if (!/^\d{1,9}$/.test(text)) return null
  const value = Number(text)
  return value <= max ? value : null
}

// ---------------------------------------------------------------------------------------------
// Dịch vụ
// ---------------------------------------------------------------------------------------------

export type ServiceDraft = {
  name: string
  price: string
  unitId: number
  groupId: number
  inventoryManagement: boolean
  /** Chuỗi nhập; rỗng = không đặt mức cảnh báo. */
  warning: string
  /** Chỉ dùng khi tạo. */
  active: boolean
}

export function emptyServiceDraft(): ServiceDraft {
  return { name: '', price: '', unitId: 0, groupId: 0, inventoryManagement: false, warning: '', active: true }
}

/** Mức cảnh báo đưa vào ô nhập: `<= 0` (gồm -1 của Qt cũ) = không cảnh báo ⇒ ô trống. */
export function warningToInput(value: number | undefined): string {
  return value !== undefined && value > 0 ? String(value) : ''
}

export function draftFromService(service: ServiceItem): ServiceDraft {
  return {
    name: service.name,
    price: String(service.price),
    unitId: service.unitId ?? 0,
    groupId: service.groupId ?? 0,
    inventoryManagement: service.inventoryManagement === 1,
    warning: warningToInput(service.warningInventory),
    active: service.active !== 0,
  }
}

export function validateServiceDraft(draft: ServiceDraft): string | null {
  const nameError = validateServiceName(draft.name)
  if (nameError) return nameError
  if (parsePrice(draft.price) === null) return `Giá phải là số nguyên từ 0 đến ${PRICE_MAX.toLocaleString('vi-VN')}.`
  if (draft.groupId <= 0) return 'Cần chọn nhóm dịch vụ.'
  if (draft.inventoryManagement && draft.warning.trim() !== '' && parseNonNegativeInt(draft.warning) === null) {
    return 'Mức cảnh báo tồn phải là số nguyên không âm.'
  }
  return null
}

/**
 * Body gửi server. Sửa: `active` KHÔNG gửi (Q7 — ngừng bán/bán lại chỉ qua set-active). `unitId` chỉ gửi
 * khi biết (server cũ không trả `unitId` ⇒ không ghi đè đơn vị bằng 0). `warningInventory`: ô trống ⇒ `0`,
 * trừ khi DB đang là giá trị âm của Qt cũ (-1) và người dùng không đụng tới ⇒ không gửi để giữ nguyên.
 */
export function serviceSaveBody(
  draft: ServiceDraft,
  original: ServiceItem | null,
): ServiceSaveBody {
  const body: ServiceSaveBody = {
    name: draft.name.trim(),
    price: parsePrice(draft.price) ?? 0,
    groupId: draft.groupId,
    inventoryManagement: draft.inventoryManagement,
  }
  if (original) {
    body.serviceId = original.id
    if (original.unitId !== undefined || draft.unitId > 0) body.unitId = draft.unitId
  } else {
    body.unitId = draft.unitId
    body.active = draft.active
  }
  if (draft.inventoryManagement) {
    const warning = draft.warning.trim()
    if (warning !== '') body.warningInventory = parseNonNegativeInt(warning) ?? 0
    else if (!original || (original.warningInventory ?? 0) >= 0) body.warningInventory = 0
  }
  return body
}

export function isReadonlyService(service: Pick<ServiceItem, 'readonly'>): boolean {
  return service.readonly === true
}

export function isDiscontinued(service: Pick<ServiceItem, 'active'>): boolean {
  return service.active === 0
}

/** Cờ quản lý tồn có đổi so với DB không — chỉ khi đổi server mới xét tồn/đơn treo. */
export function inventoryFlagChanged(original: ServiceItem | null, draft: ServiceDraft): boolean {
  if (!original) return false
  return (original.inventoryManagement === 1) !== draft.inventoryManagement
}

// ---------------------------------------------------------------------------------------------
// Nhóm
// ---------------------------------------------------------------------------------------------

export type GroupChoices = {
  normal: ServiceGroupRow[]
  topping: ServiceGroupRow[]
}

/**
 * Ô chọn nhóm của món: chỉ nhóm đang dùng, chia Nhóm thường / Nhóm topping. Nhóm hiện tại của món vẫn
 * được liệt kê dù đã ngừng dùng (server cho giữ nguyên nhóm cũ, chỉ chặn đổi SANG nhóm ngừng dùng).
 */
export function groupChoices(groups: readonly ServiceGroupRow[], currentGroupId = 0): GroupChoices {
  const keep = groups
    .filter((group) => group.active === 1 || group.groupId === currentGroupId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }))
  return {
    normal: keep.filter((group) => group.typeId !== GROUP_TYPE_TOPPING),
    topping: keep.filter((group) => group.typeId === GROUP_TYPE_TOPPING),
  }
}

export function groupTypeLabel(typeId: number): string {
  return typeId === GROUP_TYPE_TOPPING ? 'Nhóm topping' : 'Nhóm thường'
}

/** Đổi loại nhóm bị khoá khi nhóm còn món (Q10) — kể cả món ngừng bán. */
export function groupTypeLocked(group: Pick<ServiceGroupRow, 'serviceCount'> | null): boolean {
  return group !== null && group.serviceCount > 0
}

export type GroupDraft = { name: string; sortOrder: string; typeId: 0 | 2 }

export function draftFromGroup(group: ServiceGroupRow | null, nextOrder = 0): GroupDraft {
  return group
    ? { name: group.name, sortOrder: String(group.sortOrder), typeId: group.typeId === GROUP_TYPE_TOPPING ? 2 : 0 }
    : { name: '', sortOrder: String(nextOrder), typeId: 0 }
}

export function nextGroupOrder(groups: readonly ServiceGroupRow[]): number {
  return Math.min(SORT_ORDER_MAX, groups.reduce((max, group) => Math.max(max, group.sortOrder), 0) + 1)
}

export function validateGroupDraft(draft: GroupDraft): string | null {
  const nameError = validateCatalogName(draft.name, 'Tên nhóm')
  if (nameError) return nameError
  if (parseNonNegativeInt(draft.sortOrder, SORT_ORDER_MAX) === null) {
    return `Thứ tự hiển thị phải là số nguyên từ 0 đến ${SORT_ORDER_MAX}.`
  }
  return null
}

/**
 * Body nhóm. Sửa: chỉ gửi `typeId` khi đổi thật — nhóm sẵn có với loại lạ (≠ 0/2) hoặc nhóm còn món không
 * bị ghi đè loại.
 */
export function groupSaveBody(draft: GroupDraft, original: ServiceGroupRow | null): ServiceGroupSaveBody {
  const body: ServiceGroupSaveBody = {
    name: draft.name.trim(),
    sortOrder: parseNonNegativeInt(draft.sortOrder, SORT_ORDER_MAX) ?? 0,
  }
  if (!original) {
    body.typeId = draft.typeId
    return body
  }
  body.groupId = original.groupId
  const originalType = original.typeId === GROUP_TYPE_TOPPING ? 2 : 0
  if (draft.typeId !== originalType) body.typeId = draft.typeId
  return body
}

// ---------------------------------------------------------------------------------------------
// Lỗi từ server
// ---------------------------------------------------------------------------------------------

type ErrorLike = { message?: string; code?: string; details?: unknown }

export type PendingOrdersInfo = { total: number; orders: PendingOrder[] }

/** `pending_orders` ⇒ danh sách đơn treo để chỉ cho người dùng; mã lỗi khác ⇒ null. */
export function pendingOrdersOf(error: unknown): PendingOrdersInfo | null {
  const e = (error ?? {}) as ErrorLike
  if (e.code !== 'pending_orders') return null
  const details = (e.details ?? {}) as { total?: unknown; orders?: unknown }
  const orders = Array.isArray(details.orders) ? (details.orders as PendingOrder[]) : []
  const total = typeof details.total === 'number' ? details.total : orders.length
  return { total, orders }
}

/** Server đã viết thông báo tiếng Việt đầy đủ ⇒ hiển thị nguyên văn; chỉ thay khi thiếu. */
export function describeCatalogError(error: unknown): string {
  const e = (error ?? {}) as ErrorLike
  return e.message || 'Không thực hiện được, thử lại sau.'
}

export function pendingOrderStatus(order: Pick<PendingOrder, 'accept'>): string {
  return order.accept === 1 ? 'Đã duyệt, chưa thu tiền' : 'Chờ duyệt'
}
