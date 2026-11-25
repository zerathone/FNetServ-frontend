import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { getMaterials } from '../../api/inventory'
import { materialStockState } from './inventoryModel'

export type MaterialNavCounts = {
  /** Nguyên liệu đang dùng, còn tồn nhưng đã chạm mức tối thiểu (0 < tồn ≤ mức tối thiểu) — nhãn "Sắp hết" ở trang Nguyên liệu. */
  low: number
  /** Nguyên liệu đang dùng, hết tồn (tồn ≤ 0) — nhãn "Hết tồn". */
  out: number
}

/**
 * Hai số cho mục Nguyên liệu ở menu trái. Cùng cách phân loại với tab Nguyên liệu (`materialStockState`): nguyên liệu NGỪNG DÙNG
 * không đếm. Khoá nằm dưới `['inventory']` ⇒ mọi thao tác nhập / xuất / kiểm kê (đều `invalidateQueries(['inventory'])`) làm mới
 * ngay; ngoài ra poll 60 giây (tồn đổi theo đơn bán, không có sự kiện đẩy riêng). Server chưa có bảng (`supported:false`) hoặc
 * chưa có dữ liệu ⇒ null (không hiện).
 */
export function useMaterialNavCounts(enabled: boolean): MaterialNavCounts | null {
  const query = useQuery({
    queryKey: ['inventory', 'materials', 'nav'],
    queryFn: () => getMaterials({ activeOnly: true }),
    refetchInterval: 60_000,
    enabled,
  })
  return useMemo(() => {
    const data = query.data
    if (!data || !data.supported) return null
    let low = 0
    let out = 0
    for (const material of data.rows) {
      const state = materialStockState(material)
      if (state === 'low') low++
      else if (state === 'out') out++
    }
    return { low, out }
  }, [query.data])
}
