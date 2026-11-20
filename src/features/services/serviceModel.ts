import type { ServiceItem } from '../../api/services.ts'

export type ServiceStockState = 'available' | 'low' | 'out' | 'not-managed'
export type ServiceStockFilter = 'all' | ServiceStockState

/**
 * Bốn nhóm tồn kho RỜI NHAU của món (cùng quy tắc với nhãn trong bảng và với nguyên liệu):
 * - không quản lý tồn ⇒ `not-managed`;
 * - tồn <= 0 ⇒ `out` (Hết tồn);
 * - tồn <= mức cảnh báo ⇒ `low` (Sắp hết; `warningInventory` <= 0 hoặc `undefined` = không cảnh báo, như Qt cũ ghi -1);
 * - còn lại ⇒ `available` (Còn tồn, chưa chạm mức cảnh báo).
 */
export function serviceStockState(service: ServiceItem): ServiceStockState {
  if (service.inventoryManagement !== 1) return 'not-managed'
  if (service.inventory <= 0) return 'out'
  const warning = service.warningInventory ?? 0
  if (warning > 0 && service.inventory <= warning) return 'low'
  return 'available'
}

/**
 * Nhãn tồn kho của món: không quản lý tồn ⇒ neutral, không chấm tròn (không phải "trạng thái" tồn);
 * hết tồn ⇒ danger; sắp hết ⇒ warning; còn tồn ⇒ success.
 */
export function serviceStockLabel(service: ServiceItem) {
  switch (serviceStockState(service)) {
    case 'not-managed':
      return { label: 'Không quản lý tồn', tone: 'neutral' as const, dot: false }
    case 'out':
      return { label: 'Hết tồn', tone: 'danger' as const, dot: true }
    case 'low':
      return { label: 'Sắp hết', tone: 'warning' as const, dot: true }
    default:
      return { label: 'Còn tồn', tone: 'success' as const, dot: true }
  }
}

export function matchesServiceStock(service: ServiceItem, filter: ServiceStockFilter) {
  return filter === 'all' || serviceStockState(service) === filter
}
