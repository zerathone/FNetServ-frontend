import {
  MAP_DECOR_TYPES,
  type MapDecorType,
  type MapItem,
  type MapLayout,
  type MapPcItem,
  type MapSettings,
} from '../../../api/workstationMapTypes.ts'

// Mô hình thuần (không React) của sơ đồ máy trạm: đặt / dời / xóa / đổi cỡ lưới / xếp tự động.
// Mọi hàm TRẢ BẢN MỚI, không sửa tại chỗ. Giới hạn khớp server (core/ws_map_layout.h) — server vẫn kiểm lại tất cả.

export const MAP_LIMITS = { maxCols: 60, maxRows: 40, maxItems: 1500 } as const
export const MAP_DEFAULT_COLS = 20
export const MAP_DEFAULT_ROWS = 12

export type DecorGroup = 'structure' | 'furniture' | 'game'

export type DecorDef = { type: MapDecorType; label: string; group: DecorGroup }

/** Tường chữ L / chữ T: kiểu `wall_<l|t>_<hướng nhánh>` (n/e/s/w). Vẽ bằng CSS như tường thẳng, không phải icon. */
export type WallPieceType = Extract<MapDecorType, `wall_l_${string}` | `wall_t_${string}`>
export type WallArm = 'n' | 'e' | 's' | 'w'

export function isWallPiece(type: MapDecorType): type is WallPieceType {
  return type.startsWith('wall_l_') || type.startsWith('wall_t_')
}

/** Các nhánh nối ra của mảnh tường (vd `wall_t_esw` → ['e','s','w']). */
export function wallPieceArms(type: WallPieceType): WallArm[] {
  return type.slice(7).split('') as WallArm[]
}

export const DECOR_DEFS: readonly DecorDef[] = [
  { type: 'wall_h', label: 'Tường ngang', group: 'structure' },
  { type: 'wall_v', label: 'Tường dọc', group: 'structure' },
  { type: 'entrance', label: 'Cửa vào', group: 'structure' },
  { type: 'wall_l_se', label: 'Tường chữ L (nối xuống & phải)', group: 'structure' },
  { type: 'wall_l_sw', label: 'Tường chữ L (nối xuống & trái)', group: 'structure' },
  { type: 'wall_l_ne', label: 'Tường chữ L (nối lên & phải)', group: 'structure' },
  { type: 'wall_l_nw', label: 'Tường chữ L (nối lên & trái)', group: 'structure' },
  { type: 'wall_t_esw', label: 'Tường chữ T (nối trái, phải & xuống)', group: 'structure' },
  { type: 'wall_t_new', label: 'Tường chữ T (nối trái, phải & lên)', group: 'structure' },
  { type: 'wall_t_nes', label: 'Tường chữ T (nối lên, xuống & phải)', group: 'structure' },
  { type: 'wall_t_nsw', label: 'Tường chữ T (nối lên, xuống & trái)', group: 'structure' },
  { type: 'reception', label: 'Quầy thu ngân', group: 'furniture' },
  { type: 'bar', label: 'Quầy bar', group: 'furniture' },
  { type: 'wc', label: 'Nhà vệ sinh', group: 'furniture' },
  { type: 'sofa', label: 'Sofa', group: 'furniture' },
  { type: 'fire_extinguisher', label: 'Bình chữa cháy', group: 'furniture' },
  { type: 'billiard', label: 'Bi-a', group: 'game' },
  { type: 'table_football', label: 'Bóng đá bàn', group: 'game' },
  { type: 'ping_pong', label: 'Bóng bàn', group: 'game' },
  { type: 'hookah', label: 'Hookah', group: 'game' },
  { type: 'vr', label: 'VR', group: 'game' },
  { type: 'racing', label: 'Đua xe', group: 'game' },
  { type: 'console', label: 'Console', group: 'game' },
]

export const DECOR_GROUP_LABEL: Record<DecorGroup, string> = {
  structure: 'Tường & cửa',
  furniture: 'Quầy & tiện ích',
  game: 'Giải trí',
}

export const DECOR_LABEL: Record<MapDecorType, string> = Object.fromEntries(
  DECOR_DEFS.map((def) => [def.type, def.label]),
) as Record<MapDecorType, string>

export function emptyLayout(cols = MAP_DEFAULT_COLS, rows = MAP_DEFAULT_ROWS): MapLayout {
  return { v: 1, cols, rows, items: [], settings: DEFAULT_MAP_SETTINGS }
}

// ----- thiết lập sơ đồ (layout.settings) -----

/** Mặc định = hành vi trước khi có thiết lập: quán đã vẽ sơ đồ thì thu ngân dùng sơ đồ. */
export const DEFAULT_MAP_SETTINGS: MapSettings = { cashier: { enabled: true } }

