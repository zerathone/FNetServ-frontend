import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp } from '@phosphor-icons/react'
import {
  getFinishedClosings,
  getFinishedImportReport,
  getFinishedStocktakeReport,
  type FinishedClosingRow,
  type FinishedImportReportRow,
  type FinishedReportFilter,
  type FinishedReportResult,
  type FinishedStocktakeReportRow,
} from '../../api/inventory'
import { sortRows, type SortState, type SortValue } from '../../lib/tableSort'
import { getStaffList } from '../../api/staff'
import {
  Button,
  DateRangePicker,
  InlineAlert,
  ListPagination,
  ListToolbar,
  RefreshButton,
  Select,
  SortHeaderCell,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import {
  defaultReportRange,
  diffBadge,
  effectiveStaffFilter,
  formatDateTimeText,
  formatInt,
  formatMoney,
  formatSigned,
  closingGroupFrom,
  groupClosingRows,
  REPORT_PAGE_SIZE,
  REPORT_RIGHTS,
  REPORT_DEFAULT_FROM_TIME,
  REPORT_DEFAULT_TO_TIME,
  reportOffset,
  reportTimeFilter,
  reportTotalPages,
  summarizeStocktakeAdjust,
  validateReportRange,
  type FinishedReportKind,
} from './finishedStockModel'
import { describeInventoryError, dateFilter } from './inventoryModel'
import { useFinishedServices } from './useFinishedServices'
import './inventory.css'

// ----- Bộ lọc chung của 3 báo cáo (Nhập kho | Kiểm kê | Chốt kho): Từ/Đến, Nhóm, Dịch vụ, Người thực hiện -----

type FilterState = {
  fromDate: string
  toDate: string
  /** 'HH:mm' — mặc định cả ngày (00:00 → 23:59). */
  fromTime: string
  toTime: string
  groupId: number
  serviceId: number
  staffId: number
  page: number
}

const STAFF_LABEL: Record<FinishedReportKind, string> = {
  imports: 'Người nhập',
  stocktakes: 'Người điều chỉnh',
  closings: 'Người chốt',
}

function useReportFilters(kind: FinishedReportKind) {
  const hasRight = useAuthStore((s) => s.hasRight)
  const myStaffId = useAuthStore((s) => s.staffId)
  const canAll = hasRight(REPORT_RIGHTS[kind].all)
  const [state, setState] = useState<FilterState>(() => ({
    ...defaultReportRange(),
    fromTime: REPORT_DEFAULT_FROM_TIME,
    toTime: REPORT_DEFAULT_TO_TIME,
    groupId: 0,
    serviceId: 0,
    staffId: 0,
    page: 0,
  }))
  // Đổi bộ lọc nào cũng về trang đầu; chỉ `setPage` mới giữ/đổi trang.
  const patch = (next: Partial<FilterState>) => setState((cur) => ({ ...cur, ...next, page: next.page ?? 0 }))
  const rangeError = validateReportRange(state.fromDate, state.toDate, state.fromTime, state.toTime)
  const filter: FinishedReportFilter = {
    fromDate: dateFilter(state.fromDate),
    toDate: dateFilter(state.toDate),
    ...reportTimeFilter(state.fromDate, state.toDate, state.fromTime, state.toTime),
    groupId: state.groupId || undefined,
    serviceId: state.serviceId || undefined,
    // Không có quyền ALL ⇒ khoá vào chính mình (parity Qt); máy chủ vẫn ép lại, không tin số này.
    staffId: effectiveStaffFilter(canAll, myStaffId, state.staffId),
    limit: REPORT_PAGE_SIZE,
    offset: reportOffset(state.page),
  }
  return { state, patch, canAll, myStaffId, rangeError, filter }
}

type Filters = ReturnType<typeof useReportFilters>

function ReportFilterBar({ kind, f }: { kind: FinishedReportKind; f: Filters }) {
  const { managed } = useFinishedServices()
  const staffName = useAuthStore((s) => s.staffName)
  const groups = useMemo(() => {
    const map = new Map<number, string>()
    for (const s of managed) {
      if (s.groupId && s.groupId > 0 && !map.has(s.groupId)) map.set(s.groupId, s.groupName || `Nhóm ${s.groupId}`)
    }
    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'vi'))
  }, [managed])
  const services = f.state.groupId === 0 ? managed : managed.filter((s) => s.groupId === f.state.groupId)

  const staffQuery = useQuery({
    queryKey: ['report-staff-list'],
    queryFn: () => getStaffList({ includeInactive: true }),
    enabled: f.canAll,
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return (
    // Cùng kiểu thanh lọc của trang báo cáo (/analysis): DateRangePicker gọn + mỗi [nhãn | combo] gom 1 khung `ds-input-group`.
    <div className="inv-filters inv-filters--report">
      <DateRangePicker
        label="Khoảng ngày"
        fromDate={f.state.fromDate}
        toDate={f.state.toDate}
        onFromDateChange={(value) => f.patch({ fromDate: value })}
        onToDateChange={(value) => f.patch({ toDate: value })}
        fromTime={f.state.fromTime}
        toTime={f.state.toTime}
        onFromTimeChange={(value) => f.patch({ fromTime: value })}
        onToTimeChange={(value) => f.patch({ toTime: value })}
      />
      {groups.length > 0 ? (
        <div className="ds-input-group">
          <span className="ds-input-group-separator">Nhóm</span>
          <Select
            aria-label="Lọc theo nhóm"
            value={f.state.groupId}
            onChange={(e) => f.patch({ groupId: Number(e.target.value), serviceId: 0 })}
          >
            <option value={0}>Tất cả</option>
            {groups.map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </Select>
        </div>
      ) : null}
      <div className="ds-input-group">
        <span className="ds-input-group-separator">Dịch vụ</span>
        <Select searchable aria-label="Lọc theo dịch vụ" value={f.state.serviceId} onChange={(e) => f.patch({ serviceId: Number(e.target.value) })}>
          <option value={0}>Tất cả</option>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      </div>
      <div className="ds-input-group">
        <span className="ds-input-group-separator">{STAFF_LABEL[kind]}</span>
        {f.canAll ? (
          <Select aria-label={`Lọc theo ${STAFF_LABEL[kind].toLocaleLowerCase('vi')}`} value={f.state.staffId} onChange={(e) => f.patch({ staffId: Number(e.target.value) })}>
            <option value={0}>Tất cả</option>
            {(staffQuery.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.username}
              </option>
            ))}
          </Select>
        ) : (
          // Chỉ có quyền xem của mình (parity Qt): khoá combo vào chính người đăng nhập.
          <Select
            aria-label={`Lọc theo ${STAFF_LABEL[kind].toLocaleLowerCase('vi')}`}
            value={f.myStaffId ?? 0}
            disabled
          >
            <option value={f.myStaffId ?? 0}>{staffName ? `Của tôi (${staffName})` : 'Của tôi'}</option>
          </Select>
        )}
      </div>
    </div>
  )
}

