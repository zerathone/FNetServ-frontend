import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getServices, type ServiceItem } from '../../api/services'
import { isManagedStock } from './finishedStockModel'

/**
 * Danh sách mặt hàng cho các màn kho THÀNH PHẨM. Chỉ cần tồn / tên / nhóm / đơn vị — những field server luôn trả — nên gọi
 * `GET /services` THƯỜNG, KHÔNG kèm `include=recipe,topping` (các câu SQL gộp công thức + bán kèm + tồn nguyên liệu chỉ phục vụ
 * tab Dịch vụ của danh mục, tách riêng 2026-11-25 để màn kho không phải chạy thêm). Khoá riêng `['services', 'finished']` vẫn
 * nằm dưới `['services']` ⇒ mọi `invalidateQueries(['services'])` làm mới lại.
 */
export function useFinishedServices() {
  const query = useQuery({ queryKey: ['services', 'finished'], queryFn: getServices })
  const all = query.data
  const managed = useMemo(() => (all ?? []).filter(isManagedStock), [all])
  const byId = useMemo(() => {
    const map = new Map<number, ServiceItem>()
    for (const s of all ?? []) map.set(s.id, s)
    return map
  }, [all])
  return { query, all: all ?? [], managed, byId }
}
