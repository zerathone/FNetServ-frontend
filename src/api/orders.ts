import { apiGet, apiPost } from './client'

export type PendingOrder = {
  serviceDetailId: number
  userId: number
  userName: string
  serviceName: string
  quantity: number
  price: number
  amount: number
  servicePaid: number

  // task 2.24 (P0) — backend đã trả các field này (BE gửi null khi không tra được, KHÔNG gửi "").
  //  hostName: null = server không biết tên máy (máy đã rời mạng và không phải máy vãng lai)
  //  parentId/topping: null = DB của khách CHƯA có schema recipe/topping → không gom topping được
  hostName?: string | null
  serviceDate?: string
  serviceTime?: string
  parentId?: number | null
  topping?: number | null
  unit?: string

  // task orders-qr-qty (P2) — chỉ có khi gọi `?includePaid=1`.
  //  voucherId: phiếu gắn với dòng (đơn trả QR = phiếu PY_SERVICE_QR; 0 = chưa có)
  //  serviceAmount: ServiceAmount trong DB (đơn QR = số ĐÃ THU)
  //  unitPrice: đơn giá snapshot lúc đặt = ServiceAmount / ServiceQuantity (BE tính lại theo số này)
  voucherId?: number
  serviceAmount?: number
  unitPrice?: number
}

// task 2.24 (P2) — một đơn combo khách mua từ máy trạm đang chờ thu ngân xác nhận (Accept=0).
export type PendingComboOrder = {
  comboCardId: number
  comboId: number
  comboName: string
  price: number
  ownerId: number
  ownerName: string
  comboUserId: number
  comboUserName: string
  hostName: string | null
  createdAt: string
  expireDate: string
  /** null = không lưu được hình thức thanh toán khi đơn còn chờ (BE không suy diễn) */
  paymentMethod: string | null
  accept: number
  zone: string
}

type PendingComboResponse = {
  windowHours: number
  items: PendingComboOrder[]
}

export type InventoryWarning = { serviceId: number; serviceName: string; inventory: number }
export type InventoryShortItem = InventoryWarning & { requested: number }

type ApproveOrderResponse = {
  accepted: number
  paymentId?: number
  /** task orders-qr-qty: tổng tiền BE tính lại và ghi vào phiếu sổ chờ. */
  amount?: number
  /** task orders-qr-qty (P5): món chạm ngưỡng cảnh báo tồn sau khi trừ. */
  inventoryWarnings?: InventoryWarning[]
}

/**
 * includePaid: thêm đơn khách đã trả QR (servicePaid=1) + voucherId/serviceAmount/unitPrice.
 * Mặc định tắt = response y hệt trước (trang `/orders/legacy` vẫn dùng dạng cũ).
 */
export function getPendingOrders(userId?: string, options: { includePaid?: boolean } = {}) {
  const params = new URLSearchParams()
  if (userId) params.set('userId', userId)
  if (options.includePaid) params.set('includePaid', '1')
  const query = params.toString()
  return apiGet<PendingOrder[]>(`/orders/pending${query ? `?${query}` : ''}`)
}

export function acceptServiceOrder(payload: {
  staffId: string;
  userId: number;
  anonymous?: boolean;
  hostName: string;
  idem: string;
  items: Array<{ detailId: number; quantity: number; amount: number; alreadyPaid: boolean }>;
}) {
  return apiPost<ApproveOrderResponse, typeof payload>('/service/accept', payload);
}

export function cancelServiceOrder(payload: {
  staffId: string;
  // task orders-qr-qty (P3): field mô tả để BE ghi log hủy đầy đủ (optional, additive).
  items: Array<{
    type: 'service' | 'combo';
    id: number;
    machineName?: string;
    customerInfo?: string;
    serviceName?: string;
    quantity?: number;
    amount?: number;
  }>;
}) {
  return apiPost<{ cancelled: number }, typeof payload>('/service/cancel', payload);
}

export function getServicePaidLabel(servicePaid: number) {
  switch (servicePaid) {
    case 0:
      return 'Chưa thanh toán'
    case 1:
      return 'Đã trả QR'
    case 4:
      return 'Khách chọn tiền mặt tại máy'
    case 5:
      return 'Khách chọn cấn trừ'
    default:
      // Giữ nguyên dạng forward-compatible: giá trị lạ vẫn đọc được, không che lỗi.
      return `Unknown (${servicePaid})`
  }
}

// ===== task 2.24 (P2/P3) — tab "Combo chờ duyệt" =====
export async function getPendingComboOrders() {
  const data = await apiGet<PendingComboResponse>('/orders/pending/combo')
  return data?.items ?? []
}

/** MONEY-CORE: thu ngân xác nhận đã nhận tiền mặt → chốt đơn combo. `idem` là BẮT BUỘC. */
export function acceptComboOrder(payload: { comboCardId: number; idem: string; hostName?: string }) {
  return apiPost<
    { comboCardId: number; paymentId: number; accepted: boolean; duplicated: boolean; applied: boolean },
    typeof payload
  >('/orders/combo/accept', payload)
}

export function rejectComboOrder(payload: { comboCardId: number; idem: string }) {
  return apiPost<{ comboCardId: number; rejected: boolean; duplicated: boolean }, typeof payload>(
    '/orders/combo/reject',
    payload,
  )
}
