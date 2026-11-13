import {
  MAP_DECOR_TYPES,
  MAP_LABEL_FONTS,
  MAP_LABEL_LIMITS,
  type MapDecorType,
  type MapItem,
  type MapLabelFont,
  type MapLabelItem,
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
  { type: 'table_football', label: 'Đá banh bàn', group: 'game' },
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

export function isLabel(item: MapItem): item is MapLabelItem {
  return item.t === 'label'
}

// ----- nhãn chữ (task ws-map-label) -----

export const DEFAULT_LABEL_TEXT = 'Nhãn'
export const LABEL_SIZE_DEFAULT = 14
/** Cỡ ô (px) ở zoom 100% của trình chỉnh sửa — `size` của nhãn tính theo mốc này rồi co giãn theo `--wsmap-cell`. */
export const LABEL_SIZE_BASE_CELL_PX = 56
export const LABEL_SIZE_PRESETS = [10, 12, 14, 16, 20, 24, 32, 40, 48] as const

export const LABEL_FONT_OPTIONS: readonly { key: MapLabelFont; label: string; css: string }[] = [
  { key: 'default', label: 'Mặc định', css: 'inherit' },
  { key: 'arial', label: 'Arial', css: 'Arial, Helvetica, sans-serif' },
  { key: 'tahoma', label: 'Tahoma', css: 'Tahoma, Verdana, sans-serif' },
  { key: 'segoe', label: 'Segoe UI', css: '"Segoe UI", system-ui, sans-serif' },
  { key: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { key: 'courier', label: 'Courier New', css: '"Courier New", Courier, monospace' },
]

export const LABEL_FONT_CSS: Record<MapLabelFont, string> = Object.fromEntries(
  LABEL_FONT_OPTIONS.map((option) => [option.key, option.css]),
) as Record<MapLabelFont, string>

/** Màu gợi ý trong bảng thuộc tính (ngoài ô chọn màu tự do). Không chọn = màu chữ theo giao diện. */
export const LABEL_COLOR_PRESETS = ['#111827', '#dc2626', '#ea580c', '#ca8a04', '#16a34a', '#0891b2', '#2563eb', '#7c3aed'] as const

const LABEL_COLOR_RE = /^#[0-9a-f]{6}$/i
const LABEL_FONT_SET = new Set<string>(MAP_LABEL_FONTS)

/** Bỏ ký tự điều khiển (xuống dòng, tab...) và cắt theo số KÝ TỰ (code point, không phải UTF-16 unit) — khớp server. */
export function sanitizeLabelText(text: string): string {
  const cleaned = Array.from(text).filter((ch) => {
    const code = ch.codePointAt(0) ?? 0
    return code >= 0x20 && code !== 0x7f
  })
  return cleaned.slice(0, MAP_LABEL_LIMITS.maxChars).join('')
}

export function normalizeLabelColor(value: unknown): string | undefined {
  return typeof value === 'string' && LABEL_COLOR_RE.test(value) ? value.toLowerCase() : undefined
}

export function normalizeLabelFont(value: unknown): MapLabelFont {
  return typeof value === 'string' && LABEL_FONT_SET.has(value) ? (value as MapLabelFont) : 'default'
}

export function normalizeLabelSize(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return LABEL_SIZE_DEFAULT
  return clampInt(value, MAP_LABEL_LIMITS.sizeMin, MAP_LABEL_LIMITS.sizeMax)
}

/** Nhãn mới với giá trị mặc định (chữ "Nhãn", phông ứng dụng, cỡ 14, màu theo giao diện). */
export function newLabel(c: number, r: number): MapLabelItem {
  return { t: 'label', c, r, text: DEFAULT_LABEL_TEXT, font: 'default', size: LABEL_SIZE_DEFAULT }
}

/** Dựng lại nhãn từ dữ liệu bất kỳ, từng trường một (sai ⇒ mặc định). Chữ rỗng sau khi làm sạch ⇒ null (bỏ nhãn). */
export function readLabel(raw: Record<string, unknown>, c: number, r: number): MapLabelItem | null {
  const text = typeof raw.text === 'string' ? sanitizeLabelText(raw.text).trim() : ''
  if (!text) return null
  const label: MapLabelItem = { t: 'label', c, r, text, font: normalizeLabelFont(raw.font), size: normalizeLabelSize(raw.size) }
  const color = normalizeLabelColor(raw.color)
  if (color) label.color = color
  return label
}

export type LabelPatch = { text?: string; color?: string | null; font?: MapLabelFont; size?: number }

/**
 * Sửa thuộc tính nhãn tại (c,r). `color: null` = về màu theo giao diện. Chữ được phép RỖNG trong lúc gõ
 * (`finalizeLabels` xử lý trước khi lưu). Ô không phải nhãn / không đổi gì ⇒ trả nguyên bản cũ.
 */
export function updateLabelAt(layout: MapLayout, c: number, r: number, patch: LabelPatch): MapLayout {
  const target = itemAt(layout, c, r)
  if (!target || !isLabel(target)) return layout
  const next: MapLabelItem = { ...target }
  if (patch.text !== undefined) next.text = sanitizeLabelText(patch.text)
  if (patch.font !== undefined) next.font = normalizeLabelFont(patch.font)
  if (patch.size !== undefined) next.size = normalizeLabelSize(patch.size)
  if (patch.color !== undefined) {
    const color = patch.color === null ? undefined : normalizeLabelColor(patch.color)
    if (color) next.color = color
    else delete next.color
  }
  if (labelSig(next) === labelSig(target)) return layout
  return { ...layout, items: layout.items.map((item) => (item === target ? next : item)) }
}

/** Trước khi lưu / xuất: cắt khoảng trắng hai đầu; nhãn để trống ⇒ về chữ mặc định (server không nhận nhãn rỗng). */
export function finalizeLabels(layout: MapLayout): MapLayout {
  let changed = false
  const items = layout.items.map((item) => {
    if (!isLabel(item)) return item
    const text = item.text.trim() || DEFAULT_LABEL_TEXT
    if (text === item.text) return item
    changed = true
    return { ...item, text }
  })
  return changed ? { ...layout, items } : layout
}

function labelSig(item: MapLabelItem) {
  return `${item.text}|${item.color ?? ''}|${normalizeLabelFont(item.font)}|${normalizeLabelSize(item.size)}`
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

export type UnplacedGroup = { id: number; name: string; hosts: string[] }

/**
 * Máy CHƯA xếp, tách theo nhóm máy. Thứ tự nhóm theo danh sách `groups`; nhóm không có trong danh sách (đã xóa / chưa tải)
 * đứng cuối với tên "Nhóm <id>" (giống bảng Chi tiết). Trong nhóm sắp theo tên tự nhiên (PC-2 trước PC-10). Nhóm hết máy bị bỏ.
 */
export function groupUnplaced(
  layout: MapLayout,
  registered: readonly { hostName: string; machineGroupId: number }[],
  groups: readonly { id: number; name: string }[],
): UnplacedGroup[] {
  const placed = placedHosts(layout)
  const byGroup = new Map<number, string[]>()
  for (const item of registered) {
    if (placed.has(hostKey(item.hostName))) continue
    const list = byGroup.get(item.machineGroupId)
    if (list) list.push(item.hostName)
    else byGroup.set(item.machineGroupId, [item.hostName])
  }
  const natural = (a: string, b: string) => a.localeCompare(b, 'vi', { numeric: true, sensitivity: 'base' })
  const result: UnplacedGroup[] = []
  for (const group of groups) {
    const hosts = byGroup.get(group.id)
    if (!hosts) continue
    result.push({ id: group.id, name: group.name, hosts: [...hosts].sort(natural) })
    byGroup.delete(group.id)
  }
  for (const [id, hosts] of [...byGroup.entries()].sort((a, b) => a[0] - b[0])) {
    result.push({ id, name: `Nhóm ${id}`, hosts: [...hosts].sort(natural) })
  }
  return result
}

/**
 * Đặt nhiều máy liền nhau, bắt đầu từ ô `start`, theo thứ tự hàng → cột (như `autoPlace`), BỎ QUA ô đã có phần tử.
 * Máy đã có trên sơ đồ bị bỏ qua. Hết ô trống thì dừng: `placed` = số máy đã đặt, `left` = số máy chưa có chỗ.
 */
export function placeHosts(
  layout: MapLayout,
  hosts: readonly string[],
  start: { c: number; r: number },
): { layout: MapLayout; placed: number; left: number } {
  const queue = unplacedHosts(layout, hosts)
  let next = layout
  let placed = 0
  if (queue.length === 0 || !inBounds(layout, start.c, start.r)) return { layout, placed, left: queue.length }
  const used = new Set(layout.items.map((item) => cellKey(item.c, item.r)))
  let index = 0
  for (let r = start.r; r < layout.rows && index < queue.length; r += 1) {
    for (let c = r === start.r ? start.c : 0; c < layout.cols && index < queue.length; c += 1) {
      if (used.has(cellKey(c, r))) continue
      const after = placeItem(next, { t: 'pc', host: queue[index], c, r })
      if (after === next) return { layout: next, placed, left: queue.length - placed }
      next = after
      index += 1
      placed += 1
    }
  }
  return { layout: next, placed, left: queue.length - placed }
}

export function layoutsEqual(a: MapLayout, b: MapLayout) {
  if (a.cols !== b.cols || a.rows !== b.rows || a.items.length !== b.items.length) return false
  if (JSON.stringify(settingsOf(a)) !== JSON.stringify(settingsOf(b))) return false
  const sig = (layout: MapLayout) =>
    layout.items
      .map(
        (item) =>
          `${item.t}|${isPc(item) ? hostKey(item.host) : isLabel(item) ? labelSig(item) : ''}|${item.c}|${item.r}`,
      )
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
    } else if (item.t === 'label') {
      const label = readLabel(item, c, r)
      if (label) layout = placeItem(layout, label)
    } else if (typeof item.t === 'string' && decorTypes.has(item.t)) {
      layout = placeItem(layout, { t: item.t as MapDecorType, c, r })
    }
  }
  return layout
}

/** Giới hạn cỡ file nhập — bố cục tối đa 1500 phần tử chỉ vài chục KB, file lớn hơn nhiều là file sai. */
export const MAP_FILE_MAX_BYTES = 512 * 1024

/** Bố cục → nội dung file `.json` (cùng hình dạng với dữ liệu server, thụt lề để đọc/so sánh được bằng mắt). */
export function serializeLayout(layout: MapLayout): string {
  const payload: MapLayout = {
    v: 1,
    cols: layout.cols,
    rows: layout.rows,
    items: finalizeLabels(layout).items,
    settings: settingsOf(layout),
  }
  return JSON.stringify(payload, null, 2)
}

export type ParsedLayoutFile = { ok: true; layout: MapLayout; skipped: number } | { ok: false; error: string }

/**
 * Nội dung file `.json` → bố cục. Chỉ nhận file đúng hình dạng sơ đồ; phần tử lạ / ngoài lưới / trùng ô bị bỏ
 * (đếm vào `skipped` để báo người dùng, không âm thầm nuốt).
 */
export function parseLayoutFile(text: string): ParsedLayoutFile {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: 'File không phải JSON hợp lệ.' }
  }
  const layout = parseLayout(raw)
  if (!layout) return { ok: false, error: 'File không đúng định dạng sơ đồ máy trạm.' }
  const total = Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items.length : 0
  return { ok: true, layout, skipped: Math.max(0, total - layout.items.length) }
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
