import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getFinishedClosings,
  getFinishedImportReport,
  getFinishedStocktakeReport,
  type FinishedReportFilter,
  type FinishedReportResult,
} from '../../api/inventory'
import { getStaffList } from '../../api/staff'
import {
  Button,
  DateRangePicker,
  InlineAlert,
  ListPagination,
  ListToolbar,
  RefreshButton,
  Select,
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
  REPORT_PAGE_SIZE,
  REPORT_RIGHTS,
  REPORT_DEFAULT_FROM_TIME,
  REPORT_DEFAULT_TO_TIME,
  reportOffset,
  reportTimeFilter,
  reportTotalPages,
  validateReportRange,
  type FinishedReportKind,
} from './finishedStockModel'
import { describeInventoryError, dateFilter } from './inventoryModel'
import { useFinishedServices } from './useFinishedServices'
import './inventory.css'

// ----- Bộ lọc chung của 3 báo cáo (Nhập kho | Kiểm kê | Nhập – xuất): Từ/Đến, Nhóm, Dịch vụ, Người thực hiện -----

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
    <section className="inv-panel" aria-label="Báo cáo kho thành phẩm">
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
        <StateView title="Cơ sở dữ liệu chưa có bảng kho thành phẩm" />
      ) : (data?.rows.length ?? 0) === 0 ? (
        <StateView title="Không có dữ liệu" description="Thử đổi khoảng ngày hoặc bộ lọc." />
      ) : (
        <div className="inv-table-wrap inv-report-wrap">{children(data?.rows ?? [])}</div>
      )}
    </section>
  )
}

// ----- Nhập kho -----

export function ImportReportView() {
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
              <th>Thời điểm</th>
              <th>Mặt hàng</th>
              <th>Nhóm</th>
              <th>Người nhập</th>
              <th className="is-num">Số lượng</th>
              <th>Đơn vị</th>
              <th className="is-num">Giá nhập</th>
              <th className="is-num">Thành tiền</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
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
  const f = useReportFilters('stocktakes')
  const query = useQuery({
    queryKey: ['inventory', 'finished', 'report', 'stocktakes', f.filter],
    queryFn: () => getFinishedStocktakeReport(f.filter),
    enabled: f.rangeError === null,
    placeholderData: (previous) => previous,
  })
  return (
    <ReportShell kind="stocktakes" f={f} query={query}>
      {(rows) => (
        <table className="inv-table">
          <thead>
            <tr>
              <th>Thời điểm</th>
              <th>Mặt hàng</th>
              <th>Nhóm</th>
              <th>Người điều chỉnh</th>
              <th className="is-num">Dự kiến</th>
              <th className="is-num">Trước điều chỉnh</th>
              <th className="is-num">Điều chỉnh</th>
              <th className="is-num">Thực tế</th>
              <th>Đơn vị</th>
              <th>Ghi chú</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
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

// ----- Nhập – xuất (lịch sử chốt kho; số ĐÃ LƯU lúc chốt, không tính lại) -----

export function ClosingsReportView() {
  const f = useReportFilters('closings')
  const query = useQuery({
    queryKey: ['inventory', 'finished', 'closings', f.filter],
    queryFn: () => getFinishedClosings(f.filter),
    enabled: f.rangeError === null,
    placeholderData: (previous) => previous,
  })
  return (
    <ReportShell kind="closings" f={f} query={query}>
      {(rows) => (
        <table className="inv-table">
          <thead>
            <tr>
              <th>Thời điểm chốt</th>
              <th>Mặt hàng</th>
              <th>Nhóm</th>
              <th>Người chốt</th>
              <th>Từ</th>
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
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{timeCell(r.createDate, r.createTime)}</td>
                <td>{r.serviceName}</td>
                <td>{r.groupName}</td>
                <td>{r.userName}</td>
                <td>{timeCell(r.fromDate, r.fromTime)}</td>
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
            ))}
          </tbody>
        </table>
      )}
    </ReportShell>
  )
}
