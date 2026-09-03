import { apiGet } from './client'

export type RevenueByType = {
  paymentType: number
  amount: number
}

export type RevenueSummary = {
  total: number
  byType: RevenueByType[]
}

export function getRevenueSummary(params: { from: string; to: string; staffId?: string }) {
  const query = new URLSearchParams({
    from: params.from,
    to: params.to,
  })

  if (params.staffId) {
    query.set('staffId', params.staffId)
  }

  return apiGet<RevenueSummary>(`/reports/revenue?${query.toString()}`)
}
