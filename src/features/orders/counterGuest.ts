// task staff-service-order — nhận diện khách vãng lai tại quầy. File riêng (không import model nào) để
// `orderPayModel` và `staffOrderModel` cùng dùng mà không vòng lặp module.

/** Tên máy server ép cho khách vãng lai (`ANONYMOUSSERVICE_DISPLAY`) — cũng là `paymenttb.MachineName`. */
export const GUEST_HOST_NAME = 'KHACH_TAI_QUAY'
/** Tên user singleton của khách vãng lai tại quầy (`fnet_user_sentinel::kGuestServiceUserName`). */
export const GUEST_USER_NAME = 'KHACHVANGLAI'

/**
 * Dòng Accept=0 của khách vãng lai chưa có phiếu nên `/orders/pending` trả `hostName` = tên user
 * (`KHACHVANGLAI`) chứ không phải `KHACH_TAI_QUAY` (đo trên fnetd 2026-10-08) ⇒ phải nhận diện theo CẢ
 * hostName HOẶC userName. Nhận sai ⇒ thu qua đường `cash` (PY_SERVICE_FEE) thay vì `guest`
 * (PY_GUESS_SERVICE) = sai kênh doanh thu. Máy vãng lai ngồi máy có userName = tên máy ⇒ KHÔNG khớp.
 */
export function isCounterGuest(order: { hostName?: string | null; userName?: string | null }) {
  const host = order.hostName?.trim().toLocaleUpperCase('vi')
  const user = order.userName?.trim().toLocaleUpperCase('vi')
  return host === GUEST_HOST_NAME || host === GUEST_USER_NAME || user === GUEST_USER_NAME
}
