import { apiDelete, apiGet, apiPost } from './client'

export interface Card {
  cardId: number
  cardValue: number
  type: number
  status: number
  userId: number
  userName: string
  createDate: string
  createTime: string
  expiryDate: string
  note: string
}

export interface CardsResponse {
  total: number
  items: Card[]
}

export type GeneratedCard = {
  id: number
  code: string
  value: number
  expiry: string
  walletType: 0 | 1
}

export type GenerateCardsPayload = {
  count: number
  value: number
  expiry: string
  note?: string
  walletType: 0 | 1
}

export type SellRechargeCardsPayload = {
  staffId: number
  total: number
  idem: string
  items: Array<{ cardValue: number; quantity: number; amount: number }>
}

export const cardsApi = {
  getList: ({
    status = -1,
    limit = 50,
    offset = 0,
    userId,
  }: {
    status?: number
    limit?: number
    offset?: number
    userId?: number
  } = {}) => {
    const params = new URLSearchParams({
      status: String(status),
      limit: String(limit),
      offset: String(offset),
    })
    if (userId) params.set('userId', String(userId))
    return apiGet<CardsResponse>(`/cards?${params.toString()}`)
  },

  lockCards: (cardIds: number[]) =>
    apiPost<{ lockedCount: number; failed: number[] }, { cardIds: number[] }>(
      '/cards/lock',
      { cardIds },
    ),

  deleteCards: (cardIds: number[], confirm: boolean) =>
    apiDelete<
      { count?: number; deletedCount?: number; failed?: number[]; deleted: boolean },
      { cardIds: number[]; confirm: boolean }
    >('/cards/batch', { cardIds, confirm }),

  sellRechargeCards: (payload: SellRechargeCardsPayload) =>
    apiPost<{ voucherId: number }, SellRechargeCardsPayload>(
      '/card/recharge/sell',
      payload,
    ),

  generateCards: (payload: GenerateCardsPayload) =>
    apiPost<
      { count: number; cards: GeneratedCard[] },
      GenerateCardsPayload
    >('/card/generate', payload),
}
