import { apiDelete, apiGet, apiPost } from './client'

export interface Card {
  cardId: number
  cardCode: string
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

export type RechargeCardAvailable = {
  cardValue: number
  quantity: number
}

export type CardDateField = 'createDate' | 'modifyDate' | 'expiryDate'

export const cardsApi = {
  getList: ({
    status = -1,
    limit = 50,
    offset = 0,
    userId,
    dateField,
    from,
    to,
  }: {
    status?: number
    limit?: number
    offset?: number
    userId?: number
    dateField?: CardDateField
    from?: string
    to?: string
  } = {}) => {
    const params = new URLSearchParams({
      status: String(status),
      limit: String(limit),
      offset: String(offset),
    })
    if (userId) params.set('userId', String(userId))
    if (from && to) {
      params.set('dateField', dateField ?? 'createDate')
      params.set('from', from)
      params.set('to', to)
    }
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

  getRechargeAvailable: () =>
    apiGet<{ items: RechargeCardAvailable[] }>('/card/recharge/available'),

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
