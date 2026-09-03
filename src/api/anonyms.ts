import { apiDelete, apiGet, apiPost, apiPut } from './client'

export interface AnonymousCustomer {
  id: number
  name: string
  idCard: string
  address: string
}

export type AnonymousDetailPayload = {
  id?: number
  name: string
  idCard: string
  address: string
}

export type AnonymousSessionResponse = {
  anonymId: number
  created: boolean
  clientUpdated: boolean
}

export type AnonymousPayAfterOptions = {
  prices: Array<{ priceId: number; priceType: string; price: number }>
  selectedPriceId: number
  priceAppRents: Array<{ id: number; name: string; price: number }>
}

export const anonymsApi = {
  getList: (name?: string) =>
    apiGet<AnonymousCustomer[]>(
      `/anonym/list${name ? `?name=${encodeURIComponent(name)}` : ''}`,
    ),

  create: (data: AnonymousDetailPayload) =>
    apiPost<{ id: number }, AnonymousDetailPayload>('/anonym/detail', data),

  update: (data: AnonymousDetailPayload & { id: number }) =>
    apiPut<void, AnonymousDetailPayload & { id: number }>(
      '/anonym/detail',
      data,
    ),

  delete: (id: number) =>
    apiDelete<void, { id: number }>('/anonym/list', { id }),

  assignSession: (data: { hostName: string; anonymId: number }) =>
    apiPost<
      AnonymousSessionResponse,
      { hostName: string; anonymId: number }
    >('/anonym/session', data),

  getPayAfterOptions: (machineGroupId: number, priceId?: number) => {
    const params = new URLSearchParams({
      machineGroupId: String(machineGroupId),
    })
    if (priceId) params.set('priceId', String(priceId))
    return apiGet<AnonymousPayAfterOptions>(
      `/pricing/anonym-payafter-options?${params.toString()}`,
    )
  },

  calcPrepaid: (params: {
    machineGroupId: number
    priceId: number
    priceAppRentId?: number
    money?: number
    minutes?: number
  }) => {
    const query = new URLSearchParams({
      machineGroupId: String(params.machineGroupId),
      priceId: String(params.priceId),
    })
    if (params.priceAppRentId) {
      query.set('priceAppRentId', String(params.priceAppRentId))
    }
    if (params.money !== undefined) query.set('money', String(params.money))
    if (params.minutes !== undefined) query.set('minutes', String(params.minutes))
    return apiGet<{ minutes: number; money: number }>(
      `/pricing/anonym-prepaid-calc?${query.toString()}`,
    )
  },
}
