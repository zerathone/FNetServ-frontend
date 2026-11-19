import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getServicesWithRecipe, type ServiceItem } from '../../api/services'
import { isManagedStock } from './finishedStockModel'

/**
 * Danh sách mặt hàng cho các màn kho THÀNH PHẨM. Dùng đúng query key của trang Dịch vụ & hàng hóa
 * (`['services', 'catalog']`) ⇒ một request cho cả trang, và mọi `invalidateQueries(['services'])` làm mới lại.
 */
export function useFinishedServices() {
  const query = useQuery({ queryKey: ['services', 'catalog'], queryFn: getServicesWithRecipe })
  const all = query.data
  const managed = useMemo(() => (all ?? []).filter(isManagedStock), [all])
  const byId = useMemo(() => {
    const map = new Map<number, ServiceItem>()
    for (const s of all ?? []) map.set(s.id, s)
    return map
  }, [all])
  return { query, all: all ?? [], managed, byId }
}