/**
 * Đọc `settings` một cách phòng thủ, TỪNG trường một: thiếu / sai kiểu ⇒ giá trị mặc định (không làm hỏng cả sơ đồ).
 * Chỉ giữ trường đã biết — thêm trường mới thì thêm vào đây.
 */
export function resolveMapSettings(raw: unknown): MapSettings {
  const root = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const cashier = root.cashier && typeof root.cashier === 'object' ? (root.cashier as Record<string, unknown>) : {}
  return {
    cashier: {
      enabled: typeof cashier.enabled === 'boolean' ? cashier.enabled : DEFAULT_MAP_SETTINGS.cashier.enabled,
    },
  }
}

/** Thiết lập đã điền đủ mặc định của một bố cục (bố cục cũ chưa có `settings` vẫn dùng được). */
export function settingsOf(layout: MapLayout): MapSettings {
  return resolveMapSettings(layout.settings)
}

/** Sửa thiết lập: nhận hàm biến đổi bản đầy đủ → trả bố cục mới; không đổi gì ⇒ trả nguyên bản cũ. */
export function updateSettings(layout: MapLayout, change: (settings: MapSettings) => MapSettings): MapLayout {
  const current = settingsOf(layout)
  const next = resolveMapSettings(change(current))
  if (JSON.stringify(next) === JSON.stringify(current) && layout.settings) return layout
  return { ...layout, settings: next }
}

/** Thu ngân có dùng sơ đồ này không (cờ `settings.cashier.enabled`). */
export function isCashierMapEnabled(layout: MapLayout): boolean {
  return settingsOf(layout).cashier.enabled
}

export function isPc(item: MapItem): item is MapPcItem {
  return item.t === 'pc'
}

export function cellKey(c: number, r: number) {
  return `${c},${r}`
}

/** Tên máy so sánh KHÔNG phân biệt hoa thường (server cũng vậy). */
export function hostKey(host: string) {
  return host.toUpperCase()
}

export function itemAt(layout: MapLayout, c: number, r: number): MapItem | undefined {
  return layout.items.find((item) => item.c === c && item.r === r)
}

export function inBounds(layout: MapLayout, c: number, r: number) {
  return Number.isInteger(c) && Number.isInteger(r) && c >= 0 && r >= 0 && c < layout.cols && r < layout.rows
}

export function placedHosts(layout: MapLayout): Set<string> {
  const hosts = new Set<string>()
  for (const item of layout.items) if (isPc(item)) hosts.add(hostKey(item.host))
  return hosts
}

/** Máy đã có trong danh sách quán nhưng CHƯA có trên sơ đồ — giữ thứ tự gốc. */
export function unplacedHosts(layout: MapLayout, allHosts: readonly string[]): string[] {
  const placed = placedHosts(layout)
  return allHosts.filter((host) => !placed.has(hostKey(host)))
}

/** Đặt một phần tử vào ô TRỐNG. Ô đã có phần tử / ngoài lưới / vượt giới hạn / máy đã đặt ⇒ trả nguyên bản cũ. */
export function placeItem(layout: MapLayout, item: MapItem): MapLayout {
  if (!inBounds(layout, item.c, item.r)) return layout
  if (layout.items.length >= MAP_LIMITS.maxItems) return layout
  if (itemAt(layout, item.c, item.r)) return layout
  if (isPc(item) && placedHosts(layout).has(hostKey(item.host))) return layout
  return { ...layout, items: [...layout.items, item] }
}

/** Dời phần tử tại (c,r) sang ô TRỐNG khác. */
export function moveItem(layout: MapLayout, from: { c: number; r: number }, to: { c: number; r: number }): MapLayout {
  if (!inBounds(layout, to.c, to.r)) return layout
  if (from.c === to.c && from.r === to.r) return layout
  const moving = itemAt(layout, from.c, from.r)
  if (!moving || itemAt(layout, to.c, to.r)) return layout
  return {
    ...layout,
    items: layout.items.map((item) => (item === moving ? ({ ...item, c: to.c, r: to.r } as MapItem) : item)),
  }
}

export function removeAt(layout: MapLayout, c: number, r: number): MapLayout {
  if (!itemAt(layout, c, r)) return layout
  return { ...layout, items: layout.items.filter((item) => !(item.c === c && item.r === r)) }
}

/** Tối thiểu cols/rows còn chứa hết phần tử — chặn việc thu nhỏ lưới làm mất phần tử âm thầm. */
export function minimumSize(layout: MapLayout) {
  let cols = 1
  let rows = 1
  for (const item of layout.items) {
    cols = Math.max(cols, item.c + 1)
    rows = Math.max(rows, item.r + 1)
  }
  return { cols, rows }
}

/** Đổi cỡ lưới. Nhỏ hơn mức đang dùng ⇒ kẹp về mức tối thiểu (không xóa phần tử). */
export function resizeLayout(layout: MapLayout, cols: number, rows: number): MapLayout {
  const min = minimumSize(layout)
  const nextCols = clampInt(cols, min.cols, MAP_LIMITS.maxCols)
  const nextRows = clampInt(rows, min.rows, MAP_LIMITS.maxRows)
  if (nextCols === layout.cols && nextRows === layout.rows) return layout
  return { ...layout, cols: nextCols, rows: nextRows }
}

function clampInt(value: number, lo: number, hi: number) {
  if (!Number.isFinite(value)) return lo
  return Math.min(hi, Math.max(lo, Math.round(value)))
}

/** Xếp các máy còn lại vào ô trống theo thứ tự hàng → cột. Hết chỗ thì dừng; `placed` = số máy đã xếp. */
export function autoPlace(layout: MapLayout, hosts: readonly string[]): { layout: MapLayout; placed: number } {
  let next = layout
  let placed = 0
  const queue = unplacedHosts(layout, hosts)
  if (queue.length === 0) return { layout, placed }
  const used = new Set(layout.items.map((item) => cellKey(item.c, item.r)))
  let index = 0
  for (let r = 0; r < layout.rows && index < queue.length; r += 1) {
    for (let c = 0; c < layout.cols && index < queue.length; c += 1) {
      if (used.has(cellKey(c, r))) continue
      const after = placeItem(next, { t: 'pc', host: queue[index], c, r })
      if (after === next) return { layout: next, placed }
      next = after
      index += 1
      placed += 1
    }
  }
  return { layout: next, placed }
}

export function layoutsEqual(a: MapLayout, b: MapLayout) {
  if (a.cols !== b.cols || a.rows !== b.rows || a.items.length !== b.items.length) return false
  if (JSON.stringify(settingsOf(a)) !== JSON.stringify(settingsOf(b))) return false
  const sig = (layout: MapLayout) =>
    layout.items
      .map((item) => `${item.t}|${isPc(item) ? hostKey(item.host) : ''}|${item.c}|${item.r}`)
      .sort()
      .join(';')
  return sig(a) === sig(b)
}

/**
 * Đọc bố cục từ dữ liệu server một cách phòng thủ: sai hình dạng ⇒ null (trang vẫn chạy, coi như chưa có sơ đồ).
 * Phần tử lạ / ngoài lưới / trùng ô bị bỏ — server đã kiểm, đây là lớp chắn thứ hai khi server bản khác.
 */
export function parseLayout(raw: unknown): MapLayout | null {
  if (!raw || typeof raw !== 'object') return null
  const data = raw as Record<string, unknown>
  const { cols, rows, items } = data
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || !Array.isArray(items)) return null
  if ((cols as number) < 1 || (cols as number) > MAP_LIMITS.maxCols) return null
  if ((rows as number) < 1 || (rows as number) > MAP_LIMITS.maxRows) return null

  let layout: MapLayout = { ...emptyLayout(cols as number, rows as number), settings: resolveMapSettings(data.settings) }
  const decorTypes = new Set<string>(MAP_DECOR_TYPES)
  for (const entry of items) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const c = item.c
    const r = item.r
    if (typeof c !== 'number' || typeof r !== 'number') continue
    if (item.t === 'pc' && typeof item.host === 'string' && item.host.length > 0) {
      layout = placeItem(layout, { t: 'pc', host: item.host, c, r })
    } else if (typeof item.t === 'string' && decorTypes.has(item.t)) {
      layout = placeItem(layout, { t: item.t as MapDecorType, c, r })
    }
  }
  return layout
}

/** Lỗi lưu sơ đồ → câu tiếng Việt cho nhân viên. */
export function describeMapError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code
  switch (code) {
    case 'MAP_CONFLICT':
      return 'Có người vừa lưu một sơ đồ khác. Hãy tải lại sơ đồ rồi sửa tiếp.'
    case 'ADMIN_REQUIRED':
      return 'Chỉ quản trị viên được sửa sơ đồ máy trạm.'
    case 'AUTH_REQUIRED':
      return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.'
    case 'INVALID_LAYOUT':
      return 'Máy chủ không chấp nhận bố cục này. Hãy kiểm tra lại các phần tử rồi lưu lại.'
    default:
      return error instanceof Error && error.message ? error.message : 'Không lưu được sơ đồ máy trạm.'
  }
}
