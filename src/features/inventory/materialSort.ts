import type { MaterialRow } from '../../api/inventory'
import { toSortNumber, type SortValue } from '../../lib/tableSort'

/** Cột sắp xếp được của các danh sách nguyên liệu (Nguyên liệu, Tồn kho): số lượng. */
export type MaterialSortKey = 'stock' | 'min'

export const MATERIAL_SORT: Record<MaterialSortKey, (m: MaterialRow) => SortValue> = {
  stock: (m) => toSortNumber(m.stockQty),
  min: (m) => toSortNumber(m.minStockQty),
}
