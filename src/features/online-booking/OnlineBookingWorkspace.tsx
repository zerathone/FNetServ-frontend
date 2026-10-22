import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, HandCoins, MagnifyingGlass, QrCode, Stack, XCircle } from '@phosphor-icons/react'
import {
  approveBooking,
  cancelBooking,
  getBoard,
  getBookingList,
  getOnlineBookConfig,
  rejectBooking,
  type Booking,
} from '../../api/onlineBooking'
import {
  Button,
  ConfirmAction,
  DateRangePicker,
  InlineAlert,
  ListPagination,
  PageHeader,
  PollingStatus,
  Select,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useAuthStore } from '../../store/auth'
import { useRevenuePrefs } from '../../store/revenuePrefs'
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
  formatBookingRange,
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
// Thẻ đơn + thẻ thống kê dùng chung kiểu với trang Đơn dịch vụ (order-card / order-summary).
import '../orders/orders.css'
import './online-booking.css'

const PAGE_SIZE = 20

/** OB-R3: 2 kiểu huỷ — 'cancel' = huỷ, không hoàn; 'cancelCredit' = huỷ + cộng lại tài khoản chính. */
type PendingAction = { type: 'approve' | 'reject' | 'cancel' | 'cancelCredit'; booking: Booking } | null

function todayYMD(): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

type SearchField = 'member' | 'code' | 'pc'
const SEARCH_PLACEHOLDER: Record<SearchField, string> = {
  member: 'Nhập tên đăng nhập hội viên',
  code: 'Nhập mã đơn, vd DM7K3QX',
  pc: 'Nhập hoặc chọn tên máy',
}
const PC_LIST_ID = 'ob-pc-options'

/** Cách trả tiền hiện trên thẻ Doanh thu (không có tiền mặt). `iconClass` = màu icon nền của orders.css. */
const REVENUE_METHODS: Array<{ key: 'qr' | 'wallet'; Icon: typeof QrCode; iconClass: string }> = [
  { key: 'qr', Icon: QrCode, iconClass: 'qr' },
  { key: 'wallet', Icon: HandCoins, iconClass: 'deduct' },
]

/** Trạng thái thống kê trên thẻ tổng quan (ngoài Chờ duyệt / Đã duyệt). allDates: đếm mọi ngày, ngược lại chỉ hôm nay. */
const STAT_STATUSES: Array<{ key: 'in_use' | 'done' | 'no_show' | 'cancelled' | 'rejected'; label: string; allDates: boolean }> = [
  { key: 'in_use', label: 'Đang dùng', allDates: true },
  { key: 'done', label: 'Đã dùng xong', allDates: false },
  { key: 'no_show', label: 'Không đến', allDates: false },
  { key: 'cancelled', label: 'Đã huỷ', allDates: false },
  { key: 'rejected', label: 'Từ chối / hết hạn', allDates: false },
]

