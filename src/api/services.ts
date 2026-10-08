import { apiGet } from './client'

export type ServiceItem = {
  id: number
  name: string
  price: number
  unit: string
  inventory: number
  inventoryManagement: number
  // task staff-service-order (BE-3): chỉ THÊM field, server KHÔNG lọc Active (trang quản lý danh mục
  // cần thấy món đã ngừng) ⇒ nơi nào chỉ muốn món đang bán phải tự lọc `active !== 0`. Server cũ
  // chưa có field này ⇒ `undefined` (coi như đang bán, chưa có nhóm).
  active?: number
  groupId?: number
  groupName?: string
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
