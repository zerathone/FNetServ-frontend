import { apiGet } from './client'

export type ServiceItem = {
  id: number
  name: string
  price: number
  unit: string
  inventory: number
  inventoryManagement: number
}

export function getServices() {
  return apiGet<ServiceItem[]>('/services')
}

export const servicesApi = {
  // Chuyển phí máy
  transferFee: async (data: { fromMachine: string; toMachine: string; amount: number }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof data>('/service/transferfee', data);
  },

  // Thanh toán đơn chờ
  payRequest: async (data: { id: number; type: number }) => {
    const { apiPost } = await import('./client');
    return apiPost<any, typeof data>('/service/payrequest', data);
  }
};
