import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { getMaterials, toggleMaterialActive, type MaterialRow } from '../../api/inventory'
import { Button, ListToolbar, RefreshButton, StateView, StatusBadge } from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { MaterialEditor, StockDialog } from './MaterialDialogs'
import {
  describeInventoryError,
  formatQty,
  MATERIAL_STOCK_LABEL,
  materialStockState,
  type MaterialMoveType,
  type MaterialStockFilter,
  type MaterialStockState,
} from './inventoryModel'
import './inventory.css'

const STATE_TONE: Record<MaterialStockState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  available: 'success',
  low: 'warning',
  out: 'danger',
  stopped: 'neutral',
}

/**
 * Tab Nguyên liệu (hiện ở trang Dịch vụ & hàng hóa), cùng cách quản lý với danh sách dịch vụ: hàng ô thống kê bấm
 * để lọc (Còn tồn / Sắp hết / Hết tồn / Ngừng dùng), ô tìm kiếm, danh sách. Quyền: 64 sửa danh mục, 68 điều chỉnh kho.
 * (Đơn vị tính dùng chung nên nút nằm ở đầu trang Dịch vụ.) Kiểu dáng ô thống kê dùng chung `.service-*` của services.css.
 */
export function MaterialsTab() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canCatalog = hasRight(64)
  const canStock = hasRight(68)

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<MaterialStockFilter>('all')
  const [editing, setEditing] = useState<{ material: MaterialRow | null } | null>(null)
  const [stock, setStock] = useState<{ material: MaterialRow; msType: MaterialMoveType } | null>(null)

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
    return source.filter(
      (m) =>
        (filter === 'all' || materialStockState(m) === filter) &&
        (!needle || m.name.toLocaleLowerCase('vi').includes(needle)),
    )
  }, [source, search, filter])

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
        <div className="ds-field">
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
      </section>

      <section className="service-panel" aria-label="Danh sách nguyên liệu">
        <ListToolbar
          count={
            <>
              Tổng <strong>{new Intl.NumberFormat('vi-VN').format(rows.length)}</strong>
            </>
          }
          actions={
            <>
              <Button
                type="button"
                variant="primary"
                disabled={!canCatalog || !supported}
                title={canCatalog ? undefined : 'Cần quyền Quản lý kho (64)'}
                onClick={() => setEditing({ material: null })}
              >
                Thêm nguyên liệu
              </Button>
              <RefreshButton loading={query.isFetching} onClick={() => void query.refetch()} />
            </>
          }
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
                <th>Nguyên liệu</th>
                <th className="is-num">Tồn kho</th>
                <th className="is-num">Tối thiểu</th>
                <th>Trạng thái</th>
                <th aria-label="Thao tác" />
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.materialId} className={m.isActive === 1 ? '' : 'is-off'}>
                  <td>
                    <strong>{m.name}</strong>
                    <small className="inv-muted">
                      #{m.materialId}
                      {m.materialNote ? ` · ${m.materialNote}` : ''}
                    </small>
                  </td>
                  <td className="is-num">
                    <strong>{formatQty(m.stockQty)}</strong> <span className="inv-muted">{m.unit}</span>
                  </td>
                  <td className="is-num">{formatQty(m.minStockQty)}</td>
                  <td>
                    <StatusBadge tone={STATE_TONE[materialStockState(m)]}>
                      {MATERIAL_STOCK_LABEL[materialStockState(m)]}
                    </StatusBadge>
                  </td>
                  <td className="inv-table__actions">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canStock || m.isActive !== 1}
                      title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                      onClick={() => setStock({ material: m, msType: 1 })}
                    >
                      Nhập
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canStock || m.isActive !== 1}
                      title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                      onClick={() => setStock({ material: m, msType: 2 })}
                    >
                      Xuất
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!canStock || m.isActive !== 1}
                      title={canStock ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                      onClick={() => setStock({ material: m, msType: 3 })}
                    >
                      Kiểm kê
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!canCatalog}
                      title={canCatalog ? undefined : 'Cần quyền Quản lý kho (64)'}
                      onClick={() => setEditing({ material: m })}
                    >
                      Sửa
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={!canCatalog || toggle.isPending}
                      onClick={() => toggle.mutate(m)}
                    >
                      {m.isActive === 1 ? 'Ngừng' : 'Dùng lại'}
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
    </>
  )
}
