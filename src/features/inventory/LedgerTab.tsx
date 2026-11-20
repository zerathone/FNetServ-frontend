import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import { getStaffList } from '../../api/staff'
import {
  getLedger,
  getMaterials,
  getUsage,
  type InventoryFilter,
  type LedgerRow,
  type UsageRow,
} from '../../api/inventory'
import { sortRows, toSortNumber, type SortState, type SortValue } from '../../lib/tableSort'
import {
  Button,
  DateRangePicker,
  FilterHeaderCell,
  ListPagination,
  ListToolbar,
  RefreshButton,
  Select,
  SortHeaderCell,
  StateView,
  StatusBadge,
  type FilterMenuOption,
} from '../../design-system/components'
import { defaultReportRange } from './finishedStockModel'
import {
  dateFilter,
  describeInventoryError,
  diffTone,
  formatDiff,
  formatQty,
  formatUnixSeconds,
  ledgerHasStocktakeLog,
  MOVE_TYPE_LABEL,
  stockMoveTotal,
  sumStocktakeAdjust,
} from './inventoryModel'

const PAGE_SIZE = 50
const money = (value: string) => (value && value !== '0' ? formatQty(value) : '—')

/** Thành tiền = số lượng × đơn giá (làm tròn đến đồng); "—" khi phiếu không có đơn giá (kiểm kê, phiếu không ghi giá). */
function lineAmount(r: Pick<LedgerRow, 'msQty' | 'msPrice'>): string {
  const total = stockMoveTotal(r.msQty, r.msPrice)
  return total === null || total === 0 ? '—' : new Intl.NumberFormat('vi-VN').format(total)
}

export type LedgerView = 'import' | 'export' | 'stocktake' | 'usage'

type UsageKind = 'all' | 'recipe' | 'topping'
const USAGE_KIND_VALUE: Record<UsageKind, 0 | 1 | undefined> = { all: undefined, recipe: 0, topping: 1 }
const USAGE_KIND_OPTIONS: FilterMenuOption<UsageKind>[] = [
  { value: 'all', label: 'Tất cả' },
  { value: 'recipe', label: 'Công thức' },
  { value: 'topping', label: 'Bán kèm' },
]

/** Cột sắp xếp được của sổ kho (nhập / xuất-trả / kiểm kê) và của tiêu hao theo đơn: thời gian, số lượng, tiền. */
type LedgerSortKey = 'time' | 'before' | 'diff' | 'qty' | 'price' | 'amount'
type UsageSortKey = 'time' | 'serviceQty' | 'usage'

const LEDGER_SORT: Record<LedgerSortKey, (r: LedgerRow) => SortValue> = {
  time: (r) => r.createDate,
  before: (r) => toSortNumber(r.stockBefore),
  diff: (r) => toSortNumber(r.diff),
  qty: (r) => toSortNumber(r.msQty),
  price: (r) => toSortNumber(r.msPrice),
  amount: (r) => stockMoveTotal(r.msQty, r.msPrice),
}

const USAGE_SORT: Record<UsageSortKey, (r: UsageRow) => SortValue> = {
  time: (r) => r.createDate,
  serviceQty: (r) => r.serviceQty,
  usage: (r) => toSortNumber(r.totalQty),
}

/** Mục sổ kho → loại phiếu (`msType`) lọc ở máy chủ: 1 nhập, 2 xuất/trả, 3 kiểm kê. */
const VIEW_MS_TYPE = { import: 1, export: 2, stocktake: 3 } as const

/**
 * Các mục sổ kho của tab Quản lý kho: chỉ đọc. Nhập kho / Xuất–trả / Kiểm kê = phiếu của đúng loại đó; Tiêu hao theo đơn =
 * nguyên liệu trừ theo đơn bán. Mục nào đang xem do trang cha chọn (`view`); bộ lọc nguyên liệu/ngày dùng chung, đổi mục
 * thì về trang 1.
 */
export function LedgerTab({ view }: { view: LedgerView }) {
  const [materialId, setMaterialId] = useState(0)
  const [staffId, setStaffId] = useState(0)
  // Mặc định lùi 1 tháng → hôm nay (giống báo cáo kho hàng hóa ở trang Dịch vụ & hàng hóa).
  const [defaultRange] = useState(() => defaultReportRange())
  const [fromDate, setFromDate] = useState(defaultRange.fromDate)
  const [toDate, setToDate] = useState(defaultRange.toDate)
  const [page, setPage] = useState(0)
  // Lọc cột Loại của "Tiêu hao theo đơn": tất cả | theo công thức | bán kèm (topping). Lọc ở máy chủ nên phân trang/tổng đúng.
  const [usageKind, setUsageKind] = useState<UsageKind>('all')
  // Sắp xếp theo cột (thời gian/số lượng/tiền) ở header — chỉ sắp các dòng của trang đang xem; đổi mục thì bỏ sắp xếp.
  const [ledgerSort, setLedgerSort] = useState<SortState<LedgerSortKey>>(null)
  const [usageSort, setUsageSort] = useState<SortState<UsageSortKey>>(null)
  const [pageView, setPageView] = useState(view)
  if (pageView !== view) {
    setPageView(view)
    setPage(0)
    setLedgerSort(null)
    setUsageSort(null)
  }

  const materialsQuery = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: false, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: false, lowOnly: false, limit: 1000 }),
  })

  // Danh sách nhân viên cho combo lọc (chỉ các mục có phiếu: nhập/xuất/kiểm kê). Không tải được ⇒ combo chỉ còn "Tất cả".
  const staffQuery = useQuery({
    queryKey: ['inventory-staff-list'],
    queryFn: () => getStaffList({ includeInactive: true }),
    enabled: view !== 'usage',
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  const materialUnitById = new Map((materialsQuery.data?.rows ?? []).map((m) => [m.materialId, m.unit]))

  const filter: InventoryFilter = {
    materialId: materialId || undefined,
    staffId: view !== 'usage' ? staffId || undefined : undefined,
    msType: view === 'usage' ? undefined : VIEW_MS_TYPE[view],
    isTopping: view === 'usage' ? USAGE_KIND_VALUE[usageKind] : undefined,
    fromDate: dateFilter(fromDate),
    toDate: dateFilter(toDate),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }
  const reset = () => setPage(0)

  const ledgerQuery = useQuery({
    queryKey: ['inventory', 'ledger', filter],
    queryFn: () => getLedger(filter),
    enabled: view !== 'usage',
  })
  const usageQuery = useQuery({
    queryKey: ['inventory', 'usage', filter],
    queryFn: () => getUsage(filter),
    enabled: view === 'usage',
  })

  // Số đơn hàng khác nhau (theo mã dòng đơn `serviceDetailId` hiện ở cột Đơn hàng) của các dòng tiêu hao đã tải. Máy chủ chưa
  // trả sẵn con số này cho cả bộ lọc ⇒ khi có nhiều trang thì đây chỉ là số của trang đang xem (tiêu đề ô thống kê có ghi rõ).
  const orderCount = new Set((usageQuery.data?.rows ?? []).map((r) => r.serviceDetailId)).size

  // Tổng tiền (Σ số lượng × đơn giá) của các phiếu nhập / xuất-trả đã tải. Cũng chỉ là số của trang đang xem khi có nhiều trang.
  const ledgerRows = ledgerQuery.data?.rows ?? []
  const moneyTotal = ledgerRows.reduce((sum, r) => sum + (stockMoveTotal(r.msQty, r.msPrice) ?? 0), 0)

  const adjust = sumStocktakeAdjust(ledgerRows)

  const active = view !== 'usage' ? ledgerQuery : usageQuery
  const total = (view !== 'usage' ? ledgerQuery.data?.total : usageQuery.data?.total) ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilter = materialId !== 0 || (view !== 'usage' && staffId !== 0) || fromDate !== defaultRange.fromDate || toDate !== defaultRange.toDate || (view === 'usage' && usageKind !== 'all')

  return (
    <section className="inv-panel" aria-label={view === 'usage' ? 'Tiêu hao theo đơn' : `Sổ kho — ${MOVE_TYPE_LABEL[VIEW_MS_TYPE[view]]}`}>
      <div className="inv-filters inv-filters--report">
        <DateRangePicker
          label="Khoảng ngày"
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={(value) => {
            setFromDate(value)
            reset()
          }}
          onToDateChange={(value) => {
            setToDate(value)
            reset()
          }}
        />
        <div className="ds-input-group">
          <span className="ds-input-group-separator">Nguyên liệu</span>
          <Select
            searchable
            aria-label="Lọc theo nguyên liệu"
            value={materialId}
            onChange={(e) => {
              setMaterialId(Number(e.target.value))
              reset()
            }}
          >
            <option value={0}>Tất cả</option>
            {(materialsQuery.data?.rows ?? []).map((m) => (
              <option key={m.materialId} value={m.materialId}>
                {m.name}
              </option>
            ))}
          </Select>
        </div>
        {view !== 'usage' ? (
          <div className="ds-input-group">
            <span className="ds-input-group-separator">Nhân viên</span>
            <Select
              searchable
              aria-label="Lọc theo nhân viên"
              value={staffId}
              onChange={(e) => {
                setStaffId(Number(e.target.value))
                reset()
              }}
            >
              <option value={0}>Tất cả</option>
              {(staffQuery.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.username}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        {hasFilter ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setMaterialId(0)
              setStaffId(0)
              setUsageKind('all')
              setFromDate(defaultRange.fromDate)
              setToDate(defaultRange.toDate)
              reset()
            }}
          >
            Xóa bộ lọc
          </Button>
        ) : null}
      </div>

      <ListToolbar
        count={
          <>
            Tổng <strong>{total}</strong> dòng
            {(view === 'import' || view === 'export') && ledgerRows.length > 0 ? (
              <>
                {' · '}Tổng tiền <strong>{new Intl.NumberFormat('vi-VN').format(moneyTotal)}</strong> đ
                {totalPages > 1 ? ' (trang này)' : null}
              </>
            ) : null}
            {view === 'stocktake' && ledgerRows.length > 0 ? (
              <>
                {' · '}
                <span title="Số dòng kiểm kê không chênh lệch">
                  Cân bằng <strong>{adjust.unchanged}</strong>
                </span>{' '}
                <StatusBadge tone="danger" dot={false} title="Điều chỉnh giảm (hao hụt): số dòng | tổng số lượng">
                  <ArrowDown size={14} weight="bold" aria-hidden="true" /> {adjust.decreaseLines}
                  <span className="inv-stat-sep" aria-hidden="true" />−{formatQty(adjust.decrease)}
                </StatusBadge>{' '}
                <StatusBadge tone="success" dot={false} title="Điều chỉnh tăng (dư): số dòng | tổng số lượng">
                  <ArrowUp size={14} weight="bold" aria-hidden="true" /> {adjust.increaseLines}
                  <span className="inv-stat-sep" aria-hidden="true" />+{formatQty(adjust.increase)}
                </StatusBadge>
                {totalPages > 1 ? ' (trang này)' : null}
              </>
            ) : null}
            {view === 'usage' && (usageQuery.data?.rows.length ?? 0) > 0 ? (
              <>
                {' · '}Tổng đơn <strong>{new Intl.NumberFormat('vi-VN').format(orderCount)}</strong>
                {totalPages > 1 ? ' (trang này)' : null}
              </>
            ) : null}
          </>
        }
        actions={
          <>
            <RefreshButton loading={active.isFetching} onClick={() => void active.refetch()} />
            <ListPagination
              page={page}
              totalPages={totalPages}
              canNext={page < totalPages - 1}
              onPrevious={() => setPage((p) => Math.max(0, p - 1))}
              onNext={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            />
          </>
        }
      />

      {active.isLoading ? (
        <StateView title="Đang tải…" />
      ) : active.isError ? (
        <StateView
          title="Không tải được dữ liệu"
          description={describeInventoryError(active.error)}
          action={
            <Button type="button" onClick={() => void active.refetch()}>
              Thử lại
            </Button>
          }
        />
      ) : view !== 'usage' ? (
        ledgerQuery.data?.supported === false ? (
          <StateView title="Cơ sở dữ liệu chưa có sổ kho nguyên liệu" />
        ) : (ledgerQuery.data?.rows.length ?? 0) === 0 ? (
          <StateView
            title={`Chưa có phiếu ${MOVE_TYPE_LABEL[VIEW_MS_TYPE[view]].toLocaleLowerCase('vi')} nào`}
            description={hasFilter ? 'Thử đổi bộ lọc.' : undefined}
          />
        ) : (
          <LedgerTable
            rows={sortRows(ledgerQuery.data?.rows ?? [], ledgerSort, LEDGER_SORT)}
            stocktake={view === 'stocktake'}
            sort={ledgerSort}
            onSort={setLedgerSort}
          />
        )
      ) : usageQuery.data?.supported === false ? (
        <StateView title="Cơ sở dữ liệu chưa có dữ liệu tiêu hao nguyên liệu" />
      ) : (usageQuery.data?.rows.length ?? 0) === 0 ? (
        <StateView title="Chưa có tiêu hao nào" description={hasFilter ? 'Thử đổi bộ lọc.' : undefined} />
      ) : (
        <>
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <SortHeaderCell label="Thời điểm" sortKey="time" sort={usageSort} onSort={setUsageSort} firstDir="desc" />
                  <th>Đơn hàng</th>
                  <th>Món bán</th>
                  <th>Nguyên liệu</th>
                  <SortHeaderCell label="SL bán" sortKey="serviceQty" sort={usageSort} onSort={setUsageSort} className="is-num" />
                  <SortHeaderCell label="Tiêu hao" sortKey="usage" sort={usageSort} onSort={setUsageSort} className="is-num" />
                  {/* Giống cột Tình trạng ở trang Máy trạm: bấm tiêu đề mở menu lọc, đang lọc thì hiện nhãn + nút X ngay dưới tiêu đề. */}
                  <FilterHeaderCell
                    as="th"
                    label="Loại"
                    options={USAGE_KIND_OPTIONS}
                    value={usageKind}
                    baseline="all"
                    onChange={(next) => {
                      setUsageKind(next)
                      reset()
                    }}
                    menuLabel="Lọc theo loại tiêu hao"
                    clearLabel="Bỏ lọc loại tiêu hao"
                  />
                </tr>
              </thead>
              <tbody>
                {sortRows(usageQuery.data?.rows ?? [], usageSort, USAGE_SORT).map((r) => (
                  <tr key={r.id}>
                    <td>{r.createDate}</td>
                    <td>#{r.serviceDetailId}</td>
                    <td>{r.serviceName}</td>
                    <td>{r.materialName}</td>
                    <td className="is-num">{r.serviceQty}</td>
                    <td className="is-num">
                      {/* Đơn vị của NGUYÊN LIỆU (TotalQty là số đã trừ kho theo đơn vị này). Cột `unit` của dòng tiêu hao là bản chụp
                          đơn vị của MÓN BÁN (parity iCafe — ARCHITECT/ICAFE_ORDER_SQL_CONTRACT.md L10) nên chỉ dùng khi không tra được nguyên liệu. */}
                      <strong>{formatQty(r.totalQty)}</strong>{' '}
                      <span className="inv-muted">{materialUnitById.get(r.materialId) || r.unit}</span>
                    </td>
                    <td>{r.isTopping === 1 ? <StatusBadge tone="info" dot={false}>Bán kèm</StatusBadge> : 'Công thức'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}

/**
 * Bảng phiếu của MỘT loại (mục đang xem đã lọc loại ⇒ không cần cột Loại). Kiểm kê không có đơn giá ⇒ ẩn Đơn giá/Thành tiền
 * và tách "Số lượng" thành Trước điều chỉnh | Điều chỉnh | Thực tế (như báo cáo kiểm kê hàng hóa). Số cũ/chênh lệch chỉ có ở
 * phiếu kiểm kê do FNet ghi; phiếu iCafe ghi chỉ biết số thực tế ⇒ hai cột kia hiện "—".
 */
function LedgerTable({
  rows,
  stocktake,
  sort,
  onSort,
}: {
  rows: LedgerRow[]
  stocktake: boolean
  sort: SortState<LedgerSortKey>
  onSort: (next: SortState<LedgerSortKey>) => void
}) {
  const showPrice = !stocktake
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <SortHeaderCell label="Thời điểm" sortKey="time" sort={sort} onSort={onSort} firstDir="desc" />
            <th>Nguyên liệu</th>
            {stocktake ? (
              <>
                <SortHeaderCell label="Trước điều chỉnh" sortKey="before" sort={sort} onSort={onSort} className="is-num" />
                <SortHeaderCell label="Điều chỉnh" sortKey="diff" sort={sort} onSort={onSort} className="is-num" />
                <SortHeaderCell label="Thực tế" sortKey="qty" sort={sort} onSort={onSort} className="is-num" />
              </>
            ) : (
              <SortHeaderCell label="Số lượng" sortKey="qty" sort={sort} onSort={onSort} className="is-num" />
            )}
            <th>Đơn vị</th>
            {showPrice ? <SortHeaderCell label="Đơn giá" sortKey="price" sort={sort} onSort={onSort} className="is-num" /> : null}
            {showPrice ? <SortHeaderCell label="Thành tiền" sortKey="amount" sort={sort} onSort={onSort} className="is-num" /> : null}
            <th>Mã phiếu</th>
            <th>Nhân viên</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.msId}>
              <td>{formatUnixSeconds(r.createDate)}</td>
              <td>{r.materialName}</td>
              {stocktake ? (
                <>
                  <td className="is-num">{ledgerHasStocktakeLog(r) ? formatQty(r.stockBefore) : '—'}</td>
                  <td className="is-num">
                    {ledgerHasStocktakeLog(r) && r.diff !== null ? (
                      diffTone(r.diff) === 'neutral' ? (
                        '0'
                      ) : (
                        <StatusBadge tone={diffTone(r.diff)} dot={false} title="Thực tế − trước điều chỉnh">
                          {formatDiff(r.diff)}
                        </StatusBadge>
                      )
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="is-num">
                    <strong>{formatQty(r.msQty)}</strong>
                  </td>
                </>
              ) : (
                <td className="is-num">
                  <strong>{formatQty(r.msQty)}</strong>
                </td>
              )}
              <td>{r.unit || '—'}</td>
              {showPrice ? <td className="is-num">{money(r.msPrice)}</td> : null}
              {showPrice ? <td className="is-num">{lineAmount(r)}</td> : null}
              <td>{r.msCode}</td>
              <td>{r.msUname}</td>
              <td className="inv-muted">{r.msNote}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
