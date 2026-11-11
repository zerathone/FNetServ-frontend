import { apiGet, apiPost } from './client'
import type { MapLayout, WorkstationMapResponse } from './workstationMapTypes.ts'

// Sơ đồ máy trạm (task ws-map) — CHỈ web. Server: GET/PUT /workstations/map (ServerSide_ai/FNetHttp/WorkstationHandlers.cpp).
// Bố cục JSON do server kiểm lại và chuẩn hóa; GET mọi nhân viên đọc được, ghi chỉ ADMIN.

export { MAP_DECOR_TYPES } from './workstationMapTypes.ts'
export type {
  MapDecorItem,
  MapDecorType,
  MapItem,
  MapLayout,
  MapPcItem,
  WorkstationMapResponse,
} from './workstationMapTypes.ts'

export const WORKSTATION_MAP_QUERY_KEY = ['workstation-map'] as const

export function getWorkstationMap() {
  return apiGet<WorkstationMapResponse>('/workstations/map')
}

/** Chỉ ADMIN. Lỗi `MAP_CONFLICT` (HTTP 409) = có người vừa lưu sơ đồ khác. */
export function saveWorkstationMap(payload: { rev: number; layout: MapLayout }) {
  // Server nhận cả PUT lẫn POST; dùng POST để đi chung đường mock của apiPost.
  return apiPost<{ rev: number }, typeof payload>('/workstations/map', payload)
}