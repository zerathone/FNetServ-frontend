import { useMemo, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { ListChecks, MagnifyingGlass, Plus } from '@phosphor-icons/react'
import { commitFinishedClosing } from '../../api/inventory'
import {
  Button,
  ConfirmAction,
  InlineAlert,
  ListToolbar,
  RefreshButton,
  Segmented,
  Select,
  StateView,
  StatusBadge,
  type SegmentedOption,
} from '../../design-system/components'
import { useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import { ClosingsReportView, ImportReportView, StocktakeReportView } from './FinishedReportViews'
import { ImportVoucherDialog, StocktakeVoucherDialog } from './FinishedVoucherDialogs'
import {
  closingPreview,
  closingResultText,
  diffBadge,
  formatInt,
  MAX_BATCH_LINES,
  parseStockView,
  RIGHT_FINISHED_CLOSING,
  RIGHT_FINISHED_IMPORT,
  RIGHT_FINISHED_STOCKTAKE,
  stockDiff,
  type StockView,
} from './finishedStockModel'
import { describeInventoryError } from './inventoryModel'
import { useFinishedServices } from './useFinishedServices'
// Tab này nay nằm ở trang Dịch vụ & hàng hóa (tab Quản lý tồn) — tự nạp CSS .inv-* để không phụ thuộc trang Kho.
import './inventory.css'

const VIEW_OPTIONS: readonly SegmentedOption<StockView>[] = [
  { value: 'stock', label: 'Tồn kho' },
  { value: 'imports', label: 'Nhập kho' },
  { value: 'stocktakes', label: 'Kiểm kê' },
  { value: 'closings', label: 'Nhập – xuất' },
]

/**
 * Tab Quản lý tồn (trang Dịch vụ & hàng hóa) của kho THÀNH PHẨM, theo Qt: Tồn kho (mặc định) | Nhập kho | Kiểm kê | Nhập – xuất.
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
          {view === 'stock' ? <ClosingButton /> : null}
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
  const rows = managed.filter(
    (s) => (groupId === 0 || s.groupId === groupId) && (!needle || s.name.toLocaleLowerCase('vi').includes(needle)),
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
    <section className="inv-panel" aria-label="Tồn kho thành phẩm">
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
                <th className="is-num">Dự kiến</th>
                <th className="is-num">Thực tế</th>
                <th className="is-num">Chênh lệch</th>
                <th>Đơn vị</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => {
                const diff = stockDiff(s)
                const badge = diffBadge(diff)
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

// ----- Chốt kho (quyền 69): ghi sổ kỳ cho TOÀN BỘ mặt hàng quản lý tồn, đưa Dự kiến về bằng Thực tế -----

function ClosingButton() {
  const queryClient = useQueryClient()
  const canClose = useAuthStore((s) => s.hasRight)(RIGHT_FINISHED_CLOSING)
  const { all, query } = useFinishedServices()
  const { getKey, clearKey } = useIdempotentIntent('fin-close')
  const [open, setOpen] = useState(false)
  const [note, setNote] = useState('')

  const preview = closingPreview(all)

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
        title="Chốt kho thành phẩm?"
        description={`Ghi sổ kỳ này cho ${formatInt(preview.managedCount)} mặt hàng và đưa số lượng dự kiến về bằng số lượng thực tế — không hoàn tác.`}
        confirmLabel="Chốt kho"
        danger
        pending={commit.isPending}
        onCancel={() => setOpen(false)}
        onConfirm={() => commit.mutate()}
      >
        <div className="inv-form">
          <p className="inv-form__wide">
            <strong>{formatInt(preview.managedCount)}</strong> mặt hàng sẽ được chốt ·{' '}
            {preview.unknownDiff ? (
              'chưa biết số mặt hàng đang chênh lệch (máy chủ chưa trả số lượng dự kiến).'
            ) : (
              <>
                <strong>{formatInt(preview.diffCount)}</strong> mặt hàng đang có chênh lệch khác 0.
              </>
            )}
          </p>
          {preview.diffCount > 0 ? (
            <div className="inv-form__wide">
              <InlineAlert tone="warning">
                Sau khi chốt, chênh lệch của các mặt hàng này về 0; số lượng thực tế giữ nguyên.
              </InlineAlert>
            </div>
          ) : null}
          <label className="ds-field inv-form__wide">
            <span className="ds-field__label">Ghi chú (không bắt buộc)</span>
            <input className="ds-input" value={note} maxLength={250} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
      </ConfirmAction>
    </>
  )
}
