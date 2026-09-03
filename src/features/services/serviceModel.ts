import type { ServiceItem } from '../../api/services.ts'

export type ServiceStockFilter = 'all' | 'available' | 'out' | 'not-managed'

export function serviceStockLabel(service: ServiceItem) {
  if (service.inventoryManagement !== 1) {
    return { label: 'Không quản lý tồn', tone: 'neutral' as const }
  }
  if (service.inventory <= 0) {
    return { label: 'Hết tồn', tone: 'danger' as const }
  }
  return { label: 'Còn tồn', tone: 'success' as const }
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
