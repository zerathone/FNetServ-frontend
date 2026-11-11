import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAP_LIMITS,
  autoPlace,
  emptyLayout,
  itemAt,
  layoutsEqual,
  minimumSize,
  moveItem,
  parseLayout,
  placeItem,
  placedHosts,
  removeAt,
  resizeLayout,
  unplacedHosts,
} from '../src/features/workstations/map/mapModel.ts'

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
