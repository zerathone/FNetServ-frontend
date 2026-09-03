import assert from 'node:assert/strict'
import test from 'node:test'
import type { Card } from '../src/api/cards.ts'
import {
  canLockCard,
  canServerDeleteCard,
  cardStatusMeta,
  formatGeneratedCards,
} from '../src/features/cards/cardModel.ts'

function card(patch: Partial<Card> = {}): Card {
  return {
    cardId: 1,
    cardValue: 50_000,
    type: 0,
    status: 0,
    userId: 0,
    userName: '',
    createDate: '2026-07-30',
    createTime: '10:00:00',
    expiryDate: '2026-12-31',
    note: '',
    ...patch,
  }
}

test('card actions mirror backend state guards', () => {
  assert.equal(canLockCard(card()), true)
  assert.equal(canLockCard(card({ status: 1 })), false)
  assert.equal(canServerDeleteCard(card(), '2026-07-30'), false)
  assert.equal(
    canServerDeleteCard(card({ expiryDate: '2026-07-29' }), '2026-07-30'),
    true,
  )
  assert.equal(canServerDeleteCard(card({ status: 1 }), '2026-07-30'), true)
  assert.equal(cardStatusMeta(2).label, 'Đã khóa')
})

test('generated-card export retains code, value, expiry and wallet type', () => {
  const text = formatGeneratedCards([
    { code: 'ABC123', value: 50_000, expiry: '2026-12-31', walletType: 0 },
  ])
  assert.match(text, /ABC123/)
  assert.match(text, /50000/)
  assert.match(text, /2026-12-31/)
  assert.match(text, /Chính/)
})
