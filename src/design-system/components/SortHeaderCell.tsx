import { CaretDown, CaretUp, CaretUpDown } from '@phosphor-icons/react'
import { nextSort, type SortDirection, type SortState } from '../../lib/tableSort'

/**
 * Ô header `<th>` bấm để sắp xếp bảng (cột thời gian / số lượng / tiền). Bấm lần lượt: `firstDir` → ngược lại → bỏ sắp xếp.
 * Chỉ khai báo trạng thái (`sort`) và nhận kết quả (`onSort`); việc sắp dòng do `sortRows` (lib/tableSort) ở trang gọi.
 */
export function SortHeaderCell<K extends string>({
  label,
  sortKey,
  sort,
  onSort,
  firstDir = 'asc',
  className,
}: {
  label: string
  sortKey: K
  sort: SortState<K>
  onSort: (next: SortState<K>) => void
  /** Chiều của lần bấm đầu: cột thời gian nên 'desc' (mới nhất trước). */
  firstDir?: SortDirection
  className?: string
}) {
  const active = sort?.key === sortKey ? sort.dir : null
  return (
    <th className={className} aria-sort={active === 'asc' ? 'ascending' : active === 'desc' ? 'descending' : 'none'}>
      <button
        type="button"
        className={`ds-sort-head${active ? ' is-active' : ''}`}
        title={`Sắp xếp theo ${label.toLocaleLowerCase('vi')}`}
        onClick={() => onSort(nextSort(sort, sortKey, firstDir))}
      >
        <span>{label}</span>
        <span className="ds-sort-head__icon" aria-hidden="true">
          {active === 'asc' ? (
            <CaretUp size={12} weight="bold" />
          ) : active === 'desc' ? (
            <CaretDown size={12} weight="bold" />
          ) : (
            <CaretUpDown size={12} weight="bold" />
          )}
        </span>
      </button>
    </th>
  )
}
