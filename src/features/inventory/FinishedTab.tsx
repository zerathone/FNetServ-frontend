import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ListChecks, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { commitFinishedClosing, getFinishedClosingPreview, getFinishedClosings } from '../../api/inventory'
import {
  Button,
  ConfirmAction,
  FilterHeaderCell,
  ListToolbar,
  RefreshButton,
  Segmented,
  Select,
  SortHeaderCell,
  StateView,
  StatusBadge,
  type FilterMenuOption,
  type SegmentedOption,
} from '../../design-system/components'
import { useIdempotentIntent } from '../../lib/idempotency'
import { sortRows, type SortState, type SortValue } from '../../lib/tableSort'
import type { ServiceItem } from '../../api/services'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { ClosingPreviewToggle } from './ClosingPreviewToggle'
import { ClosingsReportView, ImportReportView, StocktakeReportView } from './FinishedReportViews'
import { ImportVoucherDialog, StocktakeVoucherDialog } from './FinishedVoucherDialogs'
import {
  closingPreview,
  closingResultText,
  diffBadge,
  formatInt,
  formatMoney,
  formatSigned,
  MAX_BATCH_LINES,
  parseStockView,
  RIGHT_FINISHED_CLOSING,
  RIGHT_FINISHED_IMPORT,
  REPORT_RIGHTS,
  RIGHT_FINISHED_STOCKTAKE,
  stockDiff,
  type StockView,
} from './finishedStockModel'
import { describeInventoryError } from './inventoryModel'
import { matchesServiceStock, serviceStockLabel, type ServiceStockFilter } from '../services/serviceModel'
import { useFinishedServices } from './useFinishedServices'
// Tab này nay nằm ở trang Dịch vụ & hàng hóa (tab Quản lý tồn) — tự nạp CSS .inv-* để không phụ thuộc trang Kho.
import './inventory.css'

/** Dropdown lọc ở header cột Trạng thái của Tồn kho (chỉ mặt hàng quản lý tồn ⇒ không có nhóm "Không quản lý tồn"). */
const STOCK_STATE_OPTIONS: FilterMenuOption<ServiceStockFilter>[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'available', label: 'Còn tồn' },
  { value: 'low', label: 'Sắp hết' },
  { value: 'out', label: 'Hết tồn' },
]

type StockSortKey = 'expected' | 'real' | 'diff'

/** Cột số lượng sắp xếp được của Tồn kho hàng hóa (đủ mọi mặt hàng nên sắp trên toàn danh sách đang lọc). */
const STOCK_SORT: Record<StockSortKey, (s: ServiceItem) => SortValue> = {
  expected: (s) => s.inventoryExpected,
  real: (s) => s.inventory,
  diff: (s) => stockDiff(s),
}

const VIEW_OPTIONS: readonly SegmentedOption<StockView>[] = [
  { value: 'stock', label: 'Tồn kho' },
  { value: 'imports', label: 'Nhập kho' },
  { value: 'stocktakes', label: 'Kiểm kê' },
  { value: 'closings', label: 'Chốt kho' },
]

/**
 * Tab Quản lý tồn (trang Dịch vụ & hàng hóa) của kho THÀNH PHẨM, theo Qt: Tồn kho (mặc định) | Nhập kho | Kiểm kê | Chốt kho (lịch sử các lần chốt).
 * Mục đang chọn nằm trên URL (`?tab=stock&view=imports`). Kho NGUYÊN LIỆU (/inventory) là thứ riêng, không dùng chung state.
 */
export function FinishedTab() {
  const [params, setParams] = useSearchParams()
  const view = parseStockView(params.get('view'))
  const hasRight = useAuthStore((s) => s.hasRight)
  const canImport = hasRight(RIGHT_FINISHED_IMPORT)
  const canStocktake = hasRight(RIGHT_FINISHED_STOCKTAKE)
  const [voucher, setVoucher] = useState<'import' | 'stocktake' | null>(null)

  const changeView = (next: StockView) => {
    const copy = new URLSearchParams(params)
    copy.set('tab', 'stock')
    if (next === 'stock') copy.delete('view')
    else copy.set('view', next)
    setParams(copy, { replace: true })
  }

  return (
    <div className="inv-stack">
      <div className="inv-viewbar">
        <Segmented<StockView> ariaLabel="Mục quản lý tồn" value={view} options={VIEW_OPTIONS} onChange={changeView} />
        <div className="inv-viewbar__actions">
          {view === 'stock' ? (
            <>
              <ClosingPeriod />
              <ClosingButton />
            </>
          ) : null}
          {view === 'imports' ? (
            <Button
              type="button"
              variant="primary"
              icon={<Plus size={16} weight="bold" aria-hidden="true" />}
              disabled={!canImport}
              title={canImport ? undefined : 'Cần quyền Quản lý kho (64)'}
              onClick={() => setVoucher('import')}
            >
              Tạo phiếu nhập
            </Button>
          ) : null}
          {view === 'stocktakes' ? (
            <Button
              type="button"
              variant="primary"
              icon={<Plus size={16} weight="bold" aria-hidden="true" />}
              disabled={!canStocktake}
              title={canStocktake ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
              onClick={() => setVoucher('stocktake')}
            >
              Tạo phiếu kiểm kê
            </Button>
          ) : null}
        </div>
      </div>

      {view === 'stock' ? <StockOnHand /> : null}
      {view === 'imports' ? <ImportReportView /> : null}
      {view === 'stocktakes' ? <StocktakeReportView /> : null}
      {view === 'closings' ? <ClosingsReportView /> : null}

      {voucher === 'import' ? <ImportVoucherDialog onClose={() => setVoucher(null)} /> : null}
      {voucher === 'stocktake' ? <StocktakeVoucherDialog onClose={() => setVoucher(null)} /> : null}
    </div>
  )
}

// ----- Tồn kho: ảnh chụp hiện tại của mọi mặt hàng quản lý tồn (đọc thẳng GET /services, không cần quyền riêng) -----

function StockOnHand() {
  const { query, managed } = useFinishedServices()
  const hasRight = useAuthStore((s) => s.hasRight)
  const canImport = hasRight(RIGHT_FINISHED_IMPORT)
  const canStocktake = hasRight(RIGHT_FINISHED_STOCKTAKE)
  const [search, setSearch] = useState('')
  const [groupId, setGroupId] = useState(0)
  const [stockState, setStockState] = useState<ServiceStockFilter>('all')
  const [sort, setSort] = useState<SortState<StockSortKey>>(null)
  // Tick chọn nhiều mặt hàng để lập phiếu nhập / kiểm kê một lần (mỗi món thành một dòng của phiếu).
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  const [voucher, setVoucher] = useState<'import' | 'stocktake' | null>(null)

  const groups = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of managed) {
      if (s.groupId && s.groupId > 0 && !map.has(s.groupId)) map.set(s.groupId, s.groupName || `Nhóm ${s.groupId}`)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [managed])

  const needle = search.trim().toLocaleLowerCase('vi')
  const rows = sortRows(
    managed.filter(
      (s) =>
        (groupId === 0 || s.groupId === groupId) &&
        matchesServiceStock(s, stockState) &&
        (!needle || s.name.toLocaleLowerCase('vi').includes(needle)),
    ),
    sort,
    STOCK_SORT,
  )

  // Chỉ tính món ĐANG HIỂN THỊ theo tìm/lọc nhóm ⇒ "k / Tổng" khớp thứ nhìn thấy; món đã tick nhưng đang bị lọc ẩn thì giữ trong
  // lựa chọn, hiện lại khi bỏ lọc, và không đưa vào phiếu.
  const selectedIds = rows.filter((s) => selected.has(s.id)).map((s) => s.id)
  const allVisibleSelected = rows.length > 0 && rows.every((s) => selected.has(s.id))
  const someVisibleSelected = rows.some((s) => selected.has(s.id))
  const toggleOne = (id: number) =>
    setSelected((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  // "Chọn tất cả" chỉ áp cho các dòng đang hiển thị (đang lọc/tìm); bỏ chọn cũng chỉ bỏ các dòng đó.
  const toggleVisible = () =>
    setSelected((cur) => {
      const next = new Set(cur)
      for (const s of rows) {
        if (allVisibleSelected) next.delete(s.id)
        else next.add(s.id)
      }
      return next
    })
  const overLimit = selectedIds.length > MAX_BATCH_LINES

  return (
    <section className="inv-panel" aria-label="Tồn kho hàng hóa">
      <div className="inv-filters inv-filters--report">
        <div className="ds-field inv-filters__search">
          <div className="ds-input-group ds-input-group--search">
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                value={search}
                aria-label="Tìm tên mặt hàng"
                placeholder="Tìm tên mặt hàng…"
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
        </div>
        {groups.length > 0 ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Nhóm</span>
            <Select aria-label="Lọc theo nhóm" value={groupId} onChange={(e) => setGroupId(Number(e.target.value))}>
              <option value={0}>Tất cả</option>
              {groups.map(([id, name]) => (
                <option key={id} value={id}>
                  {name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      <ListToolbar
        count={
          selectedIds.length > 0 ? (
            // Có tick: "k / Tổng mặt hàng đã chọn" + nút thao tác ngay cạnh (thay cho chữ "Tổng N mặt hàng").
            <span className="inv-toolbar-selection" role="region" aria-label="Thao tác mặt hàng đã chọn">
              <span>
                <strong>{formatInt(selectedIds.length)}</strong> / <strong>{formatInt(rows.length)}</strong> mặt hàng đã chọn
                {overLimit ? ` · phiếu chỉ nhận ${MAX_BATCH_LINES} món đầu` : ''}
              </span>
              <Button
                type="button"
                variant="primary"
                icon={<Plus size={16} weight="bold" aria-hidden="true" />}
                disabled={!canImport}
                title={canImport ? undefined : 'Cần quyền Quản lý kho (64)'}
                onClick={() => setVoucher('import')}
              >
                Tạo phiếu nhập
              </Button>
              <Button
                type="button"
                variant="primary"
                icon={<Plus size={16} weight="bold" aria-hidden="true" />}
                disabled={!canStocktake}
                title={canStocktake ? undefined : 'Cần quyền Điều chỉnh kho (68)'}
                onClick={() => setVoucher('stocktake')}
              >
                Tạo phiếu kiểm kê
              </Button>
              <Button type="button" variant="ghost" onClick={() => setSelected(new Set())}>
                Bỏ chọn
              </Button>
            </span>
          ) : (
            <>
              Tổng <strong>{formatInt(rows.length)}</strong> mặt hàng
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
      ) : rows.length === 0 ? (
        <StateView
          title={managed.length === 0 ? 'Chưa có mặt hàng nào quản lý tồn' : 'Không có mặt hàng phù hợp'}
          description={managed.length === 0 ? undefined : 'Thử từ khóa hoặc nhóm khác.'}
        />
      ) : (
        <div className="inv-table-wrap">
          <table className="inv-table">
            <thead>
              <tr>
                <th className="inv-col-check">
                  <input
                    type="checkbox"
                    aria-label="Chọn tất cả mặt hàng đang hiển thị"
                    checked={allVisibleSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = !allVisibleSelected && someVisibleSelected
                    }}
                    onChange={toggleVisible}
                  />
                </th>
                <th>Mặt hàng</th>
                <th>Nhóm</th>
                <SortHeaderCell label="Dự kiến" sortKey="expected" sort={sort} onSort={setSort} className="is-num" />
                <SortHeaderCell label="Thực tế" sortKey="real" sort={sort} onSort={setSort} className="is-num" />
                <SortHeaderCell label="Chênh lệch" sortKey="diff" sort={sort} onSort={setSort} className="is-num" />
                <th>Đơn vị</th>
                <FilterHeaderCell
                  as="th"
                  label="Trạng thái"
                  options={STOCK_STATE_OPTIONS}
                  value={stockState}
                  baseline="all"
                  onChange={setStockState}
                  menuLabel="Lọc theo trạng thái tồn"
                  clearLabel="Bỏ lọc trạng thái tồn"
                />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const diff = stockDiff(s)
                const badge = diffBadge(diff)
                const stock = serviceStockLabel(s)
                return (
                  <tr key={s.id} className={selected.has(s.id) ? 'is-selected' : undefined}>
                    <td className="inv-col-check">
                      <input
                        type="checkbox"
                        aria-label={`Chọn ${s.name}`}
                        checked={selected.has(s.id)}
                        onChange={() => toggleOne(s.id)}
                      />
                    </td>
                    <td>
                      <strong>{s.name}</strong>
                    </td>
                    <td>{s.groupName}</td>
                    <td className="is-num">{s.inventoryExpected === undefined ? '—' : formatInt(s.inventoryExpected)}</td>
                    <td className="is-num">
                      <strong>{formatInt(s.inventory)}</strong>
                    </td>
                    <td className="is-num">
                      {diff === null ? (
                        '—'
                      ) : badge ? (
                        <StatusBadge tone={badge.tone} dot={false} title="Dự kiến − Thực tế">
                          {badge.text}
                        </StatusBadge>
                      ) : null}
                    </td>
                    <td>{s.unit}</td>
                    <td>
                      <StatusBadge tone={stock.tone} dot={stock.dot}>
                        {stock.label}
                      </StatusBadge>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {voucher === 'import' ? <ImportVoucherDialog initialServiceIds={selectedIds} onClose={() => setVoucher(null)} /> : null}
      {voucher === 'stocktake' ? <StocktakeVoucherDialog initialServiceIds={selectedIds} onClose={() => setVoucher(null)} /> : null}
    </section>
  )
}

/**
 * "Kỳ đang mở: <lần chốt gần nhất> → hiện tại" đặt trước nút Chốt kho (giống kỳ đang mở của kho nguyên liệu). Kho thành
 * phẩm không có bảng đầu kỳ chốt: lấy thời điểm chốt gần nhất từ lịch sử chốt (dòng mới nhất, máy chủ sắp mới → cũ); đầu "đến"
 * luôn là "hiện tại" vì kỳ còn mở. Cần quyền xem báo cáo Chốt kho (cũ: Nhập – xuất) của MỌI nhân viên (93941) vì dòng mới nhất có thể do người khác
 * chốt; không đủ quyền hoặc lỗi ⇒ ẩn, không chặn nút Chốt kho. Làm mới sau mỗi lần chốt (khoá nằm dưới ['inventory','finished']).
 */
function ClosingPeriod() {
  const canAll = useAuthStore((s) => s.hasRight)(REPORT_RIGHTS.closings.all)
  const last = useQuery({
    queryKey: ['inventory', 'finished', 'closings', 'last'],
    queryFn: () => getFinishedClosings({ limit: 1, offset: 0 }),
    enabled: canAll,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })
  if (!canAll || last.isLoading || last.isError || last.data?.supported === false) return null
  const latest = last.data?.rows[0]
  const from = latest ? `${latest.createDate} ${latest.createTime}` : null
  return (
    <span className="inv-closing-period" title="Từ lần chốt kho gần nhất đến hiện tại">
      Kỳ đang mở: <strong>{from ?? 'từ đầu'}</strong> → <strong>hiện tại</strong>
    </span>
  )
}

// ----- Chốt kho (quyền 69): ghi sổ kỳ cho TOÀN BỘ mặt hàng quản lý tồn, đưa Dự kiến về bằng Thực tế -----

function ClosingButton() {
  const queryClient = useQueryClient()
  const canClose = useAuthStore((s) => s.hasRight)(RIGHT_FINISHED_CLOSING)
  const { all, query, byId } = useFinishedServices()
  const { getKey, clearKey } = useIdempotentIntent('fin-close')
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const preview = closingPreview(all)
  // Kết quả SẼ ghi lúc chốt (Đầu kỳ, Nhập, Điều chỉnh, Bán, Cuối kỳ, Giá trị…): máy chủ chạy đúng phép tính của việc chốt nhưng
  // không ghi gì. Chỉ tải khi hộp xác nhận đang mở; mở lại là tính lại (số tồn/đơn có thể đã đổi).
  const previewQuery = useQuery({
    queryKey: ['inventory', 'finished', 'closing', 'preview'],
    queryFn: getFinishedClosingPreview,
    enabled: open,
    refetchOnWindowFocus: false,
    retry: false,
  })
  const previewRows = previewQuery.data?.rows ?? []
  const skippedCount = previewQuery.data?.skipped.length ?? 0

  const commit = useMutation({
    mutationFn: () => commitFinishedClosing({ note: note.trim() || undefined, idem: getKey(note.trim()) }),
    onSuccess: (result) => {
      clearKey()
      pushToast(
        `${closingResultText(result.closedCount, result.skipped?.length ?? 0)}${result.duplicated ? ' (lần chốt này đã ghi trước đó)' : ''}`,
        'success',
      )
      setOpen(false)
      setNote('')
      void queryClient.invalidateQueries({ queryKey: ['services'] })
      void queryClient.invalidateQueries({ queryKey: ['inventory', 'finished'] })
    },
    onError: (error) => pushToast(describeInventoryError(error), 'error'),
  })

  return (
    <>
      <Button
        type="button"
        variant="primary"
        icon={<ListChecks size={16} weight="bold" aria-hidden="true" />}
        disabled={!canClose || query.isLoading || preview.managedCount === 0}
        title={canClose ? undefined : 'Cần quyền Chốt kho (69)'}
        onClick={() => setOpen(true)}
      >
        Chốt kho
      </Button>
      <ConfirmAction
        open={open}
        title="Chốt kho hàng hóa?"
        description="Ghi sổ kỳ và đưa Dự kiến về bằng Thực tế — không hoàn tác."
        confirmLabel="Chốt kho"
        danger
        size="md"
        pending={commit.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => commit.mutate()}
      >
        <div className="inv-form inv-form--closing inv-form--closing-wide">
          <p className="inv-form__wide">
            <strong>{formatInt(preview.managedCount)}</strong> mặt hàng sẽ chốt ·{' '}
            {preview.unknownDiff ? (
              'chưa biết số mặt hàng chênh lệch (máy chủ chưa trả dự kiến).'
            ) : (
              <>
                <strong>{formatInt(preview.diffCount)}</strong> đang chênh lệch (về 0 sau chốt).
              </>
            )}
          </p>
          <label className="ds-field inv-form__wide">
            <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
            <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
          </label>
          <ClosingPreviewToggle
            count={previewRows.length}
            loading={previewQuery.isLoading}
            error={previewQuery.isError ? describeInventoryError(previewQuery.error) : undefined}
          >
            <p className="inv-closing-preview__hint">
              Kết quả cuối cùng sẽ ghi vào kỳ (giống bảng của lịch sử Chốt kho).
              {skippedCount > 0 ? ` ${skippedCount} mặt hàng không tính được sẽ bị bỏ qua khi chốt.` : ''}
            </p>
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Mặt hàng</th>
                  <th>Nhóm</th>
                  <th className="is-num">Đầu kỳ</th>
                  <th className="is-num">Nhập</th>
                  <th className="is-num">Điều chỉnh</th>
                  <th className="is-num">Bán</th>
                  <th className="is-num">Cuối kỳ</th>
                  <th className="is-num">Giá trị nhập</th>
                  <th className="is-num">Giá trị bán</th>
                  <th>Đơn vị</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((r) => {
                  const s = byId.get(r.serviceId)
                  return (
                    <tr key={r.serviceId}>
                      <td>{s?.name ?? `#${r.serviceId}`}</td>
                      <td>{s?.groupName ?? ''}</td>
                      <td className="is-num">{formatInt(r.numBalance)}</td>
                      <td className="is-num">{formatInt(r.importQuantity)}</td>
                      <td className="is-num">{formatSigned(r.numAdjust)}</td>
                      <td className="is-num">{formatInt(r.saleQuantity)}</td>
                      <td className="is-num">
                        <strong>{formatInt(r.numInventoryReal)}</strong>
                      </td>
                      <td className="is-num">{formatMoney(r.importTotalAmount)}</td>
                      <td className="is-num">{formatMoney(r.saleTotalAmount)}</td>
                      <td>{s?.unit ?? ''}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </ClosingPreviewToggle>
        </div>
      </ConfirmAction>
    </>
  )
}
