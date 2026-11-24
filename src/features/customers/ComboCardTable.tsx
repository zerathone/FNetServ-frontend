import { useMemo, useState, type CSSProperties } from 'react'
import { ArrowRight, Clock } from '@phosphor-icons/react'
import type { ComboCardRow } from '../../api/users'
import { Button } from '../../design-system/components'
import {
  COMBO_CARD_COLUMNS,
  describeTimeRange,
  describeValidity,
  describeZones,
  sortComboCards,
  type ComboCardSortKey,
} from './comboCardModel'
import './customers.css'

type Props = {
  rows: readonly ComboCardRow[]
  isLoading: boolean
  /** Có lỗi ⇒ hiện thông báo + nút "Thử lại" thay cho bảng. */
  errorMessage?: string | null
  onRetry?: () => void
  /** Câu hiển thị khi không có dòng nào (khác nhau giữa có / không có từ khoá tìm). */
  emptyMessage: string
  selectedId?: number | null
  onSelect: (row: ComboCardRow) => void
}

const gridStyle = {
  '--customer-table-columns': COMBO_CARD_COLUMNS.map((column) => column.width).join(' '),
} as CSSProperties

function ValidityCell({ row }: { row: ComboCardRow }) {
  const validity = describeValidity(row)
  if (!validity) return <span className="customer-combo__empty">—</span>
  return (
    <span className="customer-combo__span" title={validity.text}>
      <span className="customer-combo__edge">
        <span className="customer-combo__date">{validity.from.date || '—'}</span>
        {validity.from.time ? <span className="customer-combo__time">{validity.from.time}</span> : null}
      </span>
      <ArrowRight className="customer-combo__arrow" size={12} weight="bold" aria-hidden="true" />
      <span className="ds-visually-hidden">đến</span>
      <span className="customer-combo__edge">
        <span className="customer-combo__date">{validity.to.date || '—'}</span>
        {validity.to.time ? <span className="customer-combo__time">{validity.to.time}</span> : null}
      </span>
    </span>
  )
}

function ZoneCell({ row }: { row: ComboCardRow }) {
  const zones = describeZones(row.zone)
  if (!zones) return <span className="customer-combo__empty">—</span>
  return (
    <span className="customer-combo__zones" title={zones.text}>
      {zones.visible.map((name) => (
        <span key={name} className="customer-combo__chip">
          {name}
        </span>
      ))}
      {zones.hiddenCount > 0 ? (
        <span className="customer-combo__chip is-more" title={zones.hidden.join(', ')}>
          +{zones.hiddenCount}
        </span>
      ) : null}
    </span>
  )
}

function TimeRangeCell({ row }: { row: ComboCardRow }) {
  const range = describeTimeRange(row)
  if (range.kind === 'unknown') return <span className="customer-combo__empty">—</span>
  if (range.kind === 'all-day') {
    return (
      <span className="customer-combo__pill is-all-day" title={`Dùng cả ngày (${range.text})`}>
        <Clock size={12} weight="bold" aria-hidden="true" />
        Cả ngày
      </span>
    )
  }
  return (
    <span className="customer-combo__pill" title={range.text}>
      <Clock size={12} weight="bold" aria-hidden="true" />
      <span className="customer-combo__time-strong">{range.from}</span>
      <ArrowRight size={10} weight="bold" aria-hidden="true" />
      <span className="ds-visually-hidden">đến</span>
      <span className="customer-combo__time-strong">{range.to}</span>
    </span>
  )
}

function cellContent(row: ComboCardRow, id: ComboCardSortKey) {
  switch (id) {
    case 'userName':
      return <strong>{row.userName}</strong>
    case 'zone':
      return <ZoneCell row={row} />
    case 'validity':
      return <ValidityCell row={row} />
    case 'timeRange':
      return <TimeRangeCell row={row} />
    case 'note':
      return row.note || '—'
  }
}

function cellTitle(row: ComboCardRow, id: ComboCardSortKey): string | undefined {
  if (id === 'userName') return row.userName
  if (id === 'note') return row.note || undefined
  return undefined
}

/**
 * Bảng "Thẻ Combo" — cột và dữ liệu như MFC `ComboCardList` (Tên đăng nhập, Máy, Thời hạn sử dụng, Thời điểm sử dụng,
 * Ghi chú). Dùng chung cho trang Tài khoản và Quản lý tài khoản. Mặc định giữ thứ tự server (mới nhất trước).
 */
export function ComboCardTable({
  rows,
  isLoading,
  errorMessage,
  onRetry,
  emptyMessage,
  selectedId,
  onSelect,
}: Props) {
  const [sortKey, setSortKey] = useState<ComboCardSortKey | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const sortedRows = useMemo(() => sortComboCards(rows, sortKey, sortDirection), [rows, sortKey, sortDirection])

  const toggleSort = (id: ComboCardSortKey) => {
    if (sortKey !== id) {
      setSortKey(id)
      setSortDirection('asc')
    } else if (sortDirection === 'asc') {
      setSortDirection('desc')
    } else {
      setSortKey(null) // lần bấm thứ ba trả về thứ tự server
      setSortDirection('asc')
    }
  }

  return (
    <div className="customer-table-scroll">
      <div className="customer-table customer-table--combo" role="table" aria-rowcount={sortedRows.length + 1}>
        <div className="customer-table__header customer-table__grid" role="row" style={gridStyle}>
          {COMBO_CARD_COLUMNS.map((column) => (
            <button
              key={column.id}
              type="button"
              role="columnheader"
              aria-sort={sortKey === column.id ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
              onClick={() => toggleSort(column.id)}
            >
              <span>{column.label}</span>
              {sortKey === column.id ? (
                <span className="customer-sort-mark" aria-hidden="true">
                  {sortDirection === 'asc' ? '↑' : '↓'}
                </span>
              ) : null}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="customer-table__empty" role="row">
            <div role="cell">Đang tải thẻ combo…</div>
          </div>
        ) : errorMessage ? (
          <div className="customer-table__empty" role="row">
            <div role="cell">
              <p>Không tải được danh sách — {errorMessage}</p>
              {onRetry ? <Button onClick={onRetry}>Thử lại</Button> : null}
            </div>
          </div>
        ) : sortedRows.length === 0 ? (
          <div className="customer-table__empty" role="row">
            <div role="cell">{emptyMessage}</div>
          </div>
        ) : (
          sortedRows.map((row) => (
            <button
              key={row.userId}
              type="button"
              role="row"
              className={`customer-table__row customer-table__grid${selectedId === row.userId ? ' is-selected' : ''}`}
              style={gridStyle}
              onClick={() => onSelect(row)}
            >
              {COMBO_CARD_COLUMNS.map((column) => (
                <div key={column.id} role="cell" title={cellTitle(row, column.id)}>
                  {cellContent(row, column.id)}
                </div>
              ))}
            </button>
          ))
        )}
      </div>
    </div>
  )
}
