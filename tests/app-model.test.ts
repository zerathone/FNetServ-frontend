import assert from 'node:assert/strict'
import test from 'node:test'
import {
  canMutateApp,
  decodeRestrictType,
  encodeRestrictType,
  findCrossListConflict,
  matchesApp,
  validateAppDraft,
} from '../src/features/apps/appModel.ts'

const allowEntry = {
  id: 1,
  name: 'launcher.exe',
  description: 'Trình khởi chạy',
  restrictType: 0,
  hash: '',
  addedBy: 0,
}

const restrictEntry = {
  id: 2,
  name: 'blocked.exe',
  description: 'Không cho chạy',
  restrictType: 17,
  hash: 'd41d8cd98f00b204e9800998ecf8427e',
  addedBy: 0,
}

test('application ownership keeps central policies read-only', () => {
  assert.equal(canMutateApp(allowEntry), true)
  assert.equal(canMutateApp({ ...allowEntry, addedBy: 1 }), false)
  assert.equal(canMutateApp({ ...allowEntry, addedBy: 2 }), false)
})

test('application restrict type preserves MFC bit packing', () => {
  assert.equal(encodeRestrictType('name', false), 0)
  assert.equal(encodeRestrictType('name', true), 1)
  assert.equal(encodeRestrictType('hash', false), 16)
  assert.equal(encodeRestrictType('hash', true), 17)
  assert.deepEqual(decodeRestrictType(17), {
    mode: 'hash',
    applyToAvailable: true,
  })
})

test('application search and cross-list exclusion match legacy policy', () => {
  const lists = { allow: [allowEntry], restrict: [restrictEntry] }
  assert.equal(matchesApp(restrictEntry, 'Không cho'), true)
  assert.equal(matchesApp(restrictEntry, 'd41d8c'), true)
  assert.equal(matchesApp(restrictEntry, 'khác'), false)
  assert.equal(findCrossListConflict(' BLOCKED.EXE ', 'allow', lists)?.id, 2)
  assert.equal(findCrossListConflict('new.exe', 'allow', lists), null)
})

test('application draft validation follows live handler lengths and MD5 format', () => {
  assert.equal(
    validateAppDraft({
      type: 'restrict',
      name: 'blocked.exe',
      description: '',
      mode: 'hash',
      hash: 'd41d8cd98f00b204e9800998ecf8427e',
    }),
    null,
  )
  assert.match(
    validateAppDraft({
      type: 'restrict',
      name: 'blocked.exe',
      description: '',
      mode: 'hash',
      hash: 'not-md5',
    }) ?? '',
    /MD5/,
  )
  assert.match(
    validateAppDraft({
      type: 'allow',
      name: 'x'.repeat(101),
      description: '',
      mode: 'name',
      hash: '',
    }) ?? '',
    /100/,
  )
})
