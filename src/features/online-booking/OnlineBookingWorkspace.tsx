import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, Clock, XCircle } from '@phosphor-icons/react'
import {
  approveBooking,
  cancelBooking,
  getBoard,
  getBookingList,
  rejectBooking,
  type Booking,
} from '../../api/onlineBooking'
import {
  Button,
  ConfirmAction,
  DatePicker,
  InlineAlert,
  ListPagination,
  PageHeader,
  PollingStatus,
  Select,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { useWsStatusStore } from '../../store/wsStatus'
import { pushToast } from '../../store/toast'
import {
  CHANNEL_FILTER_OPTIONS,
  CHANNEL_LABEL,
  describeBookingError,
  describeFailCode,
  describePerson,
  formatCountdown,
  formatDateTime,
  formatMoney,
  formatTimeRange,
  OB_RIGHTS,
  PAY_METHOD_LABEL,
  payMethodOf,
  PC_STATE_LABEL,
  PC_STATE_TONE,
  SLOT_SOURCE_LABEL,
  STATUS_FILTER_OPTIONS,
  STATUS_LABEL,
  STATUS_TONE,
} from './onlineBookingModel'
import { StaffBookingDialog } from './StaffBookingDialog'
import './online-booking.css'

const PAGE_SIZE = 20

/** OB-R3: 2 kiểu huỷ — 'cancel' = huỷ, không hoàn; 'cancelCredit' = huỷ + cộng lại tài khoản chính. */
type PendingAction = { type: 'approve' | 'reject' | 'cancel' | 'cancelCredit'; booking: Booking } | null

function todayYMD(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function OnlineBookingWorkspace() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const connected = useWsStatusStore((state) => state.connected)
  const canApprove = hasRight(OB_RIGHTS.APPROVE)
  const canCancel = hasRight(OB_RIGHTS.CANCEL)

  const [date, setDate] = useState(() => todayYMD())
  const [status, setStatus] = useState('')
  const [pc, setPc] = useState('')
  const [channel, setChannel] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(0)
  const [staffDialogOpen, setStaffDialogOpen] = useState(false)
  const [action, setAction] = useState<PendingAction>(null)
  const [reason, setReason] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => setPage(0), [date, status, pc, channel, q])

  const boardQuery = useQuery({
    queryKey: ['onlinebook-board'],
    queryFn: () => getBoard({}),
    refetchInterval: connected ? 30_000 : 10_000,
  })

  const queueQuery = useQuery({
    queryKey: ['onlinebook-queue'],
    queryFn: () => getBookingList({ status: 'wait_approval', limit: 50 }),
    refetchInterval: connected ? 15_000 : 5_000,
  })

  const listQuery = useQuery({
    queryKey: ['onlinebook-list', { date, status, pc, channel, q, page }],
    queryFn: () =>
      getBookingList({
        date: date || undefined,
        status: (status || undefined) as Booking['status'] | undefined,
        pc: pc || undefined,
        channel: (channel || undefined) as Booking['channel'] | undefined,
        q: q || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    refetchInterval: connected ? 30_000 : 8_000,
  })

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['onlinebook-queue'] })
    void queryClient.invalidateQueries({ queryKey: ['onlinebook-list'] })
    void queryClient.invalidateQueries({ queryKey: ['onlinebook-board'] })
  }

  const closeAction = () => {
    setAction(null)
    setReason('')
    setActionError(null)
  }

  const approveMutation = useMutation({
    mutationFn: (booking: Booking) => approveBooking({ bookId: booking.bookId }),
    onSuccess: () => {
      pushToast('Đã duyệt đơn đặt máy.', 'success')
      invalidateAll()
      closeAction()
    },
    onError: (error) => setActionError(describeBookingError(error)),
  })

  const rejectMutation = useMutation({
    mutationFn: (vars: { booking: Booking; reason: string }) =>
      rejectBooking({ bookId: vars.booking.bookId, reason: vars.reason }),
    onSuccess: () => {
      pushToast('Đã từ chối đơn.', 'info')
      invalidateAll()
      closeAction()
    },
    onError: (error) => setActionError(describeBookingError(error)),
  })

  const cancelMutation = useMutation({
    mutationFn: (vars: { booking: Booking; reason: string; credit: boolean }) =>
      cancelBooking({ bookId: vars.booking.bookId, reason: vars.reason, credit: vars.credit }),
    onSuccess: (result, vars) => {
      if (vars.credit) {
        pushToast(
          `Đã huỷ đơn và cộng lại ${formatMoney(result.cancelCreditAmount ?? vars.booking.total)} vào tài khoản chính của hội viên.`,
          'success',
        )
      } else {
        pushToast('Đã huỷ đơn — hội viên không được hoàn tiền.', 'info')
      }
      invalidateAll()
      closeAction()
    },
    onError: (error) => {
      setActionError(describeBookingError(error))
      // Đơn có thể ĐÃ huỷ dù phần cộng lại còn đang làm (server tự làm tiếp) — làm mới danh sách.
      invalidateAll()
    },
  })

  const queueItems = queueQuery.data?.items ?? []
  const listItems = listQuery.data?.items ?? []
  const total = listQuery.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const pcOptions = useMemo(() => {
    const pcs = (boardQuery.data?.machines ?? []).map((m) => m.pc)
    return Array.from(new Set(pcs))
  }, [boardQuery.data])

  const isBusy = approveMutation.isPending || rejectMutation.isPending || cancelMutation.isPending

  const confirmLabel =
    action?.type === 'approve'
      ? 'Duyệt đơn'
      : action?.type === 'reject'
        ? 'Từ chối đơn'
        : action?.type === 'cancelCredit'
          ? 'Huỷ + cộng lại tài khoản chính'
          : 'Huỷ, không hoàn'
  const confirmTitle =
    action?.type === 'approve'
      ? `Duyệt đơn ${action.booking.bookCode}?`
      : action?.type === 'reject'
        ? `Từ chối đơn ${action?.booking.bookCode}?`
        : action?.type === 'cancelCredit'
          ? `Huỷ đơn ${action.booking.bookCode} và cộng lại tiền?`
          : `Huỷ đơn ${action?.booking.bookCode}, không hoàn tiền?`

  const actionIsQr = action ? payMethodOf(action.booking) === 'qr' : false
  const actionMoney = action ? formatMoney(action.booking.total) : ''
  const confirmDescription =
    action?.type === 'cancel'
      ? 'Hội viên sẽ KHÔNG được hoàn tiền. Khung giờ sẽ trở về trống ngay sau khi huỷ.'
      : action?.type === 'cancelCredit'
        ? `Cộng lại đúng ${actionMoney} vào tài khoản chính của hội viên ${action.booking.member.username} (không trả tiền mặt, không chuyển khoản). Mỗi đơn chỉ cộng lại một lần. Khung giờ sẽ trở về trống ngay sau khi huỷ.`
        : action?.type === 'approve'
          ? actionIsQr
            ? `Tiền QR ${actionMoney} đã nạp vào ví hội viên lúc đặt. Duyệt sẽ trừ ${actionMoney} từ ví nếu máy vẫn còn tắt và còn trống.`
            : `Hệ thống sẽ trừ ${actionMoney} từ ví hội viên nếu máy vẫn còn tắt và còn trống.`
          : action?.type === 'reject' && actionIsQr
            ? `Tiền QR ${actionMoney} đã nạp vào ví hội viên sẽ nằm lại trong ví (không bị trừ).`
            : undefined

  const needsReason = action?.type === 'reject' || action?.type === 'cancel' || action?.type === 'cancelCredit'

  return (
    <section className="ob-workspace">
      <PageHeader
        eyebrow="Đặt máy online"
        title="Quản lý đặt máy"
        description="Hàng chờ duyệt, theo dõi khách đến/không đến, đặt hộ và huỷ đơn."
        actions={
          <Button
            type="button"
            variant="primary"
            disabled={!canApprove}
            title={canApprove ? undefined : `Cần quyền Đặt hộ / Duyệt (${OB_RIGHTS.APPROVE})`}
            onClick={() => setStaffDialogOpen(true)}
          >
            Đặt hộ
          </Button>
        }
      />

      <section className="ob-queue">
        <header className="ob-queue__header">
          <Clock size={20} weight="duotone" aria-hidden="true" />
          <strong>Hàng chờ duyệt</strong>
          <StatusBadge tone={queueItems.length > 0 ? 'warning' : 'neutral'}>{queueItems.length} đơn</StatusBadge>
        </header>
        {queueQuery.isLoading ? (
          <StateView title="Đang tải hàng chờ duyệt…" />
        ) : queueItems.length === 0 ? (
          <StateView title="Không có đơn chờ duyệt" />
        ) : (
          <div className="ob-queue__list">
            {queueItems.map((booking) => {
              const countdown = formatCountdown(booking.approvalDeadline, now)
              return (
                <article key={booking.bookId} className="ob-queue__card">
                  <div className="ob-queue__main">
                    <div className="ob-queue__code">
                      <strong>{booking.bookCode}</strong>
                      <span>{CHANNEL_LABEL[booking.channel]}</span>
                    </div>
                    <div className="ob-queue__detail">
                      <span>Hội viên: {booking.member.username}</span>
                      <span>
                        Máy {booking.pc} · {booking.machineGroup} ·{' '}
                        <StatusBadge tone={PC_STATE_TONE[booking.pcState]}>{PC_STATE_LABEL[booking.pcState]}</StatusBadge>
                      </span>
                      <span>{formatTimeRange(booking.from, booking.to)}</span>
                      <span>
                        Tổng {formatMoney(booking.total)} · Thanh toán: {PAY_METHOD_LABEL[payMethodOf(booking)]}
                      </span>
                    </div>
                  </div>
                  <div className="ob-queue__side">
                    <span className={`ob-queue__countdown${countdown.expired ? ' is-expired' : ''}`}>
                      {countdown.expired ? 'Đã hết hạn duyệt' : `Hết hạn sau ${countdown.label}`}
                    </span>
                    <div className="ob-queue__actions">
                      <Button
                        type="button"
                        variant="primary"
                        icon={<CheckCircle size={18} weight="bold" aria-hidden="true" />}
                        disabled={!canApprove}
                        title={canApprove ? undefined : `Cần quyền Duyệt (${OB_RIGHTS.APPROVE})`}
                        onClick={() => setAction({ type: 'approve', booking })}
                      >
                        Duyệt
                      </Button>
                      <Button
                        type="button"
                        variant="danger-outline"
                        icon={<XCircle size={18} weight="bold" aria-hidden="true" />}
                        disabled={!canApprove}
                        title={canApprove ? undefined : `Cần quyền Duyệt (${OB_RIGHTS.APPROVE})`}
                        onClick={() => setAction({ type: 'reject', booking })}
                      >
                        Từ chối
                      </Button>
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </section>

      <section className="ob-filters">
        <label className="ds-field">
          <span className="ds-field__label">Ngày</span>
          <DatePicker value={date} onChange={setDate} aria-label="Lọc theo ngày" />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Trạng thái</span>
          <Select value={status} aria-label="Lọc theo trạng thái" onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Máy</span>
          <Select value={pc} aria-label="Lọc theo máy" onChange={(e) => setPc(e.target.value)}>
            <option value="">Tất cả máy</option>
            {pcOptions.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </Select>
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Kênh</span>
          <Select value={channel} aria-label="Lọc theo kênh" onChange={(e) => setChannel(e.target.value)}>
            {CHANNEL_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="ds-field ob-filters__search">
          <span className="ds-field__label">Tìm mã đơn / hội viên</span>
          <input className="ds-input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="DM7K3QX hoặc username" />
        </label>
      </section>

      <section className="ob-list">
        <header className="ob-list__header">
          <strong>Danh sách đơn</strong>
          <PollingStatus
            connected={connected}
            isError={listQuery.isError}
            isFetching={listQuery.isFetching}
            dataUpdatedAt={listQuery.dataUpdatedAt}
            intervalMs={connected ? 30_000 : 8_000}
            onRefresh={() => void listQuery.refetch()}
          />
        </header>

        {listQuery.isLoading ? (
          <StateView title="Đang tải danh sách đơn…" />
        ) : listQuery.isError ? (
          <StateView
            title="Không tải được danh sách đơn"
            description={describeBookingError(listQuery.error)}
            action={
              <Button type="button" onClick={() => void listQuery.refetch()}>
                Thử lại
              </Button>
            }
          />
        ) : listItems.length === 0 ? (
          <StateView title="Không có đơn phù hợp bộ lọc" />
        ) : (
          <div className="ob-table-wrap">
            <table className="ob-table">
              <thead>
                <tr>
                  <th>Mã đơn</th>
                  <th>Giờ tạo</th>
                  <th>Hội viên</th>
                  <th>Máy</th>
                  <th>Từ – đến</th>
                  <th>Tổng</th>
                  <th>Trạng thái</th>
                  <th>Khách vào máy</th>
                  <th>Người duyệt / đặt hộ</th>
                  <th>Người huỷ / lý do</th>
                  <th>Hành động</th>
                </tr>
              </thead>
              <tbody>
                {listItems.map((booking) => (
                  <tr key={booking.bookId}>
                    <td>
                      <strong>{booking.bookCode}</strong>
                      <div className="ob-table__sub">{CHANNEL_LABEL[booking.channel]}</div>
                    </td>
                    <td>{formatDateTime(booking.createdAt)}</td>
                    <td>{booking.member.username}</td>
                    <td>
                      {booking.pc}
                      <div className="ob-table__sub">{booking.machineGroup}</div>
                    </td>
                    <td>{formatTimeRange(booking.from, booking.to)}</td>
                    <td>
                      {formatMoney(booking.total)}
                      <div className="ob-table__sub">Thanh toán: {PAY_METHOD_LABEL[payMethodOf(booking)]}</div>
                    </td>
                    <td>
                      <StatusBadge tone={STATUS_TONE[booking.status]}>{STATUS_LABEL[booking.status]}</StatusBadge>
                      {booking.status === 'rejected' && booking.failCode ? (
                        <div className="ob-table__sub">{describeFailCode(booking.failCode)}</div>
                      ) : null}
                    </td>
                    <td>{formatDateTime(booking.loginAt)}</td>
                    <td>
                      {booking.channel === 'staff' ? `Đặt hộ: ${describePerson(booking.createdBy)}` : null}
                      {booking.approvedBy ? (
                        <div className="ob-table__sub">Duyệt: {describePerson(booking.approvedBy)}</div>
                      ) : null}
                      {booking.channel !== 'staff' && !booking.approvedBy ? '—' : null}
                    </td>
                    <td>
                      {booking.cancelledBy ? (
                        <>
                          {describePerson(booking.cancelledBy)}
                          <div className="ob-table__sub">{booking.cancelReason}</div>
                          {booking.cancelCredit === 'credited' ? (
                            <StatusBadge tone="success">
                              Đã cộng lại {formatMoney(booking.cancelCreditAmount ?? booking.total)}
                            </StatusBadge>
                          ) : booking.cancelCredit === 'pending' ? (
                            <StatusBadge tone="warning">Đang cộng lại tài khoản chính</StatusBadge>
                          ) : booking.status === 'cancelled' ? (
                            <div className="ob-table__sub">Không hoàn tiền</div>
                          ) : null}
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>
                      {booking.status === 'confirmed' ? (
                        <div className="ob-queue__actions">
                          <Button
                            type="button"
                            variant="danger-outline"
                            disabled={!canCancel}
                            title={canCancel ? undefined : `Cần quyền Huỷ đơn (${OB_RIGHTS.CANCEL})`}
                            onClick={() => setAction({ type: 'cancel', booking })}
                          >
                            Huỷ, không hoàn
                          </Button>
                          <Button
                            type="button"
                            variant="warning-outline"
                            disabled={!canCancel}
                            title={canCancel ? undefined : `Cần quyền Huỷ đơn (${OB_RIGHTS.CANCEL})`}
                            onClick={() => setAction({ type: 'cancelCredit', booking })}
                          >
                            Huỷ + cộng lại tài khoản chính
                          </Button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ListPagination
          page={page}
          totalPages={totalPages}
          canNext={page + 1 < totalPages}
          onPrevious={() => setPage((p) => Math.max(0, p - 1))}
          onNext={() => setPage((p) => p + 1)}
        />
      </section>

      <section className="ob-calendar">
        <header>
          <strong>Lịch theo máy</strong>
          <span>Khung giờ đã đặt trong cửa sổ {boardQuery.data ? formatTimeRange(boardQuery.data.horizon.from, boardQuery.data.horizon.to) : '—'}</span>
        </header>
        {boardQuery.isLoading ? (
          <StateView title="Đang tải lịch máy…" />
        ) : (
          <div className="ob-table-wrap">
            <table className="ob-table">
              <thead>
                <tr>
                  <th>Máy</th>
                  <th>Trạng thái hiện tại</th>
                  <th>Khung đã đặt</th>
                </tr>
              </thead>
              <tbody>
                {(boardQuery.data?.machines ?? []).map((m) => (
                  <tr key={m.pc}>
                    <td>
                      {m.pc}
                      <div className="ob-table__sub">{m.machineGroup}</div>
                    </td>
                    <td>
                      <StatusBadge tone={PC_STATE_TONE[m.pcState]}>{PC_STATE_LABEL[m.pcState]}</StatusBadge>
                    </td>
                    <td>
                      {m.bookedSlots.length === 0 ? (
                        <span className="ob-table__sub">Trống</span>
                      ) : (
                        <div className="ob-calendar__slots">
                          {m.bookedSlots.map((slot, index) => (
                            <span key={index} className={`ob-calendar__slot ob-calendar__slot--${slot.source}`}>
                              {formatTimeRange(slot.from, slot.to)} · {SLOT_SOURCE_LABEL[slot.source]}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <StaffBookingDialog
        open={staffDialogOpen}
        board={boardQuery.data}
        onClose={() => setStaffDialogOpen(false)}
        onCreated={() => {
          pushToast('Đã tạo đơn đặt hộ.', 'success')
          invalidateAll()
        }}
      />

      <ConfirmAction
        open={Boolean(action)}
        title={confirmTitle}
        description={confirmDescription}
        confirmLabel={confirmLabel}
        danger={action?.type !== 'approve'}
        pending={isBusy}
        confirmDisabled={needsReason && reason.trim().length === 0}
        onCancel={closeAction}
        onConfirm={() => {
          if (!action) return
          if (action.type === 'approve') approveMutation.mutate(action.booking)
          else if (action.type === 'reject') rejectMutation.mutate({ booking: action.booking, reason: reason.trim() })
          else
            cancelMutation.mutate({
              booking: action.booking,
              reason: reason.trim(),
              credit: action.type === 'cancelCredit',
            })
        }}
      >
        {needsReason ? (
          <label className="ds-field">
            <span className="ds-field__label">Lý do (bắt buộc)</span>
            <textarea
              className="ds-textarea"
              rows={3}
              maxLength={255}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              autoFocus
            />
          </label>
        ) : null}
        {actionError ? <InlineAlert tone="danger">{actionError}</InlineAlert> : null}
      </ConfirmAction>
    </section>
  )
}
