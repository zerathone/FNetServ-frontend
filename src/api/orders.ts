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

  // task web-orders-completed-stat — CHỈ có ở `/orders/completed-today` (join PaymentTb).
  //  paidDate/paidTime: lúc THU TIỀN (VoucherDate/Time) — khác serviceDate/serviceTime = lúc khách gọi món
  paymentType?: number
  paymentMethod?: CompletedPaymentMethod
  paidDate?: string
  paidTime?: string
}

/**
 * Hình thức của phiếu dịch vụ đã thu (BE map từ PaymentType): cash = tiền mặt tại quầy (gồm khách không
 * dùng máy), deduct = cấn trừ, qr = QR, online = chuyển khoản, transfer = nợ dịch vụ chuyển từ máy khác
 * rồi người nhận trả.
 */
export type CompletedPaymentMethod = 'cash' | 'qr' | 'deduct' | 'online' | 'transfer'

export type CompletedOrderStats = {
  date: string
  /** Mốc BẮT ĐẦU ca = đầu khung thống kê, "YYYY-MM-DD HH:MM:SS" giờ máy chủ. Optional: BE cũ chưa trả. */
  shiftStart?: string
  completed: {
    /** Số PHIẾU (một phiếu gồm nhiều món), không phải số món. */
    count: number
    amount: number
    /** Luôn đủ 5 khóa theo thứ tự cash, qr, deduct, online, transfer (nhóm rỗng count=0). */
    byType: { key: CompletedPaymentMethod; count: number; amount: number }[]
  }
  /** Số MÓN bị hủy trong ngày qua `/service/cancel` (hủy combo / hủy từ Qt-MFC không ghi log nên không đếm). */
  cancelled: { count: number }
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

/**
 * Đơn ĐÃ bấm "Chấp nhận" (Accept=1) nhưng còn nợ tiền (ServicePaid IN 0,4,5) -- không còn nằm trong
 * `/orders/pending` (chỉ trả Accept=0). Luôn kèm `voucherId`/`serviceAmount`/`unitPrice` (bắt buộc để
 * gọi `/service/pay`/`/service/clearaccepted` -- xem `api/payment.ts`).
 */
export function getAcceptedUnpaidOrders(userId?: string) {
  const params = new URLSearchParams()
  if (userId) params.set('userId', userId)
  const query = params.toString()
  return apiGet<PendingOrder[]>(`/orders/accepted-unpaid${query ? `?${query}` : ''}`)
}

export function acceptServiceOrder(payload: {
  staffId: string;
  userId: number;
  anonymous?: boolean;
  hostName: string;
  idem: string;
  items: Array<{ detailId: number; quantity: number; amount: number; alreadyPaid: boolean }>;
  /** task staff-service-order: opt-in của WebUI — BE báo máy trạm sau khi duyệt (Qt không gửi). */
  fullCore?: boolean;
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

export type AcceptedUnpaidSummary = { count: number; amount: number }

/**
 * Đơn đã bấm "Chấp nhận" (Accept=1) nên không còn nằm trong `/orders/pending` (chỉ trả Accept=0),
 * nhưng vẫn CHƯA thu tiền (ServicePaid=0) — về nghiệp vụ vẫn "chờ giải quyết". Toàn hệ thống,
 * không lọc theo userId đang filter trên trang.
 */
export function getAcceptedUnpaidSummary() {
  return apiGet<AcceptedUnpaidSummary>('/orders/accepted-unpaid/summary')
}

/**
 * Đơn dịch vụ đã THU TIỀN XONG hôm nay (Accept=1, ServicePaid=1, phiếu thu trong ngày thuộc 6 loại
 * phiếu dịch vụ — không gồm nạp giờ/thẻ/combo). Cùng shape `/orders/pending`, LUÔN kèm
 * voucherId/serviceAmount/unitPrice + paymentMethod/paidDate/paidTime — gom theo voucherId ở FE
 * (xem `groupCompletedOrders`).
 */
export function getCompletedTodayOrders() {
  return apiGet<PendingOrder[]>('/orders/completed-today')
}

/** Tổng hợp tile "Đơn hoàn thành" — CÙNG tập dòng với `getCompletedTodayOrders`, toàn quán. */
export function getCompletedOrderStats() {
  return apiGet<CompletedOrderStats>('/orders/completed/stats')
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

// ===== task staff-service-order — nhân viên gọi món hộ khách =====

export type StaffOrderPayload = {
  /** Hội viên/khách đang ngồi máy: userId > 0. Khách vãng lai tại quầy: 0 + `anonymous:true`. */
  userId: number
  anonymous: boolean
  /** Vãng lai: server ép "KHACH_TAI_QUAY" (bỏ qua giá trị gửi). Tối đa 100 ký tự. */
  hostName: string
  /** ≤ 50 ký tự (`paymenttb.zOid`) — xem `lib/idempotency.ts`. */
  idem: string
  /** Server KHÔNG nhận giá/số tiền từ client — chỉ serviceId + số lượng 1..99, tối đa 50 dòng. */
  items: Array<{ serviceId: number; quantity: number }>
}

export type StaffOrderLine = { detailId: number; serviceId: number; quantity: number; amount: number }

/** Tạo dòng `Accept=0, ServicePaid=0` — CHƯA có phiếu, CHƯA trừ kho. `detailId` đi tiếp bước 2. */
export type StaffOrderResponse = {
  userId: number
  /** Vãng lai: luôn "KHACH_TAI_QUAY" (server ép) — gửi lại đúng chuỗi này ở bước 2. */
  hostName: string
  anonymous: boolean
  items: StaffOrderLine[]
  /** Tổng BE tính lại = Σ số lượng × giá hiện hành (không giảm giá/voucher). */
  amount: number
  /** Cảnh báo DỰ KIẾN (kho chưa trừ ở bước này) — toast cảnh báo của bước 2 thay vì bước này. */
  inventoryWarnings: InventoryWarning[]
  /** true = trả lại từ cache idem (retry), KHÔNG tạo dòng mới. */
  duplicated?: boolean
}

export function createStaffOrder(payload: StaffOrderPayload) {
  return apiPost<StaffOrderResponse, StaffOrderPayload>('/service/staff-order', payload)
}

/** Đúng 1 trong 2. Web luôn gửi `detailIds` (≤ 200, cùng 1 khách) — vãng lai dùng chung userId nên không gửi theo nhóm. */
export type PrintTargetsRequest = { voucherId: number } | { detailIds: number[] }

export type PrintTargetItem = {
  detailId: number
  serviceName: string
  quantity: number
  unit: string
  amount: number
}

export type PrintTargetPrinter = {
  printerId: number
  name: string
  /**
   * `printertb.Type` = khổ giấy: 1 = POS80 (576 dot), 2 = POS58 (384 dot), 0 = không phải máy in nhiệt.
   * ⚠️ Dùng `type` để chọn khổ — KHÔNG dùng `paperWidth` của BE-2 (đang đảo 384/576, xem handoff
   * "Kết quả thực hiện" mục FE).
   */
  type: number
  paperWidth: number
  hasIp: boolean
  /** BE: có khổ nhiệt VÀ có IP ⇒ WebUI in được qua `/printer/print`. */
  printable: boolean
  items: PrintTargetItem[]
}

export type PrintTargetsResponse = {
  header: {
    hostName: string
    userId: number
    userName: string
    voucherId: number
    staffId: number
    staffName: string
    paidDate: string
    paidTime: string
    orderDate: string
    orderTime: string
  }
  printers: PrintTargetPrinter[]
  /** Món không map máy in Active nào (Qt cũng im lặng không in những món này). */
  unrouted: PrintTargetItem[]
  notFound: number[]
}

export function getPrintTargets(request: PrintTargetsRequest) {
  return apiPost<PrintTargetsResponse, PrintTargetsRequest>('/orders/print-targets', request)
}