const timeCell = (date: string, time: string) => formatDateTimeText(date, time)

/** Khung chung: bộ lọc + thanh "Tổng N" + phân trang 200 dòng + trạng thái tải/lỗi/rỗng. */
function ReportShell<Row>({
  kind,
  f,
  query,
  extraCount,
  children,
}: {
  kind: FinishedReportKind
  f: Filters
  query: {
    isLoading: boolean
    isError: boolean
    isFetching: boolean
    error: unknown
    data: FinishedReportResult<Row> | undefined
    refetch: () => unknown
  }
  extraCount?: ReactNode
  children: (rows: Row[]) => ReactNode
}) {
  const data = query.data
  const total = data?.total ?? 0
  const totalPages = reportTotalPages(total)
  return (
    <section className="inv-panel" aria-label="Báo cáo kho hàng hóa">
      <ReportFilterBar kind={kind} f={f} />
      {f.rangeError ? <InlineAlert tone="danger">{f.rangeError}</InlineAlert> : null}
      <ListToolbar
        count={
          <>
            Tổng <strong>{formatInt(total)}</strong> dòng{extraCount}
          </>
        }
        actions={
          <>
            <RefreshButton loading={query.isFetching} onClick={() => void query.refetch()} />
            <ListPagination
              page={f.state.page}
              totalPages={totalPages}
              canNext={f.state.page < totalPages - 1}
              onPrevious={() => f.patch({ page: Math.max(0, f.state.page - 1) })}
              onNext={() => f.patch({ page: Math.min(totalPages - 1, f.state.page + 1) })}
            />
          </>
        }
      />
      {f.rangeError ? null : query.isLoading ? (
        <StateView title="Đang tải…" />
      ) : query.isError ? (
        <StateView
          title="Không tải được báo cáo"
          description={describeInventoryError(query.error)}
          action={
            <Button type="button" onClick={() => void query.refetch()}>
              Thử lại
            </Button>
          }
        />
      ) : data?.supported === false ? (
        <StateView title="Cơ sở dữ liệu chưa có bảng kho hàng hóa" />
      ) : (data?.rows.length ?? 0) === 0 ? (
        <StateView title="Không có dữ liệu" description="Thử đổi khoảng ngày hoặc bộ lọc." />
      ) : (
        <div className="inv-table-wrap inv-report-wrap">{children(data?.rows ?? [])}</div>
      )}
    </section>
  )
}

