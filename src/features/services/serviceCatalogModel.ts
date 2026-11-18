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
  const error = validateCatalogName(raw, 'Tên mặt hàng')
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

/** VAT: `-1` = chưa khai báo / KHÔNG áp dụng thuế; `0` = thuế 0% (vẫn gửi sang bên thuế). Hai giá trị riêng. */
export const VAT_NONE = -1
export const VAT_MAX = 100
export function isValidVat(value: number): boolean {
  return Number.isInteger(value) && value >= VAT_NONE && value <= VAT_MAX
}

/**
 * Ô nhập VAT (người dùng tự gõ — không có danh sách mức thuế đặt sẵn): để TRỐNG = không áp dụng thuế (-1);
 * số nguyên 0..VAT_MAX = mức thuế (0 = thuế 0%, khác "không áp dụng"). Sai định dạng ⇒ null.
 */
export function parseVatInput(input: string): number | null {
  const text = input.trim()
  if (text === '') return VAT_NONE
  if (!/^\d{1,3}$/.test(text)) return null
  const value = Number(text)
  return value <= VAT_MAX ? value : null
}

/** Giá trị VAT của món → nội dung ô nhập (-1 ⇒ ô trống). */
export function vatToInput(value: number): string {
  return value === VAT_NONE || !isValidVat(value) ? '' : String(value)
}

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
  /** Nội dung ô VAT (xem parseVatInput): rỗng = không áp dụng thuế. */
  vat: string
}

export function emptyServiceDraft(): ServiceDraft {
  return {
    name: '',
    price: '',
    unitId: 0,
    groupId: 0,
    inventoryManagement: false,
    warning: '',
    active: true,
    vat: '',
  }
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
    vat: vatToInput(service.vatPercent ?? VAT_NONE),
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
  if (parseVatInput(draft.vat) === null) return `VAT để trống (không áp dụng thuế) hoặc nhập số nguyên từ 0 đến ${VAT_MAX}.`
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
  // VAT: sửa chỉ gửi khi đổi thật và server có trả `vatPercent` (server cũ/DB thiếu cột ⇒ không gửi, tránh `unsupported`);
  // thêm mới chỉ gửi khi khác -1 (DB mặc định -1) để DB chưa có cột VAT vẫn thêm món được.
  const vat = parseVatInput(draft.vat) ?? VAT_NONE
  if (original) {
    if (original.vatPercent !== undefined && vat !== original.vatPercent) body.vatPercent = vat
  } else if (vat !== VAT_NONE) {
    body.vatPercent = vat
  }
  return body
}

// ---------------------------------------------------------------------------------------------
// Ảnh món — giới hạn chốt 2026-11-17: PNG/JPEG, ≤ 600×600 px, ≤ 2MB (server kiểm lại, thư mục chung iCafe)
// ---------------------------------------------------------------------------------------------

export const IMAGE_MAX_SIDE = 600
export const IMAGE_MAX_BYTES = 2 * 1024 * 1024
export const IMAGE_TYPES = ['image/png', 'image/jpeg'] as const

/** Kích thước sau khi thu nhỏ để vừa khung `max`×`max` (giữ tỉ lệ; ảnh nhỏ hơn giữ nguyên, không phóng to). */
export function fitWithin(width: number, height: number, max = IMAGE_MAX_SIDE): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 }
  if (width <= max && height <= max) return { width, height }
  const scale = max / Math.max(width, height)
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** Số byte thật sau khi giải mã của một chuỗi `data:...;base64,XXXX` (không giải mã ra bộ nhớ). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',')
  const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding)
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
  return typeId === GROUP_TYPE_TOPPING ? 'Nhóm kèm thêm' : 'Nhóm thường'
}

/** Đổi loại nhóm bị khoá khi nhóm còn món (Q10) — kể cả món ngừng bán. */
export function groupTypeLocked(group: Pick<ServiceGroupRow, 'serviceCount'> | null): boolean {
  return group !== null && group.serviceCount > 0
}

/** Form thêm/sửa nhóm không còn ô thứ tự — thứ tự đổi bằng nút lên/xuống trong danh sách. */
export type GroupDraft = { name: string; typeId: 0 | 2 }

export function draftFromGroup(group: ServiceGroupRow | null): GroupDraft {
  return group
    ? { name: group.name, typeId: group.typeId === GROUP_TYPE_TOPPING ? 2 : 0 }
    : { name: '', typeId: 0 }
}

/** Thứ tự của nhóm mới = cuối danh sách (lớn nhất hiện có + 1, tối đa SORT_ORDER_MAX). */
export function nextGroupOrder(groups: readonly ServiceGroupRow[]): number {
  return Math.min(SORT_ORDER_MAX, groups.reduce((max, group) => Math.max(max, group.sortOrder), 0) + 1)
}

/** Thứ tự hiển thị nhóm: theo `sortOrder`, trùng thì theo tên (khớp ô chọn nhóm của món). */
export function compareGroups(a: ServiceGroupRow, b: ServiceGroupRow): number {
  return a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'vi', { numeric: true }) || a.groupId - b.groupId
}

export type GroupOrderUpdate = { groupId: number; name: string; sortOrder: number }

/**
 * Kế hoạch đổi chỗ nhóm `groupId` lên (-1) / xuống (+1) một vị trí trong danh sách đã sắp theo `compareGroups`.
 * `sortOrder` đang khác nhau hết → chỉ đổi giá trị cho 2 nhóm kề nhau. Có nhóm trùng `sortOrder` (nhóm cũ hay
 * để toàn 0) → đánh lại 1..N theo thứ tự đang thấy, chỉ gửi nhóm có giá trị đổi. Trả `[]` khi không di chuyển được.
 */
export function planGroupMove(groups: readonly ServiceGroupRow[], groupId: number, direction: -1 | 1): GroupOrderUpdate[] {
  const list = [...groups].sort(compareGroups)
  const from = list.findIndex((group) => group.groupId === groupId)
  const to = from + direction
  if (from < 0 || to < 0 || to >= list.length) return []
  const a = list[from]
  const b = list[to]

  const hasDuplicate = new Set(list.map((group) => group.sortOrder)).size !== list.length
  if (!hasDuplicate) {
    return [
      { groupId: a.groupId, name: a.name, sortOrder: b.sortOrder },
      { groupId: b.groupId, name: b.name, sortOrder: a.sortOrder },
    ]
  }
  ;[list[from], list[to]] = [b, a]
  const updates: GroupOrderUpdate[] = []
  list.forEach((group, index) => {
    const sortOrder = Math.min(SORT_ORDER_MAX, index + 1)
    if (group.sortOrder !== sortOrder) updates.push({ groupId: group.groupId, name: group.name, sortOrder })
  })
  return updates
}

export function validateGroupDraft(draft: GroupDraft): string | null {
  return validateCatalogName(draft.name, 'Tên nhóm')
}

/**
 * Body nhóm. Thêm: `sortOrder` = cuối danh sách (`nextOrder`). Sửa: giữ nguyên thứ tự cũ; chỉ gửi `typeId`
 * khi đổi thật — nhóm sẵn có với loại lạ (≠ 0/2) hoặc nhóm còn món không bị ghi đè loại.
 */
export function groupSaveBody(draft: GroupDraft, original: ServiceGroupRow | null, nextOrder = 0): ServiceGroupSaveBody {
  const body: ServiceGroupSaveBody = {
    name: draft.name.trim(),
    sortOrder: original ? original.sortOrder : nextOrder,
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
