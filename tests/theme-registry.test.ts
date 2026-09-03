import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTheme, themeIds, themes } from '../src/design-system/theme/themeRegistry.ts'

test('all official themes have one registry entry', () => {
  assert.deepEqual(
    themes.map((theme) => theme.id),
    [...themeIds],
  )
})

test('legacy and unknown themes migrate safely', () => {
  assert.equal(normalizeTheme('swarm'), 'warm')
  assert.equal(normalizeTheme('nature'), 'classic')
  assert.equal(normalizeTheme('unknown'), 'classic')
})