// ----- Nhập kho -----

type ImportSortKey = 'time' | 'qty' | 'price' | 'amount'
type StocktakeSortKey = 'time' | 'expected' | 'before' | 'adjust' | 'real'
type ClosingSortKey = 'time' | 'balance' | 'import' | 'adjust' | 'sale' | 'real' | 'importValue' | 'saleValue'

// Cột thời gian / số lượng / tiền sắp xếp được ở header. Chỉ sắp các dòng của trang đang xem (báo cáo phân trang ở máy chủ).
const timeKey = (date: string, time: string) => `${date} ${time}`

const IMPORT_SORT: Record<ImportSortKey, (r: FinishedImportReportRow) => SortValue> = {
  time: (r) => timeKey(r.createDate, r.createTime),
  qty: (r) => r.importQuantity,
  price: (r) => r.importPrice,
  amount: (r) => r.importTotalAmount,
}

const STOCKTAKE_SORT: Record<StocktakeSortKey, (r: FinishedStocktakeReportRow) => SortValue> = {
  time: (r) => timeKey(r.createDate, r.createTime),
  expected: (r) => r.numInventoryExpected,
  before: (r) => r.numPreAdjust,
  adjust: (r) => r.numAdjust,
  real: (r) => r.numInventoryReal,
}

const CLOSING_SORT: Record<ClosingSortKey, (r: FinishedClosingRow) => SortValue> = {
  time: (r) => timeKey(r.createDate, r.createTime),
  balance: (r) => r.numBalance,
  import: (r) => r.importQuantity,
  adjust: (r) => r.numAdjust,
  sale: (r) => r.saleQuantity,
  real: (r) => r.numInventoryReal,
  importValue: (r) => r.importTotalAmount,
  saleValue: (r) => r.saleTotalAmount,
}

export function ImportReportView() {
  const [sort, setSort] = useState<SortState<ImportSortKey>>(null)
  const f = useReportFilters('imports')
  const query = useQuery({
    queryKey: ['inventory', 'finished', 'report', 'imports', f.filter],
    queryFn: () => getFinishedImportReport(f.filter),
    enabled: f.rangeError === null,
    placeholderData: (previous) => previous,
  })
  return (
    <ReportShell
      kind="imports"
      f={f}
      query={query}
      extraCount={
        <>
          {' · '}Tổng tiền: <strong>{formatMoney(query.data?.totalAmount ?? 0)}</strong>
        </>
      }
    >
      {(rows) => (
        <table className="inv-table">
          <thead>
            <tr>
              <SortHeaderCell label="Thời điểm" sortKey="time" sort={sort} onSort={setSort} firstDir="desc" />
              <th>Mặt hàng</th>
              <th>Nhóm</th>
              <th>Người nhập</th>
              <SortHeaderCell label="Số lượng" sortKey="qty" sort={sort} onSort={setSort} className="is-num" />
              <th>Đơn vị</th>
              <SortHeaderCell label="Giá nhập" sortKey="price" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Thành tiền" sortKey="amount" sort={sort} onSort={setSort} className="is-num" />
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {sortRows(rows, sort, IMPORT_SORT).map((r) => (
              <tr key={r.id}>
                <td>{timeCell(r.createDate, r.createTime)}</td>
                <td>{r.serviceName}</td>
                <td>{r.groupName}</td>
                <td>{r.userName}</td>
                <td className="is-num">{formatInt(r.importQuantity)}</td>
                <td>{r.unit}</td>
                <td className="is-num">{formatMoney(r.importPrice)}</td>
                <td className="is-num">{formatMoney(r.importTotalAmount)}</td>
                <td className="inv-muted">{r.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </ReportShell>
  )
}

// ----- Kiểm kê -----

export function StocktakeReportView() {
  const [sort, setSort] = useState<SortState<StocktakeSortKey>>(null)
  const f = useReportFilters('stocktakes')
  const query = useQuery({
    queryKey: ['inventory', 'finished', 'report', 'stocktakes', f.filter],
    queryFn: () => getFinishedStocktakeReport(f.filter),
    enabled: f.rangeError === null,
    placeholderData: (previous) => previous,
  })
  const rowsLoaded = query.data?.rows ?? []
  const adjust = summarizeStocktakeAdjust(rowsLoaded)
  const multiPage = reportTotalPages(query.data?.total ?? 0) > 1
  return (
    <ReportShell
      kind="stocktakes"
      f={f}
      query={query}
      extraCount={
        rowsLoaded.length > 0 ? (
          <>
            {' · '}
            <span title="Số dòng kiểm kê không chênh lệch">
              Cân bằng <strong>{formatInt(adjust.unchanged)}</strong>
            </span>{' '}
            <StatusBadge tone="danger" dot={false} title="Điều chỉnh giảm (hao hụt): số dòng | tổng số lượng">
              <ArrowDown size={14} weight="bold" aria-hidden="true" /> {formatInt(adjust.decreaseLines)}
              <span className="inv-stat-sep" aria-hidden="true" />−{formatInt(adjust.decrease)}
            </StatusBadge>{' '}
            <StatusBadge tone="success" dot={false} title="Điều chỉnh tăng (dư): số dòng | tổng số lượng">
              <ArrowUp size={14} weight="bold" aria-hidden="true" /> {formatInt(adjust.increaseLines)}
              <span className="inv-stat-sep" aria-hidden="true" />+{formatInt(adjust.increase)}
            </StatusBadge>
            {multiPage ? ' (trang này)' : null}
          </>
        ) : null
      }
    >
      {(rows) => (
        <table className="inv-table">
          <thead>
            <tr>
              <SortHeaderCell label="Thời điểm" sortKey="time" sort={sort} onSort={setSort} firstDir="desc" />
              <th>Mặt hàng</th>
              <th>Nhóm</th>
              <th>Người điều chỉnh</th>
              <SortHeaderCell label="Dự kiến" sortKey="expected" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Trước điều chỉnh" sortKey="before" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Điều chỉnh" sortKey="adjust" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Thực tế" sortKey="real" sort={sort} onSort={setSort} className="is-num" />
              <th>Đơn vị</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {sortRows(rows, sort, STOCKTAKE_SORT).map((r) => {
              const badge = diffBadge(r.numAdjust)
              return (
                <tr key={r.id}>
                  <td>{timeCell(r.createDate, r.createTime)}</td>
                  <td>{r.serviceName}</td>
                  <td>{r.groupName}</td>
                  <td>{r.userName}</td>
                  <td className="is-num">{formatInt(r.numInventoryExpected)}</td>
                  <td className="is-num">{formatInt(r.numPreAdjust)}</td>
                  <td className="is-num">
                    {badge ? (
                      <StatusBadge tone={badge.tone} dot={false}>
                        {badge.text}
                      </StatusBadge>
                    ) : (
                      formatSigned(r.numAdjust)
                    )}
                  </td>
                  <td className="is-num">{formatInt(r.numInventoryReal)}</td>
                  <td>{r.unit}</td>
                  <td className="inv-muted">{r.note}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </ReportShell>
  )
}

// ----- Chốt kho (trước là "Nhập – xuất"; lịch sử chốt kho; số ĐÃ LƯU lúc chốt, không tính lại) -----

export function ClosingsReportView() {
  const [sort, setSort] = useState<SortState<ClosingSortKey>>(null)
  const f = useReportFilters('closings')
  const query = useQuery({
    queryKey: ['inventory', 'finished', 'closings', f.filter],
    queryFn: () => getFinishedClosings(f.filter),
    enabled: f.rangeError === null,
    placeholderData: (previous) => previous,
  })
  return (
    <ReportShell kind="closings" f={f} query={query}>
      {(rows) => {
        // Gom theo lần chốt: "Thời điểm chốt" + "Người chốt" đứng kề nhau và gộp ô (rowSpan) một lần cho cả kỳ. Sắp theo cột
        // Thời điểm chốt ⇒ đảo thứ tự các NHÓM; sắp theo cột khác ⇒ sắp các dòng TRONG từng nhóm (nhóm luôn giữ nguyên).
        const groups = groupClosingRows(rows)
        const ordered =
          sort?.key === 'time'
            ? sortRows(groups, { key: 'time' as const, dir: sort.dir }, { time: (g) => timeKey(g.createDate, g.createTime) })
            : groups
        return (
        <table className="inv-table">
          <thead>
            <tr>
              <SortHeaderCell label="Thời điểm chốt" sortKey="time" sort={sort} onSort={setSort} firstDir="desc" />
              <th>Người chốt</th>
              <th>Mặt hàng</th>
              <th>Nhóm</th>
              <SortHeaderCell label="Đầu kỳ" sortKey="balance" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Nhập" sortKey="import" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Điều chỉnh" sortKey="adjust" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Bán" sortKey="sale" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Cuối kỳ" sortKey="real" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Giá trị nhập" sortKey="importValue" sort={sort} onSort={setSort} className="is-num" />
              <SortHeaderCell label="Giá trị bán" sortKey="saleValue" sort={sort} onSort={setSort} className="is-num" />
              <th>Đơn vị</th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((group) => {
              const groupRows = sort && sort.key !== 'time' ? sortRows(group.rows, sort, CLOSING_SORT) : group.rows
              // Ghi chú lúc chốt được lưu giống nhau ở mọi dòng của kỳ ⇒ lấy dòng đầu có ghi chú. Kỳ ≥ 2 dòng: ô Thời điểm chốt /
              // Người chốt chỉ chiếm DÒNG ĐẦU, ghi chú nằm ngay dưới (gộp 2 cột, trải hết phần còn lại của kỳ) ⇒ luôn ở đầu kỳ,
              // kể cả kỳ có hàng trăm mặt hàng hay bị cắt sang trang sau. Kỳ 1 dòng: ghi chú ngay dưới thời điểm.
              const note = groupRows.map((r) => r.note.trim()).find((n) => n !== '') ?? ''
              const noteRow = note !== '' && groupRows.length >= 2
              const from = closingGroupFrom(groupRows)
              const headSpan = noteRow ? 1 : groupRows.length
              return groupRows.map((r, index) => (
                <tr key={r.id} className={index === 0 ? 'is-group-start' : undefined}>
                  {index === 0 ? (
                    <>
                      <td className="inv-group-cell" rowSpan={headSpan}>
                        <strong>{timeCell(group.createDate, group.createTime)}</strong>
                        {from ? (
                          <small
                            className="inv-muted"
                            title={from.extra > 0 ? `${from.extra} mặt hàng có mốc đầu kỳ khác (thêm sau lần chốt trước); đang hiện mốc sớm nhất.` : undefined}
                          >
                            Từ {timeCell(from.fromDate, from.fromTime)}
                            {from.extra > 0 ? ` (+${from.extra} mốc khác)` : ''}
                          </small>
                        ) : null}
                        <small className="inv-muted">{formatInt(groupRows.length)} mặt hàng</small>
                        {note !== '' && !noteRow ? <small className="inv-group-note">Ghi chú: {note}</small> : null}
                      </td>
                      <td className="inv-group-cell" rowSpan={headSpan}>
                        {r.userName}
                      </td>
                    </>
                  ) : null}
                  {noteRow && index === 1 ? (
                    <td className="inv-group-cell inv-group-note" colSpan={2} rowSpan={groupRows.length - 1} title={note}>
                      Ghi chú: {note}
                    </td>
                  ) : null}
                  <td>{r.serviceName}</td>
                  <td>{r.groupName}</td>
                  <td className="is-num">{formatInt(r.numBalance)}</td>
                  <td className="is-num">{formatInt(r.importQuantity)}</td>
                  <td className="is-num">{formatSigned(r.numAdjust)}</td>
                  <td className="is-num">{formatInt(r.saleQuantity)}</td>
                  <td className="is-num">
                    <strong>{formatInt(r.numInventoryReal)}</strong>
                  </td>
                  <td className="is-num">{formatMoney(r.importTotalAmount)}</td>
                  <td className="is-num">{formatMoney(r.saleTotalAmount)}</td>
                  <td>{r.unit}</td>
                </tr>
              ))
            })}
          </tbody>
        </table>
        )
      }}
    </ReportShell>
  )
}
