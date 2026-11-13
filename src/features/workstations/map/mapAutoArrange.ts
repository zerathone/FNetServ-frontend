import type { MapItem, MapLayout, MapSettings } from '../../../api/workstationMapTypes.ts'
import { DEFAULT_MAP_SETTINGS, MAP_LIMITS, newLabel, sanitizeLabelText, type UnplacedGroup } from './mapModel.ts'

// Xếp tự động theo NHÓM máy (task ws-map-autoarrange). Mô hình thuần, không React; mọi hàm trả bản mới.
//
// Luật (user chốt):
//   - Máy cùng nhóm nằm sát nhau thành MỘT khối chữ nhật; giữa hai khối chừa ARRANGE_GAP ô trống.
//   - Hàng đầu của khối là NHÃN tên nhóm (neo ô trên-trái của khối), các máy xếp hàng → cột ngay dưới nhãn.
//   - Chừa ARRANGE_MARGIN ô trống quanh mép sơ đồ và đặt TƯỜNG BAO vào đúng vòng ô mép đó: tường ngang ở hàng trên / dưới,
//     tường dọc ở cột trái / phải, tường chữ L ở bốn góc (xem `perimeterWalls`). Các nhóm vẫn cách tường 1 ô trống.
//   - Số cột / hàng tự tính để tỉ lệ cột:hàng gần với kiểu người dùng chọn (ngang / dọc / vuông) và ít ô thừa nhất.
//   - Các khối xếp kiểu "kệ hàng" theo đúng thứ tự nhóm: hàng nào cao bằng khối cao nhất của hàng đó, nên nhóm nhỏ
//     được nằm ngang hàng với nhóm lớn bên cạnh thay vì chiếm hẳn một hàng.

export type ArrangeShape = 'landscape' | 'portrait' | 'square'

/** Tỉ lệ cột / hàng mục tiêu: ngang ≈ 16:9, dọc ≈ 9:16, vuông 1:1 (ô sơ đồ là hình vuông nên cũng là tỉ lệ hình thật). */
export const ARRANGE_TARGET_RATIO: Record<ArrangeShape, number> = {
  landscape: 16 / 9,
  portrait: 9 / 16,
  square: 1,
}

export const ARRANGE_SHAPE_LABEL: Record<ArrangeShape, string> = {
  landscape: 'Ngang',
  portrait: 'Dọc',
  square: 'Vuông',
}

export const ARRANGE_GAP = 2
export const ARRANGE_MARGIN = 1

/**
 * Trọng số phạt ô thừa so với sai lệch tỉ lệ (ln). 0 = chỉ cần đúng tỉ lệ; lớn = ưu tiên sơ đồ gọn.
 * Phần lớn ô thừa là do luật "cách nhau 2 ô + chừa lề" nên không tránh được; 1.0 là mức giữa vẫn nhận ra rõ kiểu đã chọn.
 */
const WASTE_WEIGHT = 1.0

export type ArrangeResult =
  | { ok: true; layout: MapLayout; groups: number; pcs: number }
  | { ok: false; error: string }

type Block = { group: UnplacedGroup; w: number; h: number; x: number; y: number }

type Packing = { blocks: Block[]; contentW: number; contentH: number }

/**
 * Vòng tường bao quanh lưới `cols × rows` (cols >= 2, rows >= 2): ngang ở hàng đầu / cuối, dọc ở cột đầu / cuối,
 * chữ L ở bốn góc (┌ = nối xuống & phải, ┐ = xuống & trái, └ = lên & phải, ┘ = lên & trái).
 */
export function perimeterWalls(cols: number, rows: number): MapItem[] {
  const lastC = cols - 1
  const lastR = rows - 1
  const walls: MapItem[] = []
  for (let c = 0; c <= lastC; c += 1) {
    walls.push({ t: c === 0 ? 'wall_l_se' : c === lastC ? 'wall_l_sw' : 'wall_h', c, r: 0 })
    walls.push({ t: c === 0 ? 'wall_l_ne' : c === lastC ? 'wall_l_nw' : 'wall_h', c, r: lastR })
  }
  for (let r = 1; r < lastR; r += 1) {
    walls.push({ t: 'wall_v', c: 0, r })
    walls.push({ t: 'wall_v', c: lastC, r })
  }
  return walls
}

/** Xếp các khối (bề rộng tối đa `k` cột mỗi khối) vào các hàng rộng tối đa `shelf` ô. Giữ nguyên thứ tự nhóm. */
function pack(groups: readonly UnplacedGroup[], k: number, shelf: number): Packing {
  const blocks: Block[] = []
  let x = 0
  let y = 0
  let shelfHeight = 0
  let contentW = 0
  for (const group of groups) {
    const w = Math.min(group.hosts.length, k)
    const h = 1 + Math.ceil(group.hosts.length / w)
    if (x > 0 && x + w > shelf) {
      y += shelfHeight + ARRANGE_GAP
      x = 0
      shelfHeight = 0
    }
    blocks.push({ group, w, h, x, y })
    contentW = Math.max(contentW, x + w)
    shelfHeight = Math.max(shelfHeight, h)
    x += w + ARRANGE_GAP
  }
  return { blocks, contentW, contentH: y + shelfHeight }
}

/**
 * Xếp TOÀN BỘ máy trong `groups` thành một sơ đồ mới (không giữ gì của sơ đồ cũ ngoài `settings`).
 * `groups` nên đi theo thứ tự hiển thị mong muốn (xem `groupUnplaced` với sơ đồ trống).
 * Không xếp vừa giới hạn lưới / số phần tử của server ⇒ `ok: false` kèm lý do bằng tiếng Việt.
 */
export function arrangeByGroup(
  groups: readonly UnplacedGroup[],
  shape: ArrangeShape,
  settings: MapSettings = DEFAULT_MAP_SETTINGS,
): ArrangeResult {
  const used = groups.filter((group) => group.hosts.length > 0)
  if (used.length === 0) return { ok: false, error: 'Chưa có máy trạm nào để xếp.' }

  const pcs = used.reduce((sum, group) => sum + group.hosts.length, 0)
  const itemCount = pcs + used.length // máy + một nhãn mỗi nhóm
  if (itemCount > MAP_LIMITS.maxItems) {
    return { ok: false, error: `Quá nhiều phần tử (${itemCount}) so với giới hạn ${MAP_LIMITS.maxItems} của một sơ đồ.` }
  }

  const maxContentW = MAP_LIMITS.maxCols - 2 * ARRANGE_MARGIN
  const maxContentH = MAP_LIMITS.maxRows - 2 * ARRANGE_MARGIN
  const target = ARRANGE_TARGET_RATIO[shape]

  let best: { packing: Packing; cols: number; rows: number; score: number } | null = null
  for (let k = 1; k <= maxContentW; k += 1) {
    for (let shelf = 1; shelf <= maxContentW; shelf += 1) {
      const packing = pack(used, k, shelf)
      if (packing.contentW > maxContentW || packing.contentH > maxContentH) continue
      const cols = packing.contentW + 2 * ARRANGE_MARGIN
      const rows = packing.contentH + 2 * ARRANGE_MARGIN
      // Vòng tường bao cũng là phần tử của sơ đồ nên tính vào giới hạn số phần tử của server.
      if (itemCount + 2 * (cols + rows) - 4 > MAP_LIMITS.maxItems) continue
      const score = Math.abs(Math.log(cols / rows / target)) + WASTE_WEIGHT * (1 - itemCount / (cols * rows))
      // Hòa điểm ⇒ chọn sơ đồ nhỏ hơn (ít ô hơn).
      if (!best || score < best.score - 1e-9 || (Math.abs(score - best.score) <= 1e-9 && cols * rows < best.cols * best.rows)) {
        best = { packing, cols, rows, score }
      }
    }
  }
  if (!best) {
    return {
      ok: false,
      error: `Không xếp vừa ${pcs} máy của ${used.length} nhóm vào lưới tối đa ${MAP_LIMITS.maxCols} cột × ${MAP_LIMITS.maxRows} hàng.`,
    }
  }

  const items: MapItem[] = []
  for (const block of best.packing.blocks) {
    const left = ARRANGE_MARGIN + block.x
    const top = ARRANGE_MARGIN + block.y
    const label = newLabel(left, top)
    label.text = sanitizeLabelText(block.group.name).trim() || `Nhóm ${block.group.id}`
    items.push(label)
    block.group.hosts.forEach((host, index) => {
      items.push({ t: 'pc', host, c: left + (index % block.w), r: top + 1 + Math.floor(index / block.w) })
    })
  }
  items.push(...perimeterWalls(best.cols, best.rows))
  return {
    ok: true,
    layout: { v: 1, cols: best.cols, rows: best.rows, items, settings },
    groups: used.length,
    pcs,
  }
}
