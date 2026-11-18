import type { ServiceItem } from '../../api/services.ts'

export type ServiceStockFilter = 'all' | 'available' | 'out' | 'not-managed'

/**
 * Nhãn tồn kho của món:
 * - không quản lý tồn ⇒ neutral, không chấm tròn (không phải "trạng thái" tồn);
 * - tồn <= 0 ⇒ danger "Hết tồn";
 * - tồn <= mức cảnh báo ⇒ warning "Sắp hết" (`warningInventory` <= 0 hoặc `undefined` = không cảnh báo, như Qt cũ ghi -1);
 * - còn lại ⇒ success "Còn tồn".
 */
export function serviceStockLabel(service: ServiceItem) {
  if (service.inventoryManagement !== 1) {
    return { label: 'Không quản lý tồn', tone: 'neutral' as const, dot: false }
  }
  if (service.inventory <= 0) {
    return { label: 'Hết tồn', tone: 'danger' as const, dot: true }
  }
  const warning = service.warningInventory ?? 0
  if (warning > 0 && service.inventory <= warning) {
    return { label: 'Sắp hết', tone: 'warning' as const, dot: true }
  }
  return { label: 'Còn tồn', tone: 'success' as const, dot: true }
}

export function matchesServiceStock(
  service: ServiceItem,
  filter: ServiceStockFilter,
) {
  switch (filter) {
    case 'available':
      return service.inventoryManagement === 1 && service.inventory > 0
    case 'out':
      return service.inventoryManagement === 1 && service.inventory <= 0
    case 'not-managed':
      return service.inventoryManagement !== 1
    default:
      return true
  }
}
