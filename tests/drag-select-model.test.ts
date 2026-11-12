import assert from 'node:assert/strict'
import test from 'node:test'
import {
  applyHits,
  edgeScrollDelta,
  rangeBetween,
  rectHits,
  visualOrder,
  type HostRect,
} from '../src/features/workstations/dragSelectModel.ts'

const rect = (host: string, left: number, top: number, size = 10): HostRect => ({ host, left, top, right: left + size, bottom: top + size })

test('rangeBetween: gom ca hai dau, a truoc hay sau b deu duoc; thieu diem neo => chi b', () => {
  const ids = ['A', 'B', 'C', 'D', 'E']
  assert.deepEqual(rangeBetween(ids, 'B', 'D'), ['B', 'C', 'D'])
  assert.deepEqual(rangeBetween(ids, 'D', 'B'), ['B', 'C', 'D'], 'keo nguoc')
  assert.deepEqual(rangeBetween(ids, 'C', 'C'), ['C'])
  assert.deepEqual(rangeBetween(ids, 'X', 'C'), ['C'], 'diem neo da bi loc mat')
  assert.deepEqual(rangeBetween(ids, 'A', 'X'), [], 'dich khong co trong danh sach')
})

test('rectHits: may co hop CAT khung (cham mep khong tinh), keo huong nao cung duoc', () => {
  const rects = [rect('A', 0, 0), rect('B', 20, 0), rect('C', 0, 20), rect('D', 20, 20)]
  assert.deepEqual(rectHits(rects, { x: 5, y: 5 }, { x: 25, y: 5 }), ['A', 'B'], 'mot hang')
  assert.deepEqual(rectHits(rects, { x: 25, y: 25 }, { x: 5, y: 5 }), ['A', 'B', 'C', 'D'], 'keo tu duoi len')
  assert.deepEqual(rectHits(rects, { x: 10, y: 0 }, { x: 20, y: 10 }), [], 'chi cham mep hai may => khong tinh')
  assert.deepEqual(rectHits(rects, { x: 100, y: 100 }, { x: 120, y: 120 }), [])
})

test('applyHits: kieu Gmail — ep ca vung ve cung gia tri, tinh tu anh chup nen keo nguoc thi vung co lai', () => {
  const base = new Set(['A', 'Z'])
  const checked = applyHits(base, ['B', 'C', 'D'], true)
  assert.deepEqual([...checked].sort(), ['A', 'B', 'C', 'D', 'Z'])
  assert.deepEqual([...base].sort(), ['A', 'Z'], 'khong sua anh chup')

  const shrunk = applyHits(base, ['B'], true)
  assert.deepEqual([...shrunk].sort(), ['A', 'B', 'Z'], 'vung co lai: C, D tra ve trang thai ban dau')

  const unchecked = applyHits(new Set(['A', 'B', 'C']), ['B', 'C', 'D'], false)
  assert.deepEqual([...unchecked], ['A'], 'bat dau o o da tick => bo tick ca vung')
})

test('visualOrder: hang tren truoc, trong hang trai truoc, lech vai px van cung hang', () => {
  const rects = [rect('D', 30, 41), rect('B', 30, 0), rect('A', 0, 2), rect('C', 0, 40)]
  assert.deepEqual(visualOrder(rects), ['A', 'B', 'C', 'D'])
})

test('edgeScrollDelta: giua khung = 0; sat mep tren am, sat mep duoi duong, cang sat cang nhanh, co tran', () => {
  assert.equal(edgeScrollDelta(300, 100, 500), 0)
  assert.ok(edgeScrollDelta(110, 100, 500) < 0)
  assert.ok(edgeScrollDelta(490, 100, 500) > 0)
  assert.ok(Math.abs(edgeScrollDelta(101, 100, 500)) > Math.abs(edgeScrollDelta(130, 100, 500)))
  assert.equal(edgeScrollDelta(-500, 100, 500), -18, 'keo ra han ngoai: toc do toi da')
  assert.equal(edgeScrollDelta(900, 100, 500), 18)
})