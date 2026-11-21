// task work-shift S3 (F2) — trang quản lý "Ca làm việc" (/shifts): chọn ngày ⇒ danh sách ca (đang mở / đã chốt / cưỡng bức / treo),
// thẻ tóm tắt ngày + Thu ngoài ca, dòng ĐỐI SOÁT với báo cáo doanh thu (Q24), bấm một ca ⇒ Drawer chi tiết.
// Quyền: admin hoặc "Xem mọi ca" — server là lớp chặn thật (403), trang chỉ ẩn/hiện cho đúng.
import { MoonStars, Warning } from '@phosphor-icons/react'
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
  canViewAllShifts,
  cashDiffView,
  isTodayYmd,
  reconcileFromList,
  reconcileVerdict,
  shiftDayView,
  shiftStatusView,
  summarizeDay,
  todayYmd,
} from './shiftManageModel'
import { describeDrift, formatMoney, formatShiftTime, hasDrift } from './shiftModel'
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
  const allowed = useMemo(() => canViewAllShifts(isAdmin, hasRight), [isAdmin, hasRight, rights])

  const [date, setDate] = useState(() => todayYmd())
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [showBad, setShowBad] = useState(false)

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
  const excluded = reconcile?.excludedNoUser
  const excludedNote =
    excluded && excluded.count > 0
      ? `Có ${num(excluded.count)} phiếu (${formatMoney(excluded.total)}) không gắn với tài khoản người dùng nào: báo cáo doanh thu bỏ qua các phiếu này nên được tách riêng khi đối soát.`
      : ''
  const shiftsSub = [
    `${num(totals.openCount)} đang mở`,
    totals.hungCount > 0 ? `${num(totals.hungCount)} treo` : '',
    totals.carriedOver > 0 ? `${num(totals.carriedOver)} ca qua đêm (mở từ ngày trước)` : '',
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
            <h2 className="shift-kpi__label">Doanh thu các ca trong ngày</h2>
            <p className="shift-kpi__value">{formatMoney(totals.revenueTotal)}</p>
            <p className="shift-kpi__sub">
              Số tính lại hiện tại, chỉ phần thuộc ngày đang xem (ca qua đêm chia theo ngày); không gồm Thu ngoài ca và phiếu
              không gắn tài khoản người dùng
            </p>
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
                {excludedNote ? <span className="shift-reconcile__detail">{excludedNote}</span> : null}
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
                  {excludedNote ? <span className="shift-reconcile__detail">{excludedNote}</span> : null}
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

        {totals.driftCount > 0 ? (
          <InlineAlert tone="warning">
            <span className="shift-inline-icon">
              <Warning size={18} weight="fill" aria-hidden="true" />
              <span>
                <strong>Số liệu đã thay đổi sau khi chốt ca ({num(totals.driftCount)} ca)</strong>
                <span className="shift-reconcile__detail">
                  Có phiếu bị sửa hoặc hủy sau khi chốt. Cột Doanh thu cả ca của ca đã chốt là số đã lưu lúc chốt; cột Doanh thu
                  trong ngày, danh sách giao dịch và đối soát là số tính lại hiện tại. Các ca này có nhãn “Số liệu đã thay đổi”
                  ở cột Trạng thái.
                </span>
              </span>
            </span>
          </InlineAlert>
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
                  <th scope="col" className="cell-number" title="Phần doanh thu thuộc ngày đang xem, tính lại từ phiếu hiện tại">Doanh thu trong ngày</th>
                  <th scope="col" className="cell-number" title="Toàn bộ doanh thu của ca, kể cả phần sang ngày khác. Ca đã chốt: số đã lưu lúc chốt">Doanh thu cả ca</th>
                  <th scope="col" className="cell-number">Tiền đầu ca</th>
                  <th scope="col" className="cell-number">Tiền mặt dự kiến</th>
                  <th scope="col" className="cell-number">Thực đếm</th>
                  <th scope="col" className="cell-number">Chênh lệch</th>
                </tr>
              </thead>
              <tbody>
                {list.shifts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="shifts-table__empty">
                      Không có ca nào {today ? 'hôm nay' : 'trong ngày này'}.
                    </td>
                  </tr>
                ) : (
                  list.shifts.map((shift) => {
                    const status = shiftStatusView(shift)
                    const diff = cashDiffView(shift.cashDiff, shift.status)
                    const dayView = shiftDayView(shift, date)
                    const drift = hasDrift(shift.drift) ? shift.drift : null
                    // Ca còn kéo sang sau ngày đang xem: tiền đầu ca / đếm / chênh lệch chỉ có đủ ở dòng ngày chốt.
                    const pendingCash = (label: string) => (
                      <td className="cell-number shifts-table__deferred" title={`${label}: xem ở dòng của ngày chốt ca`}>
                        —
                      </td>
                    )
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
                          {dayView.note ? (
                            <span className="shifts-table__overnight">
                              <MoonStars size={14} weight="fill" aria-hidden="true" />
                              {dayView.note}
                            </span>
                          ) : null}
                        </td>
                        <td className="shift-table__nowrap">{formatShiftTime(shift.openTime)}</td>
                        <td className="shift-table__nowrap">{shift.closeTime ? formatShiftTime(shift.closeTime) : '—'}</td>
                        <td>
                          <span className="shifts-table__badges">
                            <StatusBadge tone={status.tone} title={status.hint} dot={shift.status === 1}>
                              {status.label}
                            </StatusBadge>
                            {drift ? (
                              <StatusBadge tone="warning" title={describeDrift(drift).join(' ')}>
                                Số liệu đã thay đổi
                              </StatusBadge>
                            ) : null}
                          </span>
                        </td>
                        <td className="cell-number shifts-table__ondate">{num(shift.revenueOnDate)}</td>
                        <td className="cell-number shifts-table__shiftwide">{num(shift.revenue)}</td>
                        {dayView.continuesAfter ? (
                          <>
                            {pendingCash('Tiền đầu ca')}
                            {pendingCash('Tiền mặt dự kiến')}
                            {pendingCash('Tiền thực đếm')}
                            {pendingCash('Chênh lệch')}
                          </>
                        ) : (
                          <>
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
                          </>
                        )}
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="shift-form__hint">
          Hai cột doanh thu có thể khác nhau ngay cả khi ca không qua đêm: Doanh thu trong ngày là số tính lại từ phiếu hiện tại
          (không gồm phiếu không gắn tài khoản người dùng), còn Doanh thu cả ca của ca đã chốt là số đã lưu lúc chốt.
        </p>
      </section>

      <ShiftDetailDrawer
        shift={selected}
        date={date}
        canForceClose={selected ? canForceClose(selected.status, isAdmin, hasRight) : false}
        onClose={() => setSelectedId(null)}
      />
    </div>
  )
}
