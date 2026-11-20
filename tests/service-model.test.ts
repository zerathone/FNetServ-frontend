import assert from 'node:assert/strict'
import test from 'node:test'
import type { ServiceItem } from '../src/api/services.ts'
import {
  matchesServiceStock,
  serviceStockLabel,
} from '../src/features/services/serviceModel.ts'

function service(patch: Partial<ServiceItem> = {}): ServiceItem {
  return {
    id: 1,
    name: 'Mì bò',
    price: 30_000,
    unit: 'phần',
    inventory: 10,
    inventoryManagement: 1,
    ...patch,
  }
}

test('lọc tồn kho: Sắp hết = còn hàng nhưng chạm mức cảnh báo, rời với Còn tồn / Hết tồn', () => {
  const low = service({ inventory: 3, warningInventory: 5 })
  assert.equal(serviceStockLabel(low).label, 'Sắp hết')
  assert.equal(matchesServiceStock(low, 'low'), true)
  assert.equal(matchesServiceStock(low, 'available'), false)
  assert.equal(matchesServiceStock(low, 'out'), false)
  // đúng mức cảnh báo vẫn là sắp hết; mức cảnh báo <= 0 hoặc không có = không cảnh báo
  assert.equal(matchesServiceStock(service({ inventory: 5, warningInventory: 5 }), 'low'), true)
  assert.equal(matchesServiceStock(service({ inventory: 3, warningInventory: -1 }), 'low'), false)
  assert.equal(matchesServiceStock(service({ inventory: 3 }), 'low'), false)
  // hết tồn thắng sắp hết; không quản lý tồn không bao giờ vào nhóm nào của tồn
  assert.equal(matchesServiceStock(service({ inventory: 0, warningInventory: 5 }), 'low'), false)
  assert.equal(matchesServiceStock(service({ inventory: 0, warningInventory: 5 }), 'out'), true)
  assert.equal(matchesServiceStock(service({ inventoryManagement: 0, inventory: 1, warningInventory: 5 }), 'low'), false)
})

test('service stock states do not invent a low-stock threshold', () => {
  assert.equal(serviceStockLabel(service()).label, 'Còn tồn')
  assert.equal(serviceStockLabel(service({ inventory: 0 })).label, 'Hết tồn')
  assert.equal(
    serviceStockLabel(service({ inventoryManagement: 0 })).label,
    'Không quản lý tồn',
  )
  assert.equal(matchesServiceStock(service(), 'available'), true)
  assert.equal(
    matchesServiceStock(service({ inventory: 0 }), 'out'),
    true,
  )
})
