import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  getLedger,
  getMaterials,
  getUsage,
  type InventoryFilter,
  type LedgerRow,
} from '../../api/inventory'
import {
  Button,
  ListPagination,
  ListToolbar,
  RefreshButton,
  Segmented,
  Select,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import {
  dateFilter,
  describeInventoryError,
  diffTone,
  formatDiff,
  formatQty,
  formatUnixSeconds,
  ledgerHasStocktakeLog,
  MOVE_TYPE_LABEL,
} from './inventoryModel'

const PAGE_SIZE = 50
const money = (value: string) => (value && value !== '0' ? formatQty(value) : '—')

type View = 'ledger' | 'usage'

/** Tab Sổ kho & tiêu hao: chỉ đọc. Sổ kho = phiếu nhập/xuất/kiểm kê; Tiêu hao = nguyên liệu trừ theo đơn bán. */
export function LedgerTab() {
  const [view, setView] = useState<View>('ledger')
  const [materialId, setMaterialId] = useState(0)
  const [msType, setMsType] = useState(0)
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [page, setPage] = useState(0)

  const materialsQuery = useQuery({
    queryKey: ['inventory', 'materials', { activeOnly: false, lowOnly: false }],
    queryFn: () => getMaterials({ activeOnly: false, lowOnly: false, limit: 1000 }),
  })

  const filter: InventoryFilter = {
    materialId: materialId || undefined,
    msType: view === 'ledger' ? msType || undefined : undefined,
    fromDate: dateFilter(fromDate),
    toDate: dateFilter(toDate),
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  }
  const reset = () => setPage(0)

  const ledgerQuery = useQuery({
    queryKey: ['inventory', 'ledger', filter],
    queryFn: () => getLedger(filter),
    enabled: view === 'ledger',
  })
  const usageQuery = useQuery({
    queryKey: ['inventory', 'usage', filter],
    queryFn: () => getUsage(filter),
    enabled: view === 'usage',
  })

  const active = view === 'ledger' ? ledgerQuery : usageQuery
  const total = (view === 'ledger' ? ledgerQuery.data?.total : usageQuery.data?.total) ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const hasFilter = materialId !== 0 || msType !== 0 || fromDate !== '' || toDate !== ''

  return (
    <section className="inv-panel" aria-label="Sổ kho và tiêu hao">
      <div className="inv-filters">
        <Segmented<View>
          ariaLabel="Loại báo cáo"
          value={view}
          onChange={(next) => {
            setView(next)
            reset()
          }}
          options={[
            { value: 'ledger', label: 'Sổ kho' },
            { value: 'usage', label: 'Tiêu hao theo đơn' },
          ]}
        />
        <label className="ds-field inv-filters__field">
          <span className="ds-field__label">Nguyên liệu</span>
          <Select
            className="ds-input"
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
        </label>
        {view === 'ledger' ? (
          <label className="ds-field inv-filters__field">
            <span className="ds-field__label">Loại phiếu</span>
            <Select
              className="ds-input"
              value={msType}
              onChange={(e) => {
                setMsType(Number(e.target.value))
                reset()
              }}
            >
              <option value={0}>Tất cả</option>
              <option value={1}>{MOVE_TYPE_LABEL[1]}</option>
              <option value={2}>{MOVE_TYPE_LABEL[2]}</option>
              <option value={3}>{MOVE_TYPE_LABEL[3]}</option>
            </Select>
          </label>
        ) : null}
        <label className="ds-field inv-filters__field">
          <span className="ds-field__label">Từ ngày</span>
          <input
            className="ds-input"
            type="date"
            value={fromDate}
            onChange={(e) => {
              setFromDate(e.target.value)
              reset()
            }}
          />
        </label>
        <label className="ds-field inv-filters__field">
          <span className="ds-field__label">Đến ngày</span>
          <input
            className="ds-input"
            type="date"
            value={toDate}
            onChange={(e) => {
              setToDate(e.target.value)
              reset()
            }}
          />
        </label>
        {hasFilter ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setMaterialId(0)
              setMsType(0)
              setFromDate('')
              setToDate('')
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
      ) : view === 'ledger' ? (
        ledgerQuery.data?.supported === false ? (
          <StateView title="Cơ sở dữ liệu chưa có sổ kho nguyên liệu" />
        ) : (ledgerQuery.data?.rows.length ?? 0) === 0 ? (
          <StateView title="Chưa có phiếu nào" description={hasFilter ? 'Thử đổi bộ lọc.' : undefined} />
        ) : (
          <LedgerTable rows={ledgerQuery.data?.rows ?? []} />
        )
      ) : usageQuery.data?.supported === false ? (
        <StateView title="Cơ sở dữ liệu chưa có dữ liệu tiêu hao nguyên liệu" />
      ) : (usageQuery.data?.rows.length ?? 0) === 0 ? (
        <StateView title="Chưa có tiêu hao nào" description={hasFilter ? 'Thử đổi bộ lọc.' : undefined} />
      ) : (
        <>
          {(usageQuery.data?.summary.length ?? 0) > 0 ? (
            <div className="inv-summary" aria-label="Tổng tiêu hao theo nguyên liệu">
              {usageQuery.data?.summary.map((s) => (
                <div className="inv-summary__item" key={s.materialId}>
                  <span className="inv-muted">{s.materialName}</span>
                  <strong>{formatQty(s.totalQty)}</strong>
                  <small className="inv-muted">{s.lines} dòng</small>
                </div>
              ))}
            </div>
          ) : null}
          <div className="inv-table-wrap">
            <table className="inv-table">
              <thead>
                <tr>
                  <th>Thời điểm</th>
                  <th>Món bán</th>
                  <th>Nguyên liệu</th>
                  <th className="is-num">SL bán</th>
                  <th className="is-num">Tiêu hao</th>
                  <th>Loại</th>
                </tr>
              </thead>
              <tbody>
                {usageQuery.data?.rows.map((r) => (
                  <tr key={r.id}>
                    <td>{r.createDate}</td>
                    <td>
                      {r.serviceName}
                      <small className="inv-muted"> đơn #{r.orderServiceId || r.serviceDetailId}</small>
                    </td>
                    <td>{r.materialName}</td>
                    <td className="is-num">{r.serviceQty}</td>
                    <td className="is-num">
                      <strong>{formatQty(r.totalQty)}</strong> <span className="inv-muted">{r.unit}</span>
                    </td>
                    <td>{r.isTopping === 1 ? <StatusBadge tone="info" dot={false}>Topping</StatusBadge> : 'Công thức'}</td>
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

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  return (
    <div className="inv-table-wrap">
      <table className="inv-table">
        <thead>
          <tr>
            <th>Thời điểm</th>
            <th>Nguyên liệu</th>
            <th>Loại</th>
            <th className="is-num">Số lượng</th>
            <th className="is-num">Đơn giá</th>
            <th>Mã phiếu</th>
            <th>Người làm</th>
            <th>Ghi chú</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.msId}>
              <td>{formatUnixSeconds(r.createDate)}</td>
              <td>{r.materialName}</td>
              <td>
                <StatusBadge tone={r.msType === 1 ? 'success' : r.msType === 2 ? 'warning' : 'info'} dot={false}>
                  {MOVE_TYPE_LABEL[r.msType] ?? `Loại ${r.msType}`}
                </StatusBadge>
              </td>
              <td className="is-num">
                {ledgerHasStocktakeLog(r) ? (
                  <>
                    <span className="inv-muted">{formatQty(r.stockBefore)} → </span>
                    <strong>{formatQty(r.msQty)}</strong>{' '}
                    <StatusBadge tone={diffTone(r.diff)} dot={false} title="Chênh lệch kiểm kê">
                      {formatDiff(r.diff)}
                    </StatusBadge>
                  </>
                ) : (
                  <strong>{formatQty(r.msQty)}</strong>
                )}{' '}
                <span className="inv-muted">{r.unit}</span>
              </td>
              <td className="is-num">{money(r.msPrice)}</td>
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
