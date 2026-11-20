import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { getMaterials } from '../../api/inventory'
import {
  Button,
  FilterHeaderCell,
  ListToolbar,
  RefreshButton,
  SortHeaderCell,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { sortRows, type SortState } from '../../lib/tableSort'
import { MATERIAL_SORT, type MaterialSortKey } from './materialSort'
import { useAuthStore } from '../../store/auth'
import { MaterialBatchDialog } from './MaterialBatchDialog'
import {
  describeInventoryError,
  formatQty,
  MATERIAL_STOCK_FILTER_OPTIONS,
  MATERIAL_STOCK_LABEL,
  materialStockState,
  MAX_MATERIAL_BATCH,
  VOUCHER_BUTTON_LABEL,
  type MaterialMoveType,
  type MaterialStockFilter,
  type MaterialStockState,
} from './inventoryModel'

const formatInt = (n: number) => new Intl.NumberFormat('vi-VN').format(n)

const STATE_TONE: Record<MaterialStockState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  available: 'success',
  low: 'warning',
  out: 'danger',
  stopped: 'neutral',
}

/**
 * Mục Tồn kho của tab Quản lý kho: ảnh chụp tồn HIỆN TẠI của mọi nguyên liệu, giống mục Tồn kho của kho hàng hóa. Tick chọn
 * nhiều nguyên liệu rồi tạo phiếu nhập / xuất / kiểm kê một lần (quyền 68). Dùng chung truy vấn danh sách nguyên liệu nên
 * không tốn thêm lượt gọi máy chủ khi vừa xem tab Nguyên liệu.
 */
export function MaterialStockTab() {
  const [search, setSearch] = useState('')
  const [state, setState] = useState<MaterialStockFilter>('all')
  const [sort, setSort] = useState<SortState<MaterialSortKey>>(null)
  // Tick chọn nhiều nguyên liệu để lập phiếu nhập / xuất / kiểm kê một lần (mỗi nguyên liệu thành một dòng của phiếu).
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [voucher, setVoucher] = useState<MaterialMoveType | null>(null)
  const canStock = useAuthStore((s) => s.hasRight)(68)

  const query = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: false, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: false, lowOnly: false, limit: 1000 }),
  })

  const source = useMemo(() => query.data?.rows ?? [], [query.data])
  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi')
    const filtered = source.filter(
      (m) => (state === 'all' || materialStockState(m) === state) && (!needle || m.name.toLocaleLowerCase('vi').includes(needle)),
    )
    return sortRows(filtered, sort, MATERIAL_SORT)
  }, [source, search, state, sort])

  // Chỉ nguyên liệu ĐANG DÙNG chọn được (máy chủ từ chối điều chỉnh kho của nguyên liệu ngừng dùng) và chỉ tính những dòng
  // ĐANG HIỂN THỊ theo tìm/lọc ⇒ "k / Tổng" khớp thứ nhìn thấy; dòng đã tick nhưng đang bị lọc ẩn giữ lại trong lựa chọn,
  // hiện lại khi bỏ lọc và không đưa vào phiếu.
  const selectable = useMemo(() => rows.filter((m) => m.isActive === 1), [rows])
  const selectedRows = useMemo(() => selectable.filter((m) => selected.has(m.materialId)), [selectable, selected])
  const allVisibleSelected = selectable.length > 0 && selectedRows.length === selectable.length
  const someVisibleSelected = selectedRows.length > 0
  const toggleOne = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // "Chọn tất cả" chỉ áp cho các dòng đang hiển thị; bỏ chọn cũng chỉ bỏ các dòng đó.
  const toggleVisible = () =>
    setSelected((cur) => {
      const next = new Set(cur)
      for (const m of selectable) {
        if (allVisibleSelected) next.delete(m.materialId)
        else next.add(m.materialId)
      }
      return next
    })

  const supported = query.data?.supported !== false
  const hasActiveFilter = state !== 'all' || search.trim() !== ''

  return (
    <section className="inv-panel" aria-label="Tồn kho nguyên liệu">
      <div className="inv-filters inv-filters--report">
        <div className="ds-field inv-filters__search">
          <div className="ds-input-group ds-input-group--search">
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={search}
                aria-label="Tìm nguyên liệu"
                placeholder="Tìm theo tên nguyên liệu…"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
      </div>

      <ListToolbar
        count={
          selectedRows.length > 0 ? (
            // Có tick: "k / Tổng nguyên liệu đã chọn" + nút tạo phiếu ngay cạnh (thay chữ "Tổng N nguyên liệu").
            <span className="inv-toolbar-selection" role="region" aria-label="Thao tác nguyên liệu đã chọn">
              <span>
                <strong>{formatInt(selectedRows.length)}</strong> / <strong>{formatInt(rows.length)}</strong> nguyên liệu đã chọn
                {selectedRows.length > MAX_MATERIAL_BATCH ? ` · phiếu chỉ nhận ${MAX_MATERIAL_BATCH} nguyên liệu đầu` : ''}
              </span>
              {([1, 2, 3] as const).map((type) => (
                <Button
                  key={type}
                  type="button"
                  variant="primary"
                  icon={<Plus size={16} weight="bold" aria-hidden="true" />}
                  disabled={!canStock}
                  title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                  onClick={() => setVoucher(type)}
                >
                  {VOUCHER_BUTTON_LABEL[type]}
                </Button>
              ))}
              <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </Button>
            </span>
          ) : (
            <>
              Tổng <strong>{formatInt(rows.length)}</strong> nguyên liệu
            </>
          )
        }
        actions={<RefreshButton loading={query.isFetching} onClick={() => void query.refetch()} />}
      />

      {query.isLoading ? (
        <StateView title="Đang tải tồn kho…" />
      ) : query.isError ? (
        <StateView
          title="Không tải được tồn kho"
          description={describeInventoryError(query.error)}
          action={
            <Button type="button" onClick={() => void query.refetch()}>
              Thử lại
            </Button>
          }
        />
      ) : !supported ? (
        <StateView
          title="Cơ sở dữ liệu chưa có bảng nguyên liệu"
          description="Bảng được tạo khi máy chủ khởi động lần đầu với phiên bản mới. Hãy khởi động lại máy chủ."
        />
      ) : rows.length === 0 ? (
        <StateView
          title={source.length === 0 ? 'Chưa có nguyên liệu nào' : 'Không có nguyên liệu phù hợp'}
          description={hasActiveFilter ? 'Thử từ khóa hoặc trạng thái khác.' : undefined}
        />
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-col-check">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả nguyên liệu đang hiển thị"
                    checked={allVisibleSelected}
                    disabled={selectable.length === 0}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                    }}
                    onChange={toggleVisible}
                  />
                </th>
                <th>Nguyên liệu</th>
                <SortHeaderCell label="Tồn kho" sortKey="stock" sort={sort} onSort={setSort} className="is-num" />
                <th>Đơn vị</th>
                <SortHeaderCell label="Tối thiểu" sortKey="min" sort={sort} onSort={setSort} className="is-num" />
                <FilterHeaderCell
                  as="th"
                  label="Trạng thái"
                  options={MATERIAL_STOCK_FILTER_OPTIONS}
                  value={state}
                  baseline="all"
                  onChange={setState}
                  menuLabel="Lọc theo trạng thái tồn"
                  clearLabel="Bỏ lọc trạng thái tồn"
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const s = materialStockState(m)
                return (
                  <tr
                    key={m.materialId}
                    className={[m.isActive === 1 ? '' : 'is-off', selected.has(m.materialId) ? 'is-selected' : '']
                      .filter(Boolean)
                      .join(' ')}
                  >
                    <td className="inv-col-check">
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${m.name}`}
                        checked={m.isActive === 1 && selected.has(m.materialId)}
                        disabled={m.isActive !== 1}
                        title={m.isActive !== 1 ? 'Nguyên liệu đang ngừng dùng — không nhập/xuất được' : undefined}
                        onChange={() => toggleOne(m.materialId)}
                      />
                    </td>
                    <td>
                      <strong>{m.name}</strong>
                    </td>
                    <td className="is-num">
                      <strong>{formatQty(m.stockQty)}</strong>
                    </td>
                    <td>{m.unit || '—'}</td>
                    <td className="is-num">{formatQty(m.minStockQty)}</td>
                    <td>
                      <StatusBadge tone={STATE_TONE[s]} dot>
                        {MATERIAL_STOCK_LABEL[s]}
                      </StatusBadge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {voucher !== null ? (
        <MaterialBatchDialog
          msType={voucher}
          initialMaterialIds={selectedRows.map((m) => m.materialId)}
          onClose={() => setVoucher(null)}
          onRecorded={(ids) =>
            setSelected((cur) => {
              const next = new Set(cur)
              for (const id of ids) next.delete(id)
              return next
            })
          }
        />
      ) : null}
    </section>
  )
}