export function OnlineBookingWorkspace() {
  const queryClient = useQueryClient()
  const hasRight = useAuthStore((state) => state.hasRight)
  const connected = useWsStatusStore((state) => state.connected)
  const canApprove = hasRight(OB_RIGHTS.APPROVE)
  const canCancel = hasRight(OB_RIGHTS.CANCEL)

  const [fromDate, setFromDate] = useState(() => todayYMD())
  const [toDate, setToDate] = useState(() => todayYMD())
  const [status, setStatus] = useState('')
  const [channel, setChannel] = useState('')
  // Một ô tìm kiếm gộp [combo chọn trường][ô nhập]: mã đơn / hội viên → tham số `q` của server (khớp một phần),
  // máy → tham số `pc` (khớp đúng tên máy, không phân biệt hoa thường; có gợi ý tên máy).
  const [searchField, setSearchField] = useState<SearchField>('member')
  const [searchText, setSearchText] = useState('')
  const keyword = searchText.trim()
  const pc = searchField === 'pc' ? keyword : ''
  const q = searchField === 'pc' ? '' : keyword
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

  useEffect(() => setPage(0), [fromDate, toDate, status, pc, channel, q])

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

  // Chế độ duyệt (approval_mode 0 = tự động). /onlinebook/config chỉ dành cho admin: tài khoản không phải admin
  // nhận lỗi → coi như duyệt thủ công (không hiện AUTO), không báo lỗi lên trang.
  const configQuery = useQuery({
    queryKey: ['onlinebook-config'],
    queryFn: getOnlineBookConfig,
    retry: false,
    staleTime: 60_000,
  })
  const autoApprove = configQuery.data?.setting.approval_mode === 0

  // Đơn đã duyệt, đang chờ khách đến nhận máy (mọi ngày) — cho thẻ thống kê "Đã duyệt".
  const confirmedQuery = useQuery({
    queryKey: ['onlinebook-confirmed'],
    queryFn: () => getBookingList({ status: 'confirmed', limit: 50 }),
    refetchInterval: connected ? 30_000 : 10_000,
  })

  // Thống kê các trạng thái kế tiếp: lấy `total` cho số đếm + tối đa 200 đơn (giới hạn của server) để cộng doanh thu.
  const today = todayYMD()
  const statQueries = useQueries({
    queries: STAT_STATUSES.map((stat) => ({
      queryKey: ['onlinebook-stat', stat.key, stat.allDates ? 'all' : today],
      queryFn: () => getBookingList({ status: stat.key, date: stat.allDates ? undefined : today, limit: 200 }),
      refetchInterval: connected ? 30_000 : 10_000,
    })),
  })
  const statData = (key: (typeof STAT_STATUSES)[number]['key']) =>
    statQueries[STAT_STATUSES.findIndex((s) => s.key === key)]?.data

  // Doanh thu hôm nay = đơn đã bị trừ tiền và KHÔNG hoàn: Đã duyệt, Đang dùng, Đã dùng xong, Không đến, và Đã huỷ
  // không hoàn (huỷ có cộng lại tài khoản chính — đã cộng hoặc đang cộng — thì tiền trả về nên không tính).
  // Từ chối / hết hạn chưa từng trừ tiền nên không tính.
  const isToday = (b: Booking) => b.from.slice(0, 10) === today
  const paidBookings: Booking[] = [
    ...(confirmedQuery.data?.items ?? []).filter(isToday),
    ...(statData('in_use')?.items ?? []).filter(isToday),
    ...(statData('done')?.items ?? []),
    ...(statData('no_show')?.items ?? []),
    ...(statData('cancelled')?.items ?? []).filter((b) => b.cancelCredit !== 'credited' && b.cancelCredit !== 'pending'),
  ]
  // Ô tròn ở góc ô "Cấn trừ": bỏ chọn = tiền cấn trừ (trừ vào số dư ví, không phải tiền thu mới) không tính vào doanh thu.
  const deductInRevenue = useRevenuePrefs((state) => state.deductInRevenue)
  const setDeductInRevenue = useRevenuePrefs((state) => state.setDeductInRevenue)
  const revenueBookings = deductInRevenue ? paidBookings : paidBookings.filter((b) => payMethodOf(b) !== 'wallet')
  const revenue = revenueBookings.reduce((sum, b) => sum + b.total, 0)
  // Server chỉ trả tối đa 200 đơn / lần (đơn chờ duyệt xác nhận 50): nếu còn nhiều hơn thì tiền bị thiếu → hiện "≥".
  const revenueTruncated =
    (confirmedQuery.data ? confirmedQuery.data.total > confirmedQuery.data.items.length : false) ||
    (['in_use', 'done', 'no_show', 'cancelled'] as const).some((key) => {
      const data = statData(key)
      return data ? data.total > data.items.length : false
    })
  const formatRevenue = (amount: number) => (revenueTruncated ? `≥ ${formatMoney(amount)}` : formatMoney(amount))

  const listQuery = useQuery({
    queryKey: ['onlinebook-list', { fromDate, toDate, status, pc, channel, q, page }],
    queryFn: () =>
      getBookingList({
        fromDate: fromDate || undefined,
        toDate: toDate || undefined,
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
    void queryClient.invalidateQueries({ queryKey: ['onlinebook-confirmed'] })
    void queryClient.invalidateQueries({ queryKey: ['onlinebook-stat'] })
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
  // Số đếm lấy `total` của server; tiền chỉ cộng các đơn đã tải (tối đa 50 đơn mỗi loại).
  const waitCount = queueQuery.data?.total ?? 0
  const waitAmount = queueItems.reduce((sum, b) => sum + b.total, 0)
  const confirmedCount = confirmedQuery.data?.total ?? 0
  const confirmedAmount = (confirmedQuery.data?.items ?? []).reduce((sum, b) => sum + b.total, 0)

  // Bấm thẻ thống kê = lọc danh sách đơn theo trạng thái đó. Đơn chờ/đã duyệt có thể thuộc ngày khác nên bỏ lọc ngày;
  // bấm thẻ tổng thì về mặc định (mọi trạng thái, hôm nay).
  // Các trạng thái kế tiếp (đang dùng / xong / không đến / huỷ / từ chối): đếm đơn HÔM NAY (đang dùng: mọi ngày) nên
  // bấm vào thì lọc đúng khoảng ngày đó để số trên thẻ khớp với danh sách.
  const showStatus = (next: string) => {
    setStatus(next)
    const stat = STAT_STATUSES.find((s) => s.key === next)
    const d = next === '' || (stat && !stat.allDates) ? todayYMD() : ''
    setFromDate(d)
    setToDate(d)
  }

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
          ? 'Hủy (cộng lại tk chính)'
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

  const renderBookingCard = (booking: Booking) => {
    const countdown = formatCountdown(booking.approvalDeadline, now)
    const waiting = booking.status === 'wait_approval'
    const range = formatBookingRange(booking.from, booking.to)
    // Icon cách trả tiền (cùng icon với ô QR / Cấn trừ trên thẻ Doanh thu).
    const payMethod = payMethodOf(booking)
    const PayIcon = REVENUE_METHODS.find((m) => m.key === payMethod)?.Icon ?? HandCoins
    // Tên kênh (FZone / Thu ngân) tô sáng; tên nhân viên đi kèm giữ màu thường.
    const channelLine = (
      <>
        <b className="ob-bcard__channel">{CHANNEL_LABEL[booking.channel]}</b>
        {booking.channel === 'staff' && booking.createdBy ? `: ${describePerson(booking.createdBy)}` : ''}
      </>
    )
    return (
      <article key={booking.bookId} className="order-card ob-bcard">
        <div className="order-card__identity">
          <div className="ob-bcard__machine">
            <strong>{booking.pc}</strong>
            <span className="ob-bcard__group">{booking.machineGroup}</span>
            <StatusBadge tone={PC_STATE_TONE[booking.pcState]}>{PC_STATE_LABEL[booking.pcState]}</StatusBadge>
          </div>
          <span className="order-card__username">{booking.member.username}</span>
          <div className="order-card__meta-row">
            <span className="order-card__voucher-id">#{booking.bookCode}</span>
            {waiting ? (
              <StatusBadge tone={countdown.expired ? 'danger' : 'warning'}>
                {countdown.expired ? 'Đã hết hạn duyệt' : `Hết hạn sau ${countdown.label}`}
              </StatusBadge>
            ) : (
              <StatusBadge tone={STATUS_TONE[booking.status]}>{STATUS_LABEL[booking.status]}</StatusBadge>
            )}
          </div>
        </div>
        <div className="order-card__items">
          <div className="order-card__line">
            <div className="order-card__line-main">
              <strong>
                {range ? (
                  <>
                    <span className="ob-bcard__day">{range.fromDay}</span> {range.fromTime} →{' '}
                    {range.toDay ? <span className="ob-bcard__day">{range.toDay} </span> : null}
                    {range.toTime}
                  </>
                ) : (
                  '—'
                )}
              </strong>
            </div>
            <div className="order-card__line-qty">
              <span className="order-card__line-qty-value">{booking.minutes} phút</span>
              <span>
                {formatMoney(booking.pricePerHour)}/giờ{booking.fee > 0 ? ` + phí ${formatMoney(booking.fee)}` : ''}
              </span>
            </div>
          </div>
          <div className="ob-bcard__log">
            <span>
              Tạo {formatDateTime(booking.createdAt)} · {channelLine}
            </span>
            {booking.approvedBy ? <span>Duyệt: {describePerson(booking.approvedBy)}</span> : null}
            {booking.loginAt ? <span>Khách vào máy: {formatDateTime(booking.loginAt)}</span> : null}
            {booking.status === 'rejected' && booking.failCode ? <span>{describeFailCode(booking.failCode)}</span> : null}
            {booking.cancelledBy ? (
              <span>
                Huỷ: {describePerson(booking.cancelledBy)}
                {booking.cancelReason ? ` — ${booking.cancelReason}` : ''}
              </span>
            ) : null}
            {booking.cancelCredit === 'credited' ? (
              <StatusBadge tone="success">
                Đã cộng lại {formatMoney(booking.cancelCreditAmount ?? booking.total)}
              </StatusBadge>
            ) : booking.cancelCredit === 'pending' ? (
              <StatusBadge tone="warning">Đang cộng lại tài khoản chính</StatusBadge>
            ) : booking.cancelCredit === 'failed' ? (
              <StatusBadge tone="danger">Cộng lại lỗi — cần đối soát</StatusBadge>
            ) : booking.status === 'cancelled' ? (
              <span>Không hoàn tiền</span>
            ) : null}
          </div>
        </div>
        <div className="order-card__total">
          <span>Tổng</span>
          <strong>{formatMoney(booking.total)}</strong>
          <StatusBadge tone={payMethod === 'qr' ? 'warning' : 'info'}>
            <span className="ob-bcard__pay">
              <PayIcon size={14} weight="fill" aria-hidden="true" />
              {PAY_METHOD_LABEL[payMethod]}
            </span>
          </StatusBadge>
        </div>
        <div className="order-card__actions">
          {waiting ? (
            <>
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
            </>
          ) : null}
          {booking.status === 'confirmed' ? (
            <>
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
                Hủy (cộng lại tk chính)
              </Button>
            </>
          ) : null}
        </div>
      </article>
    )
  }

  return (
    <section className="ob-workspace">
      <PageHeader
        eyebrow="Đặt máy online"
        title="Quản lý đặt máy"
        description="Duyệt đơn, theo dõi khách đến/không đến, đặt máy và huỷ đơn."
        actions={
          <>
            <Button
              type="button"
              variant="primary"
              disabled={!canApprove}
              title={canApprove ? undefined : `Cần quyền Đặt hộ / Duyệt (${OB_RIGHTS.APPROVE})`}
              onClick={() => setStaffDialogOpen(true)}
            >
              Đặt máy
            </Button>
            <PollingStatus
              connected={connected}
              isError={queueQuery.isError || listQuery.isError}
              isFetching={queueQuery.isFetching || confirmedQuery.isFetching || listQuery.isFetching}
              dataUpdatedAt={queueQuery.dataUpdatedAt}
              intervalMs={connected ? 15_000 : 5_000}
              onRefresh={() => {
                void queueQuery.refetch()
                void confirmedQuery.refetch()
                statQueries.forEach((query) => void query.refetch())
                void listQuery.refetch()
              }}
            />
          </>
        }
      />

      <div className="order-summary" aria-label="Tổng quan đơn đặt máy">
        {/* Doanh thu hôm nay (kiểu thẻ "Doanh thu" của trang Đơn dịch vụ, không có tiền mặt) + đơn không thành. */}
        <div className="order-summary__card order-summary__card--completed">
          <div
            className="order-summary__total order-summary__total--completed ob-rev__static"
            title={`Tổng tiền các đơn hôm nay đã trừ tiền và không hoàn: Đã duyệt, Đang dùng, Đã dùng xong, Không đến và Đã huỷ không hoàn.${
              deductInRevenue ? '' : ' Không gồm cấn trừ.'
            }`}
          >
            <CheckCircle className="order-summary__total-icon" size={28} weight="fill" aria-hidden="true" />
            <div className="order-summary__total-completed-text">
              <span className="order-summary__total-label">Doanh thu</span>
              <strong className="order-summary__total-amount">{formatRevenue(revenue)}</strong>
              <small className="order-summary__total-count">{revenueBookings.length} đơn</small>
              <small className="order-summary__total-count">Hôm nay</small>
            </div>
          </div>
          <div className="order-summary__breakdown">
            {REVENUE_METHODS.map((method, index) => {
              const rows = paidBookings.filter((b) => payMethodOf(b) === method.key)
              const MethodIcon = method.Icon
              const isDeduct = method.key === 'wallet'
              const excluded = isDeduct && !deductInRevenue
              return (
                <Fragment key={method.key}>
                  {/* Bỏ check cấn trừ chỉ đổi màu số tiền (is-excluded) — giữ nguyên bố cục để ô không bị xê dịch. */}
                  {index > 0 ? (
                    <span className="order-summary__breakdown-divider" aria-hidden="true">
                      |
                    </span>
                  ) : null}
                  <div
                    className={`order-summary__row order-summary__row--static order-summary__completed-method ob-rev__method${
                      excluded ? ' is-excluded' : ''
                    }`}
                  >
                    {isDeduct ? (
                      <input
                        type="checkbox"
                        className="ob-rev__toggle"
                        checked={deductInRevenue}
                        aria-label="Tính cấn trừ vào doanh thu"
                        title={deductInRevenue ? 'Đang tính cấn trừ vào doanh thu — bấm để bỏ' : 'Không tính cấn trừ vào doanh thu — bấm để tính'}
                        onChange={(event) => setDeductInRevenue(event.target.checked)}
                      />
                    ) : null}
                    <span className="order-summary__row-label-line">
                      <span className="order-summary__label">{PAY_METHOD_LABEL[method.key]}</span>
                    </span>
                    <strong className="order-summary__row-amount">
                      {formatRevenue(rows.reduce((sum, b) => sum + b.total, 0))}
                    </strong>
                    <small className="order-summary__row-count">{rows.length} đơn</small>
                    <MethodIcon
                      className={`order-summary__row-icon-bg order-summary__row-icon-bg--${method.iconClass}`}
                      size={30}
                      weight="fill"
                      aria-hidden="true"
                    />
                  </div>
                </Fragment>
              )
            })}
            {STAT_STATUSES.map((stat, index) =>
              stat.key === 'cancelled' || stat.key === 'rejected' ? (
                <button
                  key={stat.key}
                  type="button"
                  className={`order-summary__row order-summary__completed-method ob-sum ob-sum--${stat.key} ${status === stat.key ? 'is-active' : ''}`}
                  onClick={() => showStatus(stat.key)}
                  title={`${STATUS_LABEL[stat.key]} — đơn hôm nay`}
                >
                  <span className="order-summary__row-label-line">
                    <span className={`order-summary__dot ob-sum__dot--${stat.key}`} aria-hidden="true" />
                    <span className="order-summary__label">{stat.label}</span>
                  </span>
                  <strong className="order-summary__row-amount order-summary__row-amount--neutral">
                    {statQueries[index]?.data?.total ?? 0} đơn
                  </strong>
                </button>
              ) : null,
            )}
          </div>
        </div>

        <div className="order-summary__card">
          <button
            type="button"
            className={`order-summary__total ${status === '' ? 'is-active' : ''}`}
            title="Bỏ lọc trạng thái, xem tất cả đơn hôm nay"
            onClick={() => showStatus('')}
          >
            <Stack className="order-summary__total-icon--pending" size={28} weight="fill" aria-hidden="true" />
            <div className="order-summary__total__text">
              <span>Đơn đang xử lý</span>
              <small className="order-summary__hint order-summary__total-hint">
                {formatMoney(waitAmount + confirmedAmount)}
              </small>
            </div>
            <strong>{waitCount + confirmedCount}</strong>
          </button>
          <div className="order-summary__breakdown">
            <button
              type="button"
              className={`order-summary__row ob-sum ob-sum--wait ${status === 'wait_approval' ? 'is-active' : ''}`}
              onClick={() => showStatus('wait_approval')}
            >
              <span className="order-summary__dot ob-sum__dot--wait" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">
                  {autoApprove ? 'Duyệt' : 'Chờ duyệt'}
                  {autoApprove ? (
                    <StatusBadge tone="info" title="Đang bật tự động duyệt đơn đặt máy">
                      AUTO
                    </StatusBadge>
                  ) : null}
                </span>
                <small className="order-summary__hint">{formatMoney(waitAmount)}</small>
              </span>
              <strong>{waitCount}</strong>
            </button>
            <button
              type="button"
              className={`order-summary__row ob-sum ob-sum--confirmed ${status === 'confirmed' ? 'is-active' : ''}`}
              onClick={() => showStatus('confirmed')}
              title="Đơn đã duyệt, đang chờ khách đến nhận máy"
            >
              <span className="order-summary__dot ob-sum__dot--confirmed" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Đã duyệt</span>
                <small className="order-summary__hint">
                  {formatMoney(confirmedAmount)}
                  <span className="order-summary__hint--muted"> · chờ khách đến</span>
                </small>
              </span>
              <strong>{confirmedCount}</strong>
            </button>
            {/* Đã huỷ / Từ chối nằm ở thẻ Doanh thu phía trên (đơn không thành). */}
            {STAT_STATUSES.map((stat, index) =>
              stat.key === 'cancelled' || stat.key === 'rejected' ? null : (
                <button
                  key={stat.key}
                  type="button"
                  className={`order-summary__row ob-sum ob-sum--${stat.key} ${status === stat.key ? 'is-active' : ''}`}
                  onClick={() => showStatus(stat.key)}
                  title={stat.allDates ? `${STATUS_LABEL[stat.key]} (mọi ngày)` : `${STATUS_LABEL[stat.key]} — đơn hôm nay`}
                >
                  <span className={`order-summary__dot ob-sum__dot--${stat.key}`} aria-hidden="true" />
                  <span className="order-summary__row-text">
                    <span className="order-summary__label">{stat.label}</span>
                    <small className="order-summary__hint">{stat.allDates ? 'hiện tại' : 'hôm nay'}</small>
                  </span>
                  <strong>{statQueries[index]?.data?.total ?? 0}</strong>
                </button>
              ),
            )}
          </div>
        </div>
      </div>

      <section className="ob-filters">
        <DateRangePicker
          className="ob-filter"
          fromDate={fromDate}
          toDate={toDate}
          onFromDateChange={setFromDate}
          onToDateChange={setToDate}
          label="Lọc theo khoảng ngày"
        />
        <div className="ds-input-group ob-filter">
          <span className="ds-input-group-separator">Trạng thái</span>
          <Select value={status} aria-label="Lọc theo trạng thái" onChange={(e) => setStatus(e.target.value)}>
            {STATUS_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="ds-input-group ob-filter">
          <span className="ds-input-group-separator">Kênh</span>
          <Select value={channel} aria-label="Lọc theo kênh" onChange={(e) => setChannel(e.target.value)}>
            {CHANNEL_FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="ob-filters__search">
          <div className="ds-input-group ds-input-group--search">
            <Select
              value={searchField}
              aria-label="Tìm theo"
              onChange={(event) => setSearchField(event.target.value as SearchField)}
            >
              <option value="member">Hội viên</option>
              <option value="code">Mã đơn</option>
              <option value="pc">Máy</option>
            </Select>
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                list={searchField === 'pc' ? PC_LIST_ID : undefined}
                placeholder={SEARCH_PLACEHOLDER[searchField]}
                value={searchText}
                onChange={(event) => setSearchText(event.target.value)}
              />
              {searchText ? (
                <button
                  type="button"
                  className="ds-search-input__clear"
                  aria-label="Xóa từ khóa tìm kiếm"
                  title="Xóa từ khóa"
                  onClick={() => setSearchText('')}
                >
                  <XCircle size={17} weight="fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <datalist id={PC_LIST_ID}>
            {pcOptions.map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </div>
      </section>

      <section className="ob-section">
        <header className="ob-queue__header">
          <strong>Danh sách đơn</strong>
          <StatusBadge tone="neutral">{total} đơn</StatusBadge>
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
          <p className="order-empty-compact">Không có đơn phù hợp bộ lọc.</p>
        ) : (
          <div className="order-list">{listItems.map(renderBookingCard)}</div>
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
          pushToast('Đã tạo đơn đặt máy.', 'success')
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
