import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MagnifyingGlass } from '@phosphor-icons/react'
import { getMaterials, toggleMaterialActive, type MaterialRow } from '../../api/inventory'
import {
  Button,
  ListToolbar,
  RefreshButton,
  StateView,
  StatusBadge,
  Switch,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { MaterialEditor, StockDialog } from './MaterialDialogs'
import { describeInventoryError, formatQty, type MaterialMoveType } from './inventoryModel'
import './inventory.css'

/**
 * Tab Nguyên liệu (hiện ở trang Dịch vụ & hàng hóa): danh mục + tồn + nhập/xuất/kiểm kê.
 * Quyền: 64 sửa danh mục, 68 điều chỉnh kho. (Đơn vị tính dùng chung nên nút nằm ở đầu trang Dịch vụ.)
 */
export function MaterialsTab() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canCatalog = hasRight(64)
  const canStock = hasRight(68)

  const [search, setSearch] = useState('')
  const [activeOnly, setActiveOnly] = useState(true)
  const [lowOnly, setLowOnly] = useState(false)
  const [editing, setEditing] = useState<{ material: MaterialRow | null } | null>(null)
  const [stock, setStock] = useState<{ material: MaterialRow; msType: MaterialMoveType } | null>(null)

  const query = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly, lowOnly }],
    queryFn: () => getMaterials({ activeOnly, lowOnly, limit: 1000 }),
  })

  const toggle = useMutation({
    mutationFn: (m: MaterialRow) => toggleMaterialActive({ materialId: m.materialId, isActive: m.isActive !== 1 }),
    onSuccess: () => {
      pushToast('Đã cập nhật trạng thái nguyên liệu.', 'success')
      void queryClient.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase('vi')
    const all = query.data?.rows ?? []
    return needle ? all.filter((m) => m.name.toLocaleLowerCase('vi').includes(needle)) : all
  }, [query.data, search])

  const supported = query.data?.supported !== false

  return (
    <section className="inv-panel" aria-label="Danh mục nguyên liệu">
      <div className="inv-filters">
        <div className="ds-search-input inv-filters__search">
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
        <Switch checked={activeOnly} onCheckedChange={setActiveOnly} aria-label="Chỉ nguyên liệu đang dùng" label="Đang dùng" />
        <Switch checked={lowOnly} onCheckedChange={setLowOnly} aria-label="Chỉ nguyên liệu sắp hết" label="Sắp hết" />
      </div>

      <ListToolbar
        count={
          <>
            Tổng <strong>{rows.length}</strong> nguyên liệu
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
          title={search || lowOnly ? 'Không có nguyên liệu phù hợp' : 'Chưa có nguyên liệu nào'}
          description={search || lowOnly ? 'Thử bỏ bộ lọc.' : 'Bấm “Thêm nguyên liệu” để bắt đầu.'}
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
                    {m.isActive !== 1 ? (
                      <StatusBadge tone="neutral">Ngừng dùng</StatusBadge>
                    ) : m.low ? (
                      <StatusBadge tone="danger">Sắp hết</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">Đủ</StatusBadge>
                    )}
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

      <MaterialEditor
        open={editing !== null}
        material={editing?.material ?? null}
        onClose={() => setEditing(null)}
      />
      <StockDialog material={stock?.material ?? null} msType={stock?.msType ?? 1} onClose={() => setStock(null)} />
    </section>
  )
}
