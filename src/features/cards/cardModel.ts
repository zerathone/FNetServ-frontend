import type { Card } from '../../api/cards.ts'

export type CardStatusMeta = {
  label: string
  tone: 'success' | 'neutral' | 'danger'
}

export function cardStatusMeta(status: number): CardStatusMeta {
  switch (status) {
    case 0:
      return { label: 'Chưa dùng', tone: 'success' }
    case 1:
      return { label: 'Đã dùng', tone: 'neutral' }
    case 2:
      return { label: 'Đã khóa', tone: 'danger' }
    default:
      return { label: `Trạng thái ${status}`, tone: 'neutral' }
  }
}

export function isCardExpired(card: Card, today: string) {
  return Boolean(card.expiryDate && card.expiryDate < today)
}

export function canLockCard(card: Card) {
  return card.status === 0
}

export function canServerDeleteCard(card: Card, today: string) {
  return card.status !== 0 || isCardExpired(card, today)
}

export function formatGeneratedCards(cards: Array<{
  code: string
  value: number
  expiry: string
  walletType: number
}>) {
  return [
    'Mã thẻ\tMệnh giá\tHết hạn\tVí',
    ...cards.map(
      (card) =>
        `${card.code}\t${card.value}\t${card.expiry}\t${
          card.walletType === 0 ? 'Chính' : 'Khuyến mãi'
        }`,
    ),
  ].join('\n')
}
