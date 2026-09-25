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

/** 'dd-mm-YYYY' -> 'YYYY-MM-DD'; giữ nguyên nếu không đúng dạng. */
function toIsoDate(value: string) {
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(value)
  return match ? `${match[3]}-${match[2]}-${match[1]}` : value
}

export function isCardExpired(card: Card, today: string) {
  if (typeof card.expired === 'boolean') return card.expired
  return Boolean(card.expiryDate && toIsoDate(card.expiryDate) < today)
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
