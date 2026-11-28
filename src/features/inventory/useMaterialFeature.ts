// Cờ "Bán kèm + kho nguyên liệu" (GET /settings/shop-counter, option -2003 dùng chung với FFood quầy). MỘT nguồn cho menu,
// trang Nguyên liệu và trang Cài đặt — cùng query key nên không nhân request.
import { useQuery } from '@tanstack/react-query'
import { getShopCounterSettings } from '../../api/settings'
import { useAuthStore } from '../../store/auth'

export const SHOP_COUNTER_QUERY_KEY = ['settings', 'shop-counter'] as const

export function useMaterialFeature() {
  const token = useAuthStore((state) => state.token)
  const query = useQuery({
    queryKey: SHOP_COUNTER_QUERY_KEY,
    queryFn: getShopCounterSettings,
    enabled: Boolean(token),
    // iCafe cũng đổi cờ này (ghi thẳng DB) nên không giữ vô hạn; lỗi (máy chủ cũ chưa có route) không thử lại mỗi lần mount.
    staleTime: 60_000,
    retry: false,
    retryOnMount: false,
  })
  return {
    /** Dữ liệu thô từ máy chủ (kèm cao/rộng) cho trang Cài đặt; `undefined` = chưa có (đang tải / lỗi / máy chủ cũ). */
    data: query.data,
    /** `null` = chưa biết (đang tải / lỗi / máy chủ cũ). Chỉ coi là TẮT khi đúng `false` — không ẩn gì khi chưa chắc. */
    enabled: query.data ? query.data.enabled : null,
    schemaReady: query.data ? query.data.schemaReady : null,
    isLoading: query.isLoading,
  }
}
