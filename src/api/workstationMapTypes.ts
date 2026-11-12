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

/**
 * Thiết lập của sơ đồ, gom theo NHÓM (mỗi nhóm là một object) để thêm thuộc tính mới không phải đổi cấu trúc cũ:
 *   - thêm trường vào nhóm có sẵn: sửa kiểu nhóm đó + DEFAULT_MAP_SETTINGS + resolveMapSettings (mapModel.ts)
 *     + whitelist ở server (core/ws_map_layout.h, detail::CanonicalizeSettings);
 *   - thêm nhóm mới (vd `grid`, `status`): thêm khóa mới vào MapSettings theo đúng bốn chỗ trên.
 * Mọi trường đều CÓ MẶC ĐỊNH — bố cục cũ (chưa có `settings`) chạy y như trước khi có thiết lập.
 */
export type MapCashierSettings = {
  /** Thu ngân có dùng sơ đồ không. Tắt = trang Máy trạm luôn hiện lưới phẳng; sơ đồ đã vẽ vẫn được giữ. */
  enabled: boolean
}

export type MapSettings = {
  cashier: MapCashierSettings
}

export type MapLayout = {
  v: 1
  cols: number
  rows: number
  items: MapItem[]
  /** Server cũ / bố cục cũ không có trường này ⇒ dùng mặc định (xem `resolveMapSettings`). */
  settings?: MapSettings
}

export type WorkstationMapResponse = {
  exists: boolean
  /** Phiên bản đã đọc; gửi lại khi lưu để server phát hiện hai người cùng sửa (0 = chưa có sơ đồ). */
  rev: number
  updatedAt?: string
  updatedBy?: number
  layout: MapLayout | null
}