import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ClipboardText, DownloadSimple, MagnifyingGlass, UploadSimple } from '@phosphor-icons/react'
import { getMaterials, toggleMaterialActive, type MaterialRow } from '../../api/inventory'
import {
  Button,
  FilterHeaderCell,
  ListToolbar,
  RefreshButton,
  SortHeaderCell,
  StateView,
  StatusBadge,
  Switch,
} from '../../design-system/components'
import { sortRows, type SortState } from '../../lib/tableSort'
import { MATERIAL_SORT, type MaterialSortKey } from './materialSort'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { MaterialBatchDialog } from './MaterialBatchDialog'
import { MaterialEditor, StockDialog } from './MaterialDialogs'
import {
  describeInventoryError,
  formatQty,
  MATERIAL_STOCK_FILTER_OPTIONS,
  MATERIAL_STOCK_LABEL,
  MAX_MATERIAL_BATCH,
  materialStockState,
  type MaterialMoveType,
  type MaterialStockFilter,
  type MaterialStockState,
} from './inventoryModel'
import '../services/services.css'
import './inventory.css'

const STATE_TONE: Record<MaterialStockState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  available: 'success',
  low: 'warning',
  out: 'danger',
  stopped: 'neutral',
}

const BATCH_BUTTON_LABEL: Record<MaterialMoveType, string> = { 1: 'Nhập kho', 2: 'Xuất kho', 3: 'Kiểm kê' }

/** Icon dùng chung cho nút Nhập / Xuất / Kiểm kê ở thanh thao tác hàng loạt và ở từng dòng. */
const BATCH_BUTTON_ICON: Record<MaterialMoveType, ReactNode> = {
  1: <DownloadSimple size={16} weight="bold" aria-hidden="true" />,
  2: <UploadSimple size={16} weight="bold" aria-hidden="true" />,
  3: <ClipboardText size={16} weight="bold" aria-hidden="true" />,
}

const formatInt = (n: number) => new Intl.NumberFormat('vi-VN').format(n)

/**
 * Tab Nguyên liệu của trang Kho, cùng cách quản lý với danh sách dịch vụ: hàng ô thống kê bấm
 * để lọc (Còn tồn / Sắp hết / Hết tồn / Ngừng dùng), ô tìm kiếm, danh sách. Quyền: 64 sửa danh mục, 68 điều chỉnh kho.
 * (Đơn vị tính dùng chung nên nút nằm ở đầu trang Kho.) Kiểu dáng ô thống kê dùng chung `.service-*` của services.css.
 */
