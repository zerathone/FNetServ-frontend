// Sắp xếp phía trình duyệt cho bảng (cột thời gian / số lượng / tiền bấm ở header). Thuần hàm, không phụ thuộc React.

export type SortDirection = 'asc' | 'desc'
export type SortState<K extends string> = { key: K; dir: SortDirection } | null
export type SortValue = number | string | null | undefined

/**
 * Vòng bấm một header: chưa sắp theo cột này → `firstDir` (cột thời gian nên 'desc' = mới nhất trước) → chiều ngược lại →
 * bỏ sắp xếp (về thứ tự gốc của máy chủ).
 */
export function nextSort<K extends string>(current: SortState<K>, key: K, firstDir: SortDirection = 'asc'): SortState<K> {
  if (!current || current.key !== key) return { key, dir: firstDir }
  if (current.dir === firstDir) return { key, dir: firstDir === 'asc' ? 'desc' : 'asc' }
  return null
}

/** Số thập phân dạng chuỗi ("1.500", "-2", "12,5") hoặc số → number; rỗng/không hợp lệ → null (xếp cuối). */
export function toSortNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const n = Number(value.trim().replace(',', '.'))
  return Number.isFinite(n) ? n : null
}

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b
  return String(a).localeCompare(String(b), 'vi', { numeric: true })
}

/**
 * Trả bản đã sắp xếp (ổn định, không đổi mảng gốc). Giá trị rỗng (null/undefined) luôn nằm cuối dù tăng hay giảm.
 * `sort` null ⇒ trả đúng mảng đầu vào.
 */
export function sortRows<T, K extends string>(
  rows: readonly T[],
  sort: SortState<K>,
  accessors: Record<K, (row: T) => SortValue>,
): T[] {
  if (!sort) return rows as T[]
  const get = accessors[sort.key]
  if (!get) return rows as T[]
  const sign = sort.dir === 'asc' ? 1 : -1
  return rows
    .map((row, index) => ({ row, index, value: get(row) }))
    .sort((x, y) => {
      const xe = x.value === null || x.value === undefined
      const ye = y.value === null || y.value === undefined
      if (xe || ye) return xe && ye ? x.index - y.index : xe ? 1 : -1
      return sign * compareValues(x.value, y.value) || x.index - y.index
    })
    .map((item) => item.row)
}
