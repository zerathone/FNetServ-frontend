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