export function MaterialsTab() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canCatalog = hasRight(64)
  const canStock = hasRight(68)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MaterialStockFilter>('all')
  const [sort, setSort] = useState<SortState<MaterialSortKey>>(null)
  const [editing, setEditing] = useState<{ material: MaterialRow | null } | null>(null)
  const [stock, setStock] = useState<{ material: MaterialRow; msType: MaterialMoveType } | null>(null)
  // Tick chọn nhiều nguyên liệu để nhập / xuất / kiểm kê một phiếu (mỗi nguyên liệu một dòng).
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [batchType, setBatchType] = useState<MaterialMoveType | null>(null)

  // Lấy cả nguyên liệu ngừng dùng (hiện mờ + nhãn như món "Ngừng bán" ở danh sách dịch vụ); lọc ở client.
  const query = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: false, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: false, lowOnly: false, limit: 1000 }),
  })

  const toggle = useMutation({
    mutationFn: (m: MaterialRow) => toggleMaterialActive({ materialId: m.materialId, isActive: m.isActive !== 1 }),
    onSuccess: () => {
      pushToast('Đã cập nhật trạng thái nguyên liệu.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  const source = useMemo(() => query.data?.rows ?? [], [query.data])
  const counts = useMemo(() => {
    const c: Record<MaterialStockState, number> = { available: 0, low: 0, out: 0, stopped: 0 }
    for (const m of source) c[materialStockState(m)] += 1
    return c
  }, [source])

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi')
    const filtered = source.filter(
      (m) =>
        (filter === 'all' || materialStockState(m) === filter) &&
        (!needle || m.name.toLocaleLowerCase('vi').includes(needle)),
    )
    return sortRows(filtered, sort, MATERIAL_SORT)
  }, [source, search, filter, sort])

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
  const hasActiveFilter = filter !== 'all' || search.trim() !== ''
  const toggleFilter = (value: MaterialStockFilter) => setFilter((current) => (current === value ? 'all' : value))

  const statButton = (state: MaterialStockState) => (
    <button
      type="button"
      className={`service-stat ${filter === state ? 'is-active' : ''}`}
      onClick={() => toggleFilter(state)}
    >
      <span className={`service-stat__dot service-stat__dot--${state}`} aria-hidden="true" />
      <span className="service-stat__label">{MATERIAL_STOCK_LABEL[state]}</span>
      <strong>{counts[state]}</strong>
    </button>
  )

  return (
    <>
      <section className="service-panel__summary" aria-label="Tóm tắt danh mục nguyên liệu">
        <button
          type="button"
          className={`service-stat service-stat--total ${filter === 'all' ? 'is-active' : ''}`}
          onClick={() => setFilter('all')}
        >
          <strong>{new Intl.NumberFormat('vi-VN').format(source.length)}</strong>
          <span className="service-stat__label">nguyên liệu</span>
        </button>
        <div className="service-stat-row">
          {statButton('available')}
          {statButton('low')}
          {statButton('out')}
          {statButton('stopped')}
        </div>
      </section>

      <section className="service-filters" aria-label="Lọc nguyên liệu">
        <div className="ds-field service-filters__search">
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
        <Button
          type="button"
          variant="primary"
          className="service-filters__add"
          disabled={!canCatalog || !supported}
          title={canCatalog ? undefined : 'Cần quyền Quản lý kho (64)'}
          onClick={() => setEditing({ material: null })}
        >
          Thêm nguyên liệu
        </Button>
      </section>

      <section className="service-panel" aria-label="Danh sách nguyên liệu">
        <ListToolbar
          count={
            selectedRows.length > 0 ? (
              // Có tick: "k / Tổng nguyên liệu đã chọn" + nút thao tác hàng loạt ngay cạnh (thay chữ "Tổng N").
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
                    icon={BATCH_BUTTON_ICON[type]}
                    disabled={!canStock}
                    title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                    onClick={() => setBatchType(type)}
                  >
                    {BATCH_BUTTON_LABEL[type]}
                  </Button>
                ))}
                <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
                  Bỏ chọn
                </Button>
              </span>
            ) : (
              <>
                Tổng <strong>{formatInt(rows.length)}</strong>
              </>
            )
          }
          actions={<RefreshButton loading={query.isFetching} onClick={() => void query.refetch()} />}
        />
      {query.isLoading ? (
        <StateView title="Đang tải nguyên liệu…" />
      ) : query.isError ? (
        <StateView
          title="Không tải được nguyên liệu"
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
          title={hasActiveFilter ? 'Không có nguyên liệu phù hợp' : 'Chưa có nguyên liệu nào'}
          description={hasActiveFilter ? 'Thử từ khóa hoặc bộ lọc tồn kho khác.' : 'Bấm “Thêm nguyên liệu” để bắt đầu.'}
          action={
            hasActiveFilter ? (
              <Button
                type="button"
                onClick={() => {
                  setFilter('all')
                  setSearch('')
                }}
              >
                Xóa bộ lọc
              </Button>
            ) : undefined
          }
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
                <SortHeaderCell label="Tồn kho" sortKey="stock" sort={sort} onSort={setSort} />
                <th>Đơn vị</th>
                <SortHeaderCell label="Tối thiểu" sortKey="min" sort={sort} onSort={setSort} className="is-num" />
                <FilterHeaderCell
                  as="th"
                  label="Trạng thái"
                  options={MATERIAL_STOCK_FILTER_OPTIONS}
                  value={filter}
                  baseline="all"
                  onChange={setFilter}
                  menuLabel="Lọc theo trạng thái tồn"
                  clearLabel="Bỏ lọc trạng thái tồn"
                />
                <th className="inv-table__sale">Đang dùng</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
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
                    {m.materialNote ? <small className="inv-muted">{m.materialNote}</small> : null}
                  </td>
                  <td>
                    <StatusBadge
                      tone={STATE_TONE[materialStockState(m)]}
                      dot
                      title={MATERIAL_STOCK_LABEL[materialStockState(m)]}
                    >
                      {formatQty(m.stockQty)}
                    </StatusBadge>
                  </td>
                  <td>{m.unit || '—'}</td>
                  <td className="is-num">{formatQty(m.minStockQty)}</td>
                  <td>
                    <StatusBadge tone={STATE_TONE[materialStockState(m)]}>
                      {MATERIAL_STOCK_LABEL[materialStockState(m)]}
                    </StatusBadge>
                  </td>
                  <td className="inv-table__sale">
                    <span
                      className="inv-table__switch"
                      title={
                        !canCatalog
                          ? 'Cần quyền Quản lý kho (64)'
                          : m.isActive === 1
                            ? 'Đang dùng — tắt để ngừng dùng'
                            : 'Đang ngừng dùng — bật để dùng lại'
                      }
                    >
                      <Switch
                        checked={m.isActive === 1}
                        disabled={!canCatalog || toggle.isPending}
                        aria-label={`${m.isActive === 1 ? 'Ngừng dùng' : 'Dùng lại'} ${m.name}`}
                        onCheckedChange={() => toggle.mutate(m)}
                      />
                    </span>
                  </td>
                  <td className="inv-table__actions">
                    <Button
                      type="button"
                      variant="outline"
                      icon={BATCH_BUTTON_ICON[1]}
                      disabled={!canStock || m.isActive !== 1}
                      title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                      onClick={() => setStock({ material: m, msType: 1 })}
                    >
                      Nhập
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={BATCH_BUTTON_ICON[2]}
                      disabled={!canStock || m.isActive !== 1}
                      title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                      onClick={() => setStock({ material: m, msType: 2 })}
                    >
                      Xuất
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      icon={BATCH_BUTTON_ICON[3]}
                      disabled={!canStock || m.isActive !== 1}
                      title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                      onClick={() => setStock({ material: m, msType: 3 })}
                    >
                      Kiểm kê
                    </Button>
                    <Button
                      type="button"
                      variant="warning-outline"
                      disabled={!canCatalog}
                      title={canCatalog ? undefined : 'Cần quyền Quản lý kho (64)'}
                      onClick={() => setEditing({ material: m })}
                    >
                      Sửa
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </section>

      <MaterialEditor
        open={editing !== null}
        material={editing?.material ?? null}
        onClose={() => setEditing(null)}
      />
      <StockDialog material={stock?.material ?? null} msType={stock?.msType ?? 1} onClose={() => setStock(null)} />
      {batchType !== null ? (
        <MaterialBatchDialog
          initialMaterialIds={selectedRows.map((m) => m.materialId)}
          msType={batchType}
          onClose={() => setBatchType(null)}
          onRecorded={(ids) =>
            setSelected((cur) => {
              const next = new Set(cur)
              for (const id of ids) next.delete(id)
              return next
            })
          }
        />
      ) : null}
    </>
  )
}
