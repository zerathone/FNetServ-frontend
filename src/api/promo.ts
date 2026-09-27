import { apiGet, apiPost } from './client'

export type PromoBannerItem = {
  id: string
  w: number
  h: number
  /** data:image/png;base64,... hoặc data:image/jpeg;base64,... — backend đã kiểm magic bytes. */
  image: string
}

export type PromoBannersResponse = {
  items: PromoBannerItem[]
}

// GET /promo/banners (FNetHttp/PromoHandlers.cpp) — cụm banner quảng cáo động trên topbar, cùng
// nguồn Authen::get_features(G4)["f0"] với m_dynPromotionButtons MFC (ServerSideDlg.cpp). Backend
// đã lọc theo khung giờ + kiểm URL/ảnh, FE chỉ render.
export function getPromoBanners() {
  return apiGet<PromoBannersResponse>('/promo/banners')
}

// POST /promo/click — trả URL đích (có gắn tracking) cho 1 banner theo id ổn định (MD5 của
// url|resource|start). Xin URL mới mỗi lần bấm; id phải còn hợp lệ tại thời điểm click.
export function getPromoClickUrl(id: string) {
  return apiPost<{ url: string }, { id: string }>('/promo/click', { id })
}
