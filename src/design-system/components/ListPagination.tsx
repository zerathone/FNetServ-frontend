import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { Button } from './Button'

type ListPaginationProps = {
  page: number
  totalPages?: number
  canNext: boolean
  onPrevious: () => void
  onNext: () => void
  className?: string
}

/** Compact, top-of-list pagination for all paged collections. */
export function ListPagination({
  page,
  totalPages,
  canNext,
  onPrevious,
  onNext,
  className = '',
}: ListPaginationProps) {
  const pageLabel = totalPages ? `Trang ${page + 1}/${totalPages}` : `Trang ${page + 1}`

  return (
    <nav className={`ds-list-pagination ${className}`.trim()} aria-label="Phân trang danh sách">
      <span className="ds-list-pagination__status" aria-live="polite">{pageLabel}</span>
      <div className="ds-list-pagination__actions">
        <Button type="button" variant="secondary" icon={<CaretLeft size={18} weight="bold" aria-hidden="true" />} disabled={page === 0} onClick={onPrevious}>
          Trước
        </Button>
        <Button type="button" variant="secondary" icon={<CaretRight size={18} weight="bold" aria-hidden="true" />} disabled={!canNext} onClick={onNext}>
          Sau
        </Button>
      </div>
    </nav>
  )
}
