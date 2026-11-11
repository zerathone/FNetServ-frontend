// Kiểu + hằng của sơ đồ máy trạm (task ws-map). TÁCH khỏi workstationMap.ts (có import client/vite) để mô hình thuần
// `features/workstations/map/mapModel.ts` chạy được dưới `node --test` — file này KHÔNG import gì.

/** Đồ vật / dấu mốc KHÔNG có trạng thái (chỉ để làm mốc trên sơ đồ). Đồng bộ với `DecorTypes()` ở core/ws_map_layout.h. */
export const MAP_DECOR_TYPES = [
  'wall_h',
  'wall_v',
  'entrance',
  'reception',
  'bar',
  'wc',
  'billiard',
  'table_football',
  'ping_pong',
  'hookah',
  'vr',
  'racing',
  'console',
  'sofa',
  'fire_extinguisher',
] as const

export type MapDecorType = (typeof MAP_DECOR_TYPES)[number]

export type MapPcItem = { t: 'pc'; host: string; c: number; r: number }
export type MapDecorItem = { t: MapDecorType; c: number; r: number }
export type MapItem = MapPcItem | MapDecorItem

export type MapLayout = {
  v: 1
  cols: number
  rows: number
  items: MapItem[]
}

export type WorkstationMapResponse = {
  exists: boolean
  /** Phiên bản đã đọc; gửi lại khi lưu để server phát hiện hai người cùng sửa (0 = chưa có sơ đồ). */
  rev: number
  updatedAt?: string
  updatedBy?: number
  layout: MapLayout | null
}