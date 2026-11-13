import assert from 'node:assert/strict'
import test from 'node:test'
import { MAP_DECOR_TYPES } from '../src/api/workstationMapTypes.ts'
import {
  DECOR_DEFS,
  DEFAULT_MAP_SETTINGS,
  MAP_LIMITS,
  autoPlace,
  emptyLayout,
  isCashierMapEnabled,
  isWallPiece,
  itemAt,
  layoutsEqual,
  minimumSize,
  moveItem,
  parseLayout,
  placeItem,
  placedHosts,
  removeAt,
  resizeLayout,
  resolveMapSettings,
  settingsOf,
  unplacedHosts,
  updateSettings,
  wallPieceArms,
} from '../src/features/workstations/map/mapModel.ts'
import {
  EDITOR_ZOOM_DEFAULT_INDEX,
  EDITOR_ZOOM_PX,
  VIEW_ZOOM_DEFAULT_INDEX,
  VIEW_ZOOM_LEVELS,
  clampZoomIndex,
} from '../src/features/workstations/map/mapZoom.ts'

test('placeItem: dat vao o trong, tu choi o da co / ngoai luoi / may da dat (khong phan biet hoa thuong)', () => {
  let layout = emptyLayout(4, 3)
  layout = placeItem(layout, { t: 'pc', host: 'PC-01', c: 0, r: 0 })
  assert.equal(layout.items.length, 1)

  const sameCell = placeItem(layout, { t: 'sofa', c: 0, r: 0 })
  assert.equal(sameCell, layout, 'o da co phan tu => tra nguyen ban cu')

  assert.equal(placeItem(layout, { t: 'sofa', c: 4, r: 0 }), layout, 'ngoai luoi (cot)')
  assert.equal(placeItem(layout, { t: 'sofa', c: 0, r: -1 }), layout, 'ngoai luoi (hang am)')
  assert.equal(placeItem(layout, { t: 'pc', host: 'pc-01', c: 1, r: 0 }), layout, 'may da dat o o khac')

  const decor = placeItem(layout, { t: 'ping_pong', c: 3, r: 2 })
  assert.equal(decor.items.length, 2)
  assert.equal(layout.items.length, 1, 'khong sua ban cu')
})

test('placeItem: chan khi dat du so phan tu toi da', () => {
  let layout = emptyLayout(MAP_LIMITS.maxCols, MAP_LIMITS.maxRows)
  for (let i = 0; i < MAP_LIMITS.maxItems; i += 1) {
    layout = placeItem(layout, { t: 'sofa', c: i % MAP_LIMITS.maxCols, r: Math.floor(i / MAP_LIMITS.maxCols) })
  }
  assert.equal(layout.items.length, MAP_LIMITS.maxItems)
  assert.equal(placeItem(layout, { t: 'sofa', c: 59, r: 39 }), layout)
})

test('moveItem / removeAt', () => {
  let layout = emptyLayout(5, 5)
  layout = placeItem(layout, { t: 'pc', host: 'A', c: 0, r: 0 })
  layout = placeItem(layout, { t: 'bar', c: 1, r: 0 })

  const moved = moveItem(layout, { c: 0, r: 0 }, { c: 4, r: 4 })
  assert.deepEqual(itemAt(moved, 4, 4), { t: 'pc', host: 'A', c: 4, r: 4 })
  assert.equal(itemAt(moved, 0, 0), undefined)

  assert.equal(moveItem(layout, { c: 0, r: 0 }, { c: 1, r: 0 }), layout, 'dich co phan tu')
  assert.equal(moveItem(layout, { c: 2, r: 2 }, { c: 3, r: 3 }), layout, 'nguon trong')
  assert.equal(moveItem(layout, { c: 0, r: 0 }, { c: 9, r: 9 }), layout, 'ngoai luoi')

  const removed = removeAt(layout, 1, 0)
  assert.equal(removed.items.length, 1)
  assert.equal(removeAt(layout, 3, 3), layout, 'o trong => khong doi')
})

test('unplacedHosts / placedHosts giu thu tu va khong phan biet hoa thuong', () => {
  let layout = emptyLayout(4, 4)
  layout = placeItem(layout, { t: 'pc', host: 'pc-02', c: 0, r: 0 })
  assert.deepEqual(unplacedHosts(layout, ['PC-01', 'PC-02', 'PC-03']), ['PC-01', 'PC-03'])
  assert.deepEqual([...placedHosts(layout)], ['PC-02'])
})

test('resizeLayout: khong the thu nho lam mat phan tu; kep ve gioi han', () => {
  let layout = emptyLayout(10, 10)
  layout = placeItem(layout, { t: 'pc', host: 'A', c: 6, r: 3 })
  assert.deepEqual(minimumSize(layout), { cols: 7, rows: 4 })

  const smaller = resizeLayout(layout, 2, 2)
  assert.equal(smaller.cols, 7, 'kep ve toi thieu de chua phan tu')
  assert.equal(smaller.rows, 4)
  assert.equal(smaller.items.length, 1)

  const huge = resizeLayout(layout, 999, 999)
  assert.equal(huge.cols, MAP_LIMITS.maxCols)
  assert.equal(huge.rows, MAP_LIMITS.maxRows)

  assert.equal(resizeLayout(layout, 10, 10), layout, 'khong doi => cung doi tuong')
  assert.equal(resizeLayout(emptyLayout(3, 3), Number.NaN, 5).cols, 1)
})

test('autoPlace: xep may con lai theo hang -> cot, bo qua o da dung, dung khi het cho', () => {
  let layout = emptyLayout(3, 2)
  layout = placeItem(layout, { t: 'wall_h', c: 0, r: 0 })
  layout = placeItem(layout, { t: 'pc', host: 'B', c: 2, r: 0 })

  const result = autoPlace(layout, ['A', 'B', 'C', 'D', 'E', 'F'])
  // o trong: (1,0) (0,1) (1,1) (2,1) => xep A, C, D, E (B da dat) ; F het cho
  assert.equal(result.placed, 4)
  assert.deepEqual(itemAt(result.layout, 1, 0), { t: 'pc', host: 'A', c: 1, r: 0 })
  assert.deepEqual(itemAt(result.layout, 0, 1), { t: 'pc', host: 'C', c: 0, r: 1 })
  assert.deepEqual(itemAt(result.layout, 2, 1), { t: 'pc', host: 'E', c: 2, r: 1 })
  assert.deepEqual(unplacedHosts(result.layout, ['A', 'B', 'C', 'D', 'E', 'F']), ['F'])

  assert.equal(autoPlace(result.layout, ['A', 'B']).placed, 0)
})

test('layoutsEqual bo qua thu tu phan tu', () => {
  const a = placeItem(placeItem(emptyLayout(3, 3), { t: 'bar', c: 0, r: 0 }), { t: 'pc', host: 'X', c: 1, r: 1 })
  const b = placeItem(placeItem(emptyLayout(3, 3), { t: 'pc', host: 'x', c: 1, r: 1 }), { t: 'bar', c: 0, r: 0 })
  assert.equal(layoutsEqual(a, b), true)
  assert.equal(layoutsEqual(a, resizeLayout(b, 4, 3)), false)
  assert.equal(layoutsEqual(a, removeAt(b, 0, 0)), false)
})

test('parseLayout: du lieu server sai hinh dang => null; phan tu rac / ngoai luoi / trung o bi bo', () => {
  assert.equal(parseLayout(null), null)
  assert.equal(parseLayout('x'), null)
  assert.equal(parseLayout({ cols: 0, rows: 3, items: [] }), null)
  assert.equal(parseLayout({ cols: 61, rows: 3, items: [] }), null)
  assert.equal(parseLayout({ cols: 3, rows: 3 }), null)

  const parsed = parseLayout({
    v: 1,
    cols: 3,
    rows: 3,
    items: [
      { t: 'pc', host: 'A', c: 0, r: 0 },
      { t: 'pc', host: 'a', c: 1, r: 0 }, // trung may
      { t: 'sofa', c: 0, r: 0 }, // trung o
      { t: 'ufo', c: 2, r: 2 }, // loai la
      { t: 'bar', c: 9, r: 9 }, // ngoai luoi
      { t: 'wc', c: '1', r: 1 }, // sai kieu
      null,
      { t: 'ping_pong', c: 2, r: 1 },
    ],
  })
  assert.ok(parsed)
  assert.equal(parsed.items.length, 2)
  assert.deepEqual(itemAt(parsed, 2, 1), { t: 'ping_pong', c: 2, r: 1 })
})

test('zoom: toi da 5 muc, tang dan, mac dinh o muc giua (1x = kich thuoc goc), min/max hop ly', () => {
  for (const levels of [VIEW_ZOOM_LEVELS, EDITOR_ZOOM_PX]) {
    assert.ok(levels.length >= 2 && levels.length <= 5, 'thanh truot khong qua 5 muc')
    assert.deepEqual([...levels], [...levels].sort((a, b) => a - b), 'muc tang dan')
  }
  assert.equal(VIEW_ZOOM_LEVELS[VIEW_ZOOM_DEFAULT_INDEX], 1, 'mac dinh thu ngan = kich thuoc goc cua hinh may')
  assert.equal(VIEW_ZOOM_LEVELS[0], 0.5, 'min thu ngan = 50%')
  assert.equal(VIEW_ZOOM_LEVELS[VIEW_ZOOM_LEVELS.length - 1], 1.25, 'max thu ngan = 125%')
  const base = EDITOR_ZOOM_PX[EDITOR_ZOOM_DEFAULT_INDEX]
  assert.equal(EDITOR_ZOOM_PX[0] / base, 0.5, 'min editor = 50% so voi muc mac dinh')
  assert.equal(EDITOR_ZOOM_PX[EDITOR_ZOOM_PX.length - 1] / base, 1.25, 'max editor = 125% so voi muc mac dinh')
  assert.ok(EDITOR_ZOOM_DEFAULT_INDEX >= 0 && EDITOR_ZOOM_DEFAULT_INDEX < EDITOR_ZOOM_PX.length)
})

test('clampZoomIndex: kep ve khoang hop le, gia tri rac => mac dinh', () => {
  assert.equal(clampZoomIndex(-3, 5, 2), 0)
  assert.equal(clampZoomIndex(99, 5, 2), 4)
  assert.equal(clampZoomIndex(3, 5, 2), 3)
  assert.equal(clampZoomIndex(Number.NaN, 5, 2), 2)
  assert.equal(clampZoomIndex(1.5, 5, 2), 2)
})
test('settings: bo cuc cu (khong co settings) / sai kieu => mac dinh BAT; tung truong duoc doc doc lap', () => {
  assert.deepEqual(resolveMapSettings(undefined), DEFAULT_MAP_SETTINGS)
  assert.deepEqual(resolveMapSettings('x'), DEFAULT_MAP_SETTINGS)
  assert.deepEqual(resolveMapSettings({ cashier: 'x' }), DEFAULT_MAP_SETTINGS)
  assert.deepEqual(resolveMapSettings({ cashier: { enabled: 'no' } }), DEFAULT_MAP_SETTINGS, 'sai kieu => mac dinh')
  assert.equal(resolveMapSettings({ cashier: { enabled: false } }).cashier.enabled, false)
  assert.deepEqual(resolveMapSettings({ cashier: { enabled: false, rac: 1 }, rac: 2 }), { cashier: { enabled: false } }, 'chi giu truong biet')

  const old = parseLayout({ cols: 3, rows: 2, items: [] })
  assert.ok(old)
  assert.equal(isCashierMapEnabled(old), true, 'so do da ve truoc khi co thiet lap van dung tai thu ngan')
  assert.equal(isCashierMapEnabled({ v: 1, cols: 1, rows: 1, items: [] }), true)
})

test('settings: updateSettings tra ban moi, khong sua ban cu; khong doi gi => tra nguyen ban; layoutsEqual thay duoc su doi', () => {
  const base = emptyLayout(4, 3)
  const off = updateSettings(base, (s) => ({ ...s, cashier: { ...s.cashier, enabled: false } }))
  assert.notEqual(off, base)
  assert.equal(isCashierMapEnabled(off), false)
  assert.equal(isCashierMapEnabled(base), true, 'khong sua ban cu')
  assert.equal(layoutsEqual(base, off), false, 'doi cong tat => co thay doi chua luu')

  assert.equal(updateSettings(off, (s) => s), off, 'khong doi gi => nguyen ban')
  assert.equal(layoutsEqual(base, { ...base, settings: undefined }), true, 'thieu settings == mac dinh')
  assert.deepEqual(settingsOf(parseLayout({ cols: 3, rows: 2, items: [], settings: { cashier: { enabled: false } } })!), {
    cashier: { enabled: false },
  })
})

test('tuong chu L / chu T: moi loai co dung 2 / 3 nhanh, khong trung nhanh, parseLayout giu lai', () => {
  const pieces = MAP_DECOR_TYPES.filter(isWallPiece)
  assert.equal(pieces.length, 8)
  for (const type of pieces) {
    const arms = wallPieceArms(type)
    assert.equal(arms.length, type.startsWith('wall_l_') ? 2 : 3, type)
    assert.equal(new Set(arms).size, arms.length, type)
    assert.ok(arms.every((arm) => 'nesw'.includes(arm)), type)
  }
  assert.deepEqual(wallPieceArms('wall_t_esw'), ['e', 's', 'w'])
  assert.equal(isWallPiece('wall_h'), false)
  assert.equal(isWallPiece('entrance'), false)

  const layout = parseLayout({
    v: 1, cols: 5, rows: 5,
    items: [{ t: 'wall_l_se', c: 0, r: 0 }, { t: 'wall_t_nsw', c: 1, r: 0 }, { t: 'wall_x_nope', c: 2, r: 0 }],
  })
  assert.deepEqual(layout?.items.map((item) => item.t), ['wall_l_se', 'wall_t_nsw'])
})

test('DECOR_DEFS khop MAP_DECOR_TYPES (khong thieu / thua / trung loai nao)', () => {
  const defs = DECOR_DEFS.map((def) => def.type).sort()
  assert.deepEqual(defs, [...MAP_DECOR_TYPES].sort())
})