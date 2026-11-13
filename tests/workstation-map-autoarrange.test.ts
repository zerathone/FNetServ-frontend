import assert from 'node:assert/strict'
import test from 'node:test'
import {
  ARRANGE_GAP,
  ARRANGE_MARGIN,
  ARRANGE_TARGET_RATIO,
  arrangeByGroup,
  type ArrangeShape,
} from '../src/features/workstations/map/mapAutoArrange.ts'
import { MAP_LIMITS, parseLayout, type UnplacedGroup } from '../src/features/workstations/map/mapModel.ts'

const SHAPES: ArrangeShape[] = ['landscape', 'portrait', 'square']
const mk = (id: number, name: string, n: number): UnplacedGroup => ({
  id,
  name,
  hosts: Array.from({ length: n }, (_, i) => `${name}-${i + 1}`),
})

// Sinh du lieu gia ngau nhien nhung co dinh (LCG) de test lap lai duoc.
function lcg(seed: number) {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 4294967296
  }
}

/** Kiem moi luat bo cuc cua mot ket qua; tra ve so nhom da kiem. */
function assertRules(groups: UnplacedGroup[], shape: ArrangeShape) {
  const result = arrangeByGroup(groups, shape)
  assert.equal(result.ok, true, `${shape}: phai xep duoc`)
  if (!result.ok) return
  const { layout } = result
  assert.ok(layout.cols <= MAP_LIMITS.maxCols && layout.rows <= MAP_LIMITS.maxRows)
  assert.ok(layout.items.length <= MAP_LIMITS.maxItems)
  // sau khi qua parseLayout (lop chan thu hai cua trinh chinh sua) khong mat phan tu nao
  assert.equal(parseLayout(JSON.parse(JSON.stringify(layout)))?.items.length, layout.items.length)

  const cells = new Set<string>()
  for (const item of layout.items) {
    const key = `${item.c},${item.r}`
    assert.ok(!cells.has(key), `trung o ${key}`)
    cells.add(key)
    if (item.t.startsWith('wall_')) continue // tuong bao nam DUNG o vong mep (kiem rieng ben duoi)
    // le: may / nhan cach mep so do it nhat ARRANGE_MARGIN o (tuc cach tuong bao 1 o trong)
    assert.ok(item.c >= ARRANGE_MARGIN && item.r >= ARRANGE_MARGIN, 'sat mep tren/trai')
    assert.ok(item.c <= layout.cols - 1 - ARRANGE_MARGIN && item.r <= layout.rows - 1 - ARRANGE_MARGIN, 'sat mep duoi/phai')
  }

  // tuong bao: kin ca vong mep, dung loai (ngang tren/duoi, doc trai/phai, chu L o 4 goc), khong co tuong nao khac
  const wallAt = (c: number, r: number) => layout.items.find((i) => i.c === c && i.r === r)?.t
  const lastC = layout.cols - 1
  const lastR = layout.rows - 1
  assert.equal(wallAt(0, 0), 'wall_l_se')
  assert.equal(wallAt(lastC, 0), 'wall_l_sw')
  assert.equal(wallAt(0, lastR), 'wall_l_ne')
  assert.equal(wallAt(lastC, lastR), 'wall_l_nw')
  for (let c = 1; c < lastC; c += 1) {
    assert.equal(wallAt(c, 0), 'wall_h')
    assert.equal(wallAt(c, lastR), 'wall_h')
  }
  for (let r = 1; r < lastR; r += 1) {
    assert.equal(wallAt(0, r), 'wall_v')
    assert.equal(wallAt(lastC, r), 'wall_v')
  }
  const perimeter = 2 * (layout.cols + layout.rows) - 4
  assert.equal(layout.items.filter((i) => i.t.startsWith('wall_')).length, perimeter, 'chi co tuong o vong mep')

  // moi may xuat hien dung 1 lan; moi nhom co dung 1 nhan o goc tren-trai khoi, may nam ngay duoi nhan
  const groupOfItem = new Map<string, number>()
  for (const group of groups) {
    const pcs = group.hosts.map((host) => layout.items.find((i) => i.t === 'pc' && i.host === host))
    assert.ok(pcs.every(Boolean), `thieu may cua nhom ${group.name}`)
    const label = layout.items.find((i) => i.t === 'label' && i.text === group.name)
    assert.ok(label, `thieu nhan nhom ${group.name}`)
    const minC = Math.min(...pcs.map((p) => p!.c))
    const minR = Math.min(...pcs.map((p) => p!.r))
    assert.equal(label!.c, minC, 'nhan phai o cot dau cua khoi')
    assert.equal(label!.r, minR - 1, 'nhan phai o hang ngay tren may dau tien')
    // khoi chu nhat dac: cac may chi chiem hang cuoi chua day
    const maxC = Math.max(...pcs.map((p) => p!.c))
    const width = maxC - minC + 1
    const rowsUsed = Math.max(...pcs.map((p) => p!.r)) - minR + 1
    assert.equal(rowsUsed, Math.ceil(group.hosts.length / width), 'khoi khong lien')
    for (const p of pcs) groupOfItem.set(`${p!.c},${p!.r}`, group.id)
    groupOfItem.set(`${label!.c},${label!.r}`, group.id)
  }
  assert.equal(layout.items.length, groups.reduce((s, g) => s + g.hosts.length + 1, 0) + perimeter)

  // hai nhom khac nhau cach nhau it nhat ARRANGE_GAP o trong (o gan nhat lech >= GAP+1 theo mot truc)
  const entries = [...groupOfItem.entries()].map(([k, id]) => ({ c: Number(k.split(',')[0]), r: Number(k.split(',')[1]), id }))
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const a = entries[i]
      const b = entries[j]
      if (a.id === b.id) continue
      assert.ok(Math.abs(a.c - b.c) > ARRANGE_GAP || Math.abs(a.r - b.r) > ARRANGE_GAP, `2 nhom cach nhau < ${ARRANGE_GAP} o`)
    }
  }
  return layout
}

test('arrangeByGroup: moi luat bo cuc (le, khoang cach, nhan, khoi lien) dung tren 300 bo du lieu ngau nhien', () => {
  const rand = lcg(20261113)
  for (let round = 0; round < 100; round += 1) {
    const groupCount = 1 + Math.floor(rand() * 8)
    const groups = Array.from({ length: groupCount }, (_, i) => mk(i + 1, `G${i + 1}`, 1 + Math.floor(rand() * 40)))
    for (const shape of SHAPES) assertRules(groups, shape)
  }
})

test('arrangeByGroup: ti le cot:hang bam theo kieu — ngang > vuông > doc, va gan muc tieu', () => {
  const groups = [mk(1, 'VIP', 10), mk(2, 'Standard', 40), mk(3, 'Rong', 5)]
  const ratio = (shape: ArrangeShape) => {
    const r = arrangeByGroup(groups, shape)
    assert.equal(r.ok, true)
    return r.ok ? r.layout.cols / r.layout.rows : 0
  }
  const landscape = ratio('landscape')
  const square = ratio('square')
  const portrait = ratio('portrait')
  assert.ok(landscape > square && square > portrait, `${landscape} > ${square} > ${portrait}`)
  assert.ok(landscape > 1.3 && portrait < 0.8)
  for (const [shape, value] of [['landscape', landscape], ['square', square], ['portrait', portrait]] as const) {
    assert.ok(Math.abs(Math.log(value / ARRANGE_TARGET_RATIO[shape])) < 0.35, `${shape}: ${value}`)
  }
})

test('arrangeByGroup: thu tu nhom giu nguyen; nhom nho nam ngang hang nhom lon (khong chiem rieng mot hang)', () => {
  const groups = [mk(1, 'A', 30), mk(2, 'B', 3), mk(3, 'C', 3)]
  const result = arrangeByGroup(groups, 'landscape')
  assert.equal(result.ok, true)
  if (!result.ok) return
  const label = (name: string) => result.layout.items.find((i) => i.t === 'label' && i.text === name)!
  const [a, b, c] = ['A', 'B', 'C'].map(label)
  // thu tu: A truoc B truoc C theo (hang, cot)
  assert.ok(a.r < b.r || (a.r === b.r && a.c < b.c))
  assert.ok(b.r < c.r || (b.r === c.r && b.c < c.c))
  // so do ngang: it nhat hai nhom chung mot hang (khong xep chong tung nhom mot)
  assert.ok(new Set([a.r, b.r, c.r]).size < 3)
})

test('arrangeByGroup: giu settings truyen vao; nhan lay ten nhom (rong => "Nhom <id>"); 1 may van xep duoc', () => {
  const settings = { cashier: { enabled: false } }
  const one = arrangeByGroup([{ id: 7, name: '   ', hosts: ['PC-1'] }], 'square', settings)
  assert.equal(one.ok, true)
  if (!one.ok) return
  assert.deepEqual(one.layout.settings, settings)
  // 1 nhan + 1 may + vong tuong bao quanh luoi 3 x 4 (2 * (3 + 4) - 4 = 10 o)
  assert.equal(one.layout.items.length, 2 + 10)
  assert.equal(one.layout.items.find((i) => i.t === 'label')?.t === 'label' && (one.layout.items.find((i) => i.t === 'label') as { text: string }).text, 'Nhóm 7')
})

test('arrangeByGroup: khong co may => loi; vuot gioi han so phan tu hoac luoi => loi ro rang, khong tra so do hong', () => {
  assert.equal(arrangeByGroup([], 'square').ok, false)
  assert.equal(arrangeByGroup([{ id: 1, name: 'X', hosts: [] }], 'square').ok, false)
  const tooMany = arrangeByGroup([mk(1, 'A', MAP_LIMITS.maxItems)], 'square')
  assert.equal(tooMany.ok, false)
  // 1400 may trong 20 nhom: du so phan tu nhung khong du 60x40 sau khi chua nhan + khoang cach
  const manyGroups = Array.from({ length: 20 }, (_, i) => mk(i + 1, `G${i + 1}`, 70))
  const r = arrangeByGroup(manyGroups, 'landscape')
  if (!r.ok) assert.match(r.error, /Không xếp vừa|Quá nhiều/)
  else assert.ok(r.layout.cols <= MAP_LIMITS.maxCols && r.layout.rows <= MAP_LIMITS.maxRows)
})