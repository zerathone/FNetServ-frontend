// task work-shift S3 (F2) — trang quản lý "Ca làm việc" (/shifts): chọn ngày ⇒ danh sách ca (đang mở / đã chốt / cưỡng bức / treo),
// thẻ tóm tắt ngày + Thu ngoài ca, dòng ĐỐI SOÁT với báo cáo doanh thu (Q24), bấm một ca ⇒ Drawer chi tiết.
// Quyền: admin hoặc "Xem mọi ca" — server là lớp chặn thật (403), trang chỉ ẩn/hiện cho đúng.
import { useMemo, useState } from 'react'
import type { ShiftListItem, ShiftReconcile } from '../../api/shift'
import {
  Button,
  DatePicker,
  InlineAlert,
  ListToolbar,
  PageHeader,
  PollingStatus,
  RefreshButton,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { ShiftDetailDrawer } from './ShiftDetailDrawer'
import {
  SHIFT_LIST_POLL_MS,
  canForceClose,
  cashDiffView,
  isTodayYmd,
  reconcileFromList,
  reconcileVerdict,
  shiftStatusView,
  summarizeDay,
  todayYmd,
  viewAllGate,
} from './shiftManageModel'
import { formatMoney, formatShiftTime } from './shiftModel'
import { shiftErrorKind, useShiftList, useShiftReconcile } from './useShiftManage'
import './shifts.css'

const num = (value: number) => new Intl.NumberFormat('vi-VN').format(value)
const clock = (ms: number) =>
  ms > 0 ? new Date(ms).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'

export function ShiftsPage() {
  const isAdmin = useAuthStore((state) => state.isAdmin)
  const hasRight = useAuthStore((state) => state.hasRight)
  // Subscribe `rights` để trang tự cập nhật khi quyền phiên đổi (hasRight đọc store, không tự re-render).
  const rights = useAuthStore((state) => state.rights)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- `rights` là phụ thuộc thật của hasRight
  const gate = useMemo(() => viewAllGate(isAdmin, hasRight), [isAdmin, hasRight, rights])

  const [date, setDate] = useState(() => todayYmd())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showBad, setShowBad] = useState(false)

  const allowed = gate !== 'denied'
  const listQuery = useShiftList(date, allowed)
  // Chỉ đối soát sau khi danh sách tải được: không quyền / chưa bật chế độ ca thì không bắn thêm một request (và toast 403) nữa.
  const reconcileQuery = useShiftReconcile(date, allowed && listQuery.isSuccess)

  const today = isTodayYmd(date)
  const list = listQuery.data
  const totals = useMemo(() => (list ? summarizeDay(list.shifts, date) : null), [list, date])
  const selected: ShiftListItem | null = list?.shifts.find((s) => s.shiftId === selectedId) ?? null
  // Đối soát chi tiết (có danh sách phiếu) từ /shift/reconcile; lỗi thì dùng bản rút gọn đi kèm /shift/list.
  const reconcile: ShiftReconcile | null = reconcileQuery.data ?? (list ? reconcileFromList(list) : null)

  const changeDate = (value: string) => {
    if (!value) return
    setDate(value)
    setSelectedId(null)
    setShowBad(false)
  }

  const refreshAll = () => {
    void listQuery.refetch()
    void reconcileQuery.refetch()
  }

  const dateControl = (
    <DatePicker
      value={date}
      onChange={changeDate}
      max={todayYmd()}
      allowClear={false}
      aria-label="Ngày xem ca"
      presets={[]}
    />
  )

  const refreshControl = today ? (
    <PollingStatus
      connected={false}
      isError={listQuery.isError}
      isFetching={listQuery.isFetching}
      dataUpdatedAt={listQuery.dataUpdatedAt}
      intervalMs={SHIFT_LIST_POLL_MS}
      onRefresh={refreshAll}
      errorDetail={(listQuery.error as Error | null)?.message}
    />
  ) : (
    <RefreshButton loading={listQuery.isFetching} onClick={refreshAll} />
  )

  const header = (
    <PageHeader
      eyebrow="Quản lý"
      title="Ca làm việc"
      description="Doanh thu từng ca, đối soát với báo cáo doanh thu, đóng ca bị kẹt."
      actions={
        allowed ? (
          <div className="shifts-page__actions">
            {dateControl}
            {refreshControl}
          </div>
        ) : undefined
      }
    />
  )

  // ---- Trạng thái không có dữ liệu ----
  if (!allowed) {
    return (
      <div className="page-fill">
        {header}
        <section className="page-card">
          <StateView title="Bạn không có quyền xem danh sách ca" description="Cần quyền Xem mọi ca hoặc tài khoản quản trị." />
        </section>
      </div>
    )
  }

  // Màn lỗi toàn trang CHỈ khi chưa có dữ liệu: một lần poll lỗi mạng tạm thời không được xoá trang đang xem (và Drawer / hộp
  // thoại Đóng cưỡng bức đang mở) — `PollingStatus` đã báo lỗi, dữ liệu cũ vẫn hiển thị.
  if (listQuery.isError && !listQuery.data) {
    const kind = shiftErrorKind(listQuery.error)
    return (
      <div className="page-fill">
        {header}
        <section className="page-card">
          {kind === 'denied' ? (
            <StateView title="Bạn không có quyền xem danh sách ca" description="Cần quyền Xem mọi ca hoặc tài khoản quản trị." />
          ) : kind === 'disabled' ? (
            <StateView
              title="Chưa bật chế độ ca"
              description="Chế độ ca làm việc đang tắt. Nhờ quản trị viên bật chế độ ca rồi quay lại trang này."
            />
          ) : (
            <StateView
              title="Không tải được danh sách ca"
              description={(listQuery.error as Error | null)?.message}
              action={<Button onClick={() => void listQuery.refetch()}>Thử lại</Button>}
            />
          )}
        </section>
      </div>
    )
  }

  if (!list || !totals) {
    return (
      <div className="page-fill">
        {header}
        <section className="page-card">
          <StateView title="Đang tải danh sách ca" />
        </section>
      </div>
    )
  }

  const verdict = reconcile ? reconcileVerdict(reconcile) : null
  const badCodes = reconcile ? [...reconcile.orphans, ...reconcile.duplicates] : []
  const shiftsSub = [
    `${num(totals.openCount)} đang mở`,
    totals.hungCount > 0 ? `${num(totals.hungCount)} treo` : '',
    totals.carriedOver > 0 ? `${num(totals.carriedOver)} mở từ hôm trước` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <div className="page-fill">
      {header}
      <section className="page-card shifts-page">
        <div className="shift-kpis">
          <article className="shift-kpi">
            <h2 className="shift-kpi__label">Tổng số ca</h2>
            <p className="shift-kpi__value">{num(totals.shiftCount)}</p>
            <p className="shift-kpi__sub">{shiftsSub}</p>
          </article>
          <article className="shift-kpi">
            <h2 className="shift-kpi__label">Tổng doanh thu các ca</h2>
            <p className="shift-kpi__value">{formatMoney(totals.revenueTotal)}</p>
            <p className="shift-kpi__sub">Tính theo khung giờ của ca (gồm ca qua đêm); không gồm Thu ngoài ca</p>
          </article>
          <article className="shift-kpi">
            <h2 className="shift-kpi__label">Thu ngoài ca</h2>
            <dl className="shift-kpi__lines">
              <div>
                <dt>Hệ thống (tự động)</dt>
                <dd>
                  {formatMoney(list.outside.system.total)} <small>{num(list.outside.system.count)} lượt</small>
                </dd>
              </div>
              <div>
                <dt>Khác</dt>
                <dd>
                  {formatMoney(list.outside.other.total)} <small>{num(list.outside.other.count)} lượt</small>
                </dd>
              </div>
            </dl>
          </article>
        </div>

        {/* Dòng đối soát (Q24): Σ ca + Thu ngoài ca = báo cáo doanh thu tổng cùng ngày. */}
        {verdict && reconcile ? (
          verdict.matched ? (
            // InlineAlert đã có biểu tượng riêng; chữ "✓" là câu hiển thị theo thiết kế.
            <InlineAlert tone="success">
              <span>
                <strong>Khớp với báo cáo doanh thu ✓</strong>
                <span className="shift-reconcile__detail">
                  Báo cáo {formatMoney(reconcile.reportTotal)} = các ca {formatMoney(reconcile.shiftsTotal)} + Hệ thống{' '}
                  {formatMoney(reconcile.systemTotal)} + Khác {formatMoney(reconcile.otherTotal)}
                </span>
              </span>
            </InlineAlert>
          ) : (
            <InlineAlert tone="danger">
              <span>
                <span>
                  <strong>Lệch {formatMoney(Math.abs(verdict.diff))} — cần kiểm tra</strong>
                  <span className="shift-reconcile__detail">
                    {verdict.diff > 0
                      ? 'Báo cáo lớn hơn tổng các ô: có phiếu chưa được chia vào ca nào.'
                      : 'Tổng các ô lớn hơn báo cáo: có phiếu bị đếm hai lần.'}{' '}
                    Báo cáo {formatMoney(reconcile.reportTotal)} · các ca {formatMoney(reconcile.shiftsTotal)} + Hệ thống{' '}
                    {formatMoney(reconcile.systemTotal)} + Khác {formatMoney(reconcile.otherTotal)}
                  </span>
                  {badCodes.length > 0 ? (
                    <span className="shift-actions">
                      <Button type="button" variant="secondary" aria-expanded={showBad} onClick={() => setShowBad((v) => !v)}>
                        {showBad ? 'Ẩn phiếu gây lệch' : `Xem phiếu gây lệch (${badCodes.length})`}
                      </Button>
                    </span>
                  ) : reconcileQuery.isError ? (
                    <span className="shift-actions">
                      <span className="shift-reconcile__detail">Chưa tải được danh sách phiếu gây lệch.</span>
                      <Button type="button" variant="ghost" onClick={() => void reconcileQuery.refetch()}>
                        Thử lại
                      </Button>
                    </span>
                  ) : (
                    <span className="shift-reconcile__detail">Máy chủ chưa trả danh sách phiếu gây lệch.</span>
                  )}
                  {showBad && badCodes.length > 0 ? (
                    <span className="shift-bad">
                      {reconcile.orphans.length > 0 ? (
                        <span>
                          <strong>Chưa thuộc ô nào ({reconcile.orphans.length}):</strong>{' '}
                          <span className="shift-bad__codes">{reconcile.orphans.join(', ')}</span>
                        </span>
                      ) : null}
                      {reconcile.duplicates.length > 0 ? (
                        <span>
                          <strong>Thuộc hơn một ô ({reconcile.duplicates.length}):</strong>{' '}
                          <span className="shift-bad__codes">{reconcile.duplicates.join(', ')}</span>
                        </span>
                      ) : null}
                      <span className="shift-reconcile__detail">Tra mã phiếu ở Quản lý › Nhật ký giao dịch.</span>
                    </span>
                  ) : null}
                </span>
              </span>
            </InlineAlert>
          )
        ) : reconcileQuery.isError ? (
          <InlineAlert tone="warning">
            Không đối soát được với báo cáo doanh thu ({(reconcileQuery.error as Error).message}).{' '}
            <Button type="button" variant="ghost" onClick={() => void reconcileQuery.refetch()}>
              Thử lại
            </Button>
          </InlineAlert>
        ) : reconcileQuery.isLoading ? (
          <p className="shift-form__hint" role="status">Đang đối soát với báo cáo doanh thu…</p>
        ) : null}

        <div className="log-table-card shifts-page__table">
          <ListToolbar
            count={
              <>
                <strong>{num(list.shifts.length)}</strong> ca
                <span className="shifts-page__stamp"> · cập nhật lúc {clock(listQuery.dataUpdatedAt)}</span>
              </>
            }
            actions={null}
          />
          <div className="log-table-card__scroll">
            <table className="data-table shifts-table">
              <thead>
                <tr>
                  <th scope="col">Ca</th>
                  <th scope="col">Mở ca</th>
                  <th scope="col">Chốt ca</th>
                  <th scope="col">Trạng thái</th>
                  <th scope="col" className="cell-number">Doanh thu</th>
                  <th scope="col" className="cell-number">Tiền đầu ca</th>
                  <th scope="col" className="cell-number">Tiền mặt dự kiến</th>
                  <th scope="col" className="cell-number">Thực đếm</th>
                  <th scope="col" className="cell-number">Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {list.shifts.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="shifts-table__empty">
                      Không có ca nào {today ? 'hôm nay' : 'trong ngày này'}.
                    </td>
                  </tr>
                ) : (
                  list.shifts.map((shift) => {
                    const status = shiftStatusView(shift)
                    const diff = cashDiffView(shift.cashDiff, shift.status)
                    return (
                      <tr
                        key={shift.shiftId}
                        className={`shifts-table__row${shift.shiftId === selectedId ? ' is-selected' : ''}`}
                        onClick={() => setSelectedId(shift.shiftId)}
                      >
                        {/* td (không phải th scope=row): `.data-table th` là kiểu tiêu đề cột (sticky) sẽ đè lên các dòng. */}
                        <td className="shifts-table__ca">
                          <button
                            type="button"
                            className="shift-table__link shifts-table__open"
                            aria-label={`Xem chi tiết ca #${shift.shiftId} của ${shift.staffName || 'nhân viên'}`}
                            onClick={(event) => {
                              event.stopPropagation()
                              setSelectedId(shift.shiftId)
                            }}
                          >
                            Ca #{shift.shiftId}
                          </button>
                          <span className="shifts-table__staff">{shift.staffName || '—'}</span>
                        </td>
                        <td className="shift-table__nowrap">{formatShiftTime(shift.openTime)}</td>
                        <td className="shift-table__nowrap">{shift.closeTime ? formatShiftTime(shift.closeTime) : '—'}</td>
                        <td>
                          <StatusBadge tone={status.tone} title={status.hint} dot={shift.status === 1}>
                            {status.label}
                          </StatusBadge>
                        </td>
                        <td className="cell-number">{num(shift.revenue)}</td>
                        <td className="cell-number">{num(shift.openingCash)}</td>
                        <td className="cell-number">{shift.expectedCash === null ? '—' : num(shift.expectedCash)}</td>
                        <td className="cell-number">{shift.countedCash === null ? '—' : num(shift.countedCash)}</td>
                        <td
                          className={`cell-number shifts-table__diff${
                            diff.kind === 'short' ? ' is-short' : diff.kind === 'over' ? ' is-over' : diff.kind === 'ok' ? ' is-ok' : ''
                          }`}
                        >
                          {diff.text}
                        </td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <ShiftDetailDrawer
        shift={selected}
        canForceClose={selected ? canForceClose(selected.status, isAdmin, hasRight) : false}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
