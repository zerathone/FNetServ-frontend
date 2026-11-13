// Kiểu + hằng của sơ đồ máy trạm (task ws-map). TÁCH khỏi workstationMap.ts (có import client/vite) để mô hình thuần
// `features/workstations/map/mapModel.ts` chạy được dưới `node --test` — file này KHÔNG import gì.

/** Đồ vật / dấu mốc KHÔNG có trạng thái (chỉ để làm mốc trên sơ đồ). Đồng bộ với `DecorTypes()` ở core/ws_map_layout.h. */
export const MAP_DECOR_TYPES = [
  'wall_h',
  'wall_v',
  // Tường chữ L (2 nhánh) và chữ T (3 nhánh) — hậu tố là các HƯỚNG nhánh nối ra: n=lên, e=phải, s=xuống, w=trái.
  'wall_l_se', // ┌
  'wall_l_sw', // ┐
  'wall_l_ne', // └
  'wall_l_nw', // ┘
  'wall_t_esw', // ┬
  'wall_t_new', // ┴
  'wall_t_nes', // ├
  'wall_t_nsw', // ┤
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

/**
 * Phông chữ của nhãn — CHỈ các phông có sẵn trên Windows và hiển thị đủ tiếng Việt. Khóa ngắn lưu trong bố cục,
 * tên CSS thật nằm ở `LABEL_FONT_CSS` (mapModel.ts). Đồng bộ với `LabelFonts()` ở core/ws_map_layout.h.
 */
export const MAP_LABEL_FONTS = ['default', 'arial', 'tahoma', 'segoe', 'times', 'courier'] as const
export type MapLabelFont = (typeof MAP_LABEL_FONTS)[number]

/** Giới hạn của nhãn — khớp server (core/ws_map_layout.h: kMaxLabelChars / kLabelSizeMin / kLabelSizeMax). */
export const MAP_LABEL_LIMITS = { maxChars: 60, sizeMin: 8, sizeMax: 48 } as const

export type MapPcItem = { t: 'pc'; host: string; c: number; r: number }
export type MapDecorItem = { t: MapDecorType; c: number; r: number }
/**
 * Nhãn chữ tự gõ (task ws-map-label). Neo ở MỘT ô, chữ được tràn ra hai bên (không chiếm thêm ô).
 *   - `color`: '#rrggbb'; KHÔNG có = màu chữ theo giao diện sáng/tối.
 *   - `font`: thiếu = 'default' (phông của ứng dụng).
 *   - `size`: cỡ chữ (px) ở mức zoom 100% của trình chỉnh sửa; co giãn theo ô khi zoom / ở màn thu ngân.
 */
export type MapLabelItem = {
  t: 'label'
  c: number
  r: number
  text: string
  color?: string
  font?: MapLabelFont
  size?: number
}
export type MapItem = MapPcItem | MapDecorItem | MapLabelItem

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