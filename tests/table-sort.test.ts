import assert from 'node:assert/strict'
import test from 'node:test'
import { nextSort, sortRows, toSortNumber, type SortState } from '../src/lib/tableSort.ts'

type Key = 'qty' | 'name'
const accessors = {
  qty: (r: { qty: string | null; name: string }) => toSortNumber(r.qty),
  name: (r: { qty: string | null; name: string }) => r.name,
}

test('nextSort: firstDir → ngược lại → bỏ sắp xếp; đổi cột thì bắt đầu lại', () => {
  let s: SortState<Key> = null
  s = nextSort(s, 'qty')
  assert.deepEqual(s, { key: 'qty', dir: 'asc' })
  s = nextSort(s, 'qty')
  assert.deepEqual(s, { key: 'qty', dir: 'desc' })
  s = nextSort(s, 'qty')
  assert.equal(s, null)
  s = nextSort(null, 'qty', 'desc')
  assert.deepEqual(s, { key: 'qty', dir: 'desc' })
  s = nextSort(s, 'qty', 'desc')
  assert.deepEqual(s, { key: 'qty', dir: 'asc' })
  assert.deepEqual(nextSort({ key: 'qty', dir: 'asc' }, 'name'), { key: 'name', dir: 'asc' })
})

test('toSortNumber: chuỗi thập phân (chấm/phẩy, âm), rỗng và sai → null', () => {
  assert.equal(toSortNumber('1.500'), 1.5)
  assert.equal(toSortNumber('12,5'), 12.5)
  assert.equal(toSortNumber('-2'), -2)
  assert.equal(toSortNumber(7), 7)
  assert.equal(toSortNumber(''), null)
  assert.equal(toSortNumber(null), null)
  assert.equal(toSortNumber('abc'), null)
})

test('sortRows: số theo giá trị (không theo chuỗi), rỗng luôn cuối, ổn định, không đổi mảng gốc', () => {
  const rows = [
    { qty: '10', name: 'a' },
    { qty: '9', name: 'b' },
    { qty: null, name: 'c' },
    { qty: '9', name: 'd' },
    { qty: '100', name: 'e' },
  ]
  const asc = sortRows(rows, { key: 'qty', dir: 'asc' }, accessors).map((r) => r.name)
  assert.deepEqual(asc, ['b', 'd', 'a', 'e', 'c'])
  const desc = sortRows(rows, { key: 'qty', dir: 'desc' }, accessors).map((r) => r.name)
  assert.deepEqual(desc, ['e', 'a', 'b', 'd', 'c'])
  assert.deepEqual(rows.map((r) => r.name), ['a', 'b', 'c', 'd', 'e'])
  assert.equal(sortRows(rows, null, accessors), rows)
  const byName = sortRows(rows, { key: 'name', dir: 'desc' }, accessors).map((r) => r.name)
  assert.deepEqual(byName, ['e', 'd', 'c', 'b', 'a'])
})
