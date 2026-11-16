import { apiPost } from './client'

// task service-catalog — ghi danh mục dịch vụ + nhóm dịch vụ. Tách khỏi `api/services.ts` vì model có
// unit test import file đó và không được kéo theo `client`.
// Không có route xoá: "xoá" = ngừng bán (`Active=0`), bật lại được. Không gửi chuỗi `Unit` — luôn `unitId`.

export type ServiceSaveBody = {
  /** Trống/0 = thêm mới (quyền 61), có = sửa (quyền 62). */
  serviceId?: number
  name: string
  price: number
  unitId?: number
  groupId: number
  /** CHỈ có tác dụng khi tạo (mặc định true). Sửa thì server bỏ qua — ngừng bán/bán lại chỉ qua `set-active`. */
  active?: boolean
  inventoryManagement?: boolean
  warningInventory?: number
}

export function saveService(body: ServiceSaveBody) {
  return apiPost<{ serviceId: number; created: boolean }, ServiceSaveBody>('/service/catalog/save', body)
}

/** `active=false` = "Ngừng bán" (quyền 63), `true` = "Bán lại" (quyền 62). Idempotent. */
export function setServiceActive(body: { serviceId: number; active: boolean }) {
  return apiPost<{ serviceId: number; active: boolean | number }, typeof body>('/service/catalog/set-active', body)
}

export type ServiceGroupRow = {
  groupId: number
  name: string
  sortOrder: number
  active: number
  /** 0 = nhóm thường, 2 = nhóm topping. */
  typeId: number
  /** Đếm mọi món trỏ tới nhóm, kể cả món ngừng bán. */
  serviceCount: number
}

export function getServiceGroups() {
  return apiPost<{ supported: boolean; rows: ServiceGroupRow[] }, Record<string, never>>('/service/group/list', {})
}

export type ServiceGroupSaveBody = {
  /** Trống/0 = thêm nhóm. */
  groupId?: number
  name: string
  sortOrder?: number
  active?: boolean
  typeId?: 0 | 2
}

export function saveServiceGroup(body: ServiceGroupSaveBody) {
  return apiPost<{ groupId: number; created: boolean }, ServiceGroupSaveBody>('/service/group/save', body)
}

/** Không chặn khi nhóm còn món (parity iCafe) — món trong nhóm ngừng dùng biến khỏi menu bán. */
export function setServiceGroupActive(body: { groupId: number; active: boolean }) {
  return apiPost<{ groupId: number; active: boolean | number }, typeof body>('/service/group/set-active', body)
}

/** Một đơn còn treo của món — server trả kèm lỗi `pending_orders` (tối đa 50 dòng + `total`). */
export type PendingOrder = {
  serviceDetailId: number
  voucherId: number
  userId: number
  userName: string
  serviceId: number
  serviceName: string
  quantity: number
  serviceAmount: number
  accept: number
  servicePaid: number
  serviceDate: string
  serviceTime: string
}
