import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowsClockwise,
  Bell,
  Check,
  Checks,
  CheckCircle,
  GearSix,
  ArrowSquareOut,
  MagnifyingGlass,
  X,
} from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import {
  cancelQrOrder,
  confirmQrManual,
  getOperationNotificationSnapshot,
  OPERATIONS_NOTIFICATIONS_QUERY_KEY,
  updateOperationNotificationState,
  type OperationNotification,
} from '../../api/notifications'
import {
  Button,
  ConfirmAction,
  Drawer,
  InlineAlert,
  Select,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useOrderQueueStore } from '../../store/orderQueue'
import { pushToast } from '../../store/toast'
import { useWsStatusStore } from '../../store/wsStatus'
import { formatVnd } from '../orders/orderPayModel'
import {
  handledQrOrders,
  notificationDescription,
  notificationIsDisplayable,
  notificationMatchesSearch,
  notificationNeedsAction,
  type NotificationSearchField,
  notificationTarget,
  notificationTitle,
  QR_ACTION_CANCEL,
  QR_ACTION_CONFIRM,
  qrOrderMeta,
} from './notificationModel'
import { QrManualConfirmDialog } from './QrManualConfirmDialog'
import './notifications.css'

type ViewFilter = 'open' | 'all'

function relativeTime(value: number) {
  const diffMinutes = Math.round((value - Date.now()) / 60_000)
  if (Math.abs(diffMinutes) < 1) return 'vừa xong'
  if (Math.abs(diffMinutes) < 60) {
    return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(diffMinutes, 'minute')
  }
  const diffHours = Math.round(diffMinutes / 60)
  if (Math.abs(diffHours) < 24) {
    return new Intl.RelativeTimeFormat('vi', { numeric: 'auto' }).format(diffHours, 'hour')
  }
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(value)
}

function severityTone(notification: OperationNotification) {
  if (notification.severity === 'critical' || notification.severity === 'urgent') return 'danger'
  if (notification.severity === 'attention') return 'warning'
  return 'info'
}

function stateLabel(notification: OperationNotification) {
  switch (notification.state) {
    case 'acknowledged':
      return 'Đã xem'
    case 'claimed':
      return 'Đang xử lý'
    case 'resolved':
      return 'Hoàn tất'
    default:
      return 'Mới'
  }
}

export function NotificationCenter() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const setOrderHost = useOrderQueueStore((state) => state.setHostName)
  const setOrderCustomerName = useOrderQueueStore((state) => state.setCustomerNameFilter)
  const connected = useWsStatusStore((state) => state.connected)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<ViewFilter>('open')
  const [searchField, setSearchField] = useState<NotificationSearchField>('host')
  const [search, setSearch] = useState('')

  const query = useQuery({
    queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY,
    queryFn: getOperationNotificationSnapshot,
    refetchInterval: connected ? 60_000 : 15_000,
    staleTime: 5_000,
  })

  const items = useMemo(
    () =>
      (query.data?.items ?? [])
        .filter(notificationIsDisplayable)
        .sort((left, right) => right.updatedAtMs - left.updatedAtMs),
    [query.data?.items],
  )
  // Task 6.6: "Cần xử lý" = việc còn phải làm. Loại `payment_recorded`/`qr_payment_success`
  // (xem notificationNeedsAction) để giao dịch thành công — loại tần suất cao nhất — không
  // đẩy thông báo lỗi tiền xuống dưới. Chúng vẫn nằm đủ ở tab "Tất cả".
  const searching = search.trim() !== ''
  const searchedItems = useMemo(
    () => items.filter((item) => notificationMatchesSearch(item, searchField, search)),
    [items, searchField, search],
  )
  const openItems = searchedItems.filter(notificationNeedsAction)
  const visibleItems = filter === 'open' ? openItems : searchedItems
  // Chuông ngoài header đếm toàn bộ mục mới; nút "Đánh dấu đã xem" chỉ tác động lên mục đang
  // lọc để không đánh dấu nhầm những thông báo người dùng không nhìn thấy.
  const newItems = items.filter((item) => item.state === 'new')
  const visibleNewItems = searchedItems.filter((item) => item.state === 'new')

  const stateMutation = useMutation({
    mutationFn: ({ action, ids }: { action: 'ack' | 'claim' | 'resolve'; ids: string[] }) =>
      updateOperationNotificationState(action, ids),
    onSuccess: (result) => {
      if (result.notFound.length) {
        pushToast('Một số thông báo đã mất do máy chủ khởi động lại; danh sách sẽ được đồng bộ.', 'info')
      }
      void queryClient.invalidateQueries({ queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  const runStateAction = (action: 'ack' | 'claim' | 'resolve', ids: string[]) => {
    if (!ids.length || stateMutation.isPending) return
    stateMutation.mutate({ action, ids })
  }

  // --- Nút của `qr_no_signal` (cùng luật panel Qt, task 6.3/6.5b) ---------------------------
  // Đơn đã xử lý ⇒ khóa nút + nói rõ lý do. Hai nguồn: (1) card `qr_manual_confirmed` server
  // phát SAU KHI đã ghi tiền (chắc chắn, kể cả do thu ngân khác/panel Qt bấm); (2) việc chính
  // drawer này vừa làm — hủy đơn KHÔNG sinh thông báo nào nên đây là đường duy nhất biết đơn đã
  // hủy, và cũng chặn bấm lần hai trong khoảng chờ vòng đồng bộ kế tiếp.
  const [locallyHandled, setLocallyHandled] = useState<Record<string, string>>({})
  const [confirmTarget, setConfirmTarget] = useState<OperationNotification | null>(null)
  const [confirmError, setConfirmError] = useState('')
  const [cancelTarget, setCancelTarget] = useState<OperationNotification | null>(null)
  const handledOrders = useMemo(() => handledQrOrders(items), [items])

  const markHandled = (notification: OperationNotification, orderId: string, reason: string) => {
    if (orderId) setLocallyHandled((current) => ({ ...current, [orderId]: reason }))
    // Đơn đã đóng ⇒ thông báo hết là "việc cần làm". Best-effort: lỗi đồng bộ trạng thái
    // không được làm hỏng kết quả tiền đã ghi.
    updateOperationNotificationState('resolve', [notification.id])
      .catch(() => undefined)
      .finally(() => void queryClient.invalidateQueries({ queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY }))
  }

  const confirmMutation = useMutation({
    mutationFn: ({ orderId, tid }: { orderId: string; tid: string }) => confirmQrManual(orderId, tid),
    onSuccess: (result, { orderId }) => {
      const amount = result?.value ? ` ${formatVnd(result.value)}` : ''
      pushToast(`Đã xác nhận nhận tiền${amount} cho đơn ${orderId}.`, 'success')
      if (confirmTarget) markHandled(confirmTarget, orderId, 'Đơn này đã được xác nhận')
      setConfirmTarget(null)
      setConfirmError('')
    },
    onError: (error: Error) => setConfirmError(error.message || 'Không xác nhận được.'),
  })

  const cancelMutation = useMutation({
    mutationFn: (orderId: string) => cancelQrOrder(orderId),
    onSuccess: (_result, orderId) => {
      pushToast(`Đã hủy đơn ${orderId}.`, 'success')
      if (cancelTarget) markHandled(cancelTarget, orderId, 'Đơn này đã được hủy')
      setCancelTarget(null)
    },
    onError: (error: Error) => {
      setCancelTarget(null)
      pushToast(error.message || 'Không hủy được.', 'error')
    },
  })

  const openTarget = (notification: OperationNotification) => {
    const target = notificationTarget(notification)
    if (!target) return
    if (notification.state === 'new') runStateAction('ack', [notification.id])
    if (notification.type === 'service_debit') {
      // Lọc sẵn theo máy khách vừa rời. Xóa lọc tên tài khoản: store này sống suốt phiên nên một
      // bộ lọc cũ còn sót sẽ làm đơn nợ của máy biến mất.
      setOrderHost(notification.hostName)
      setOrderCustomerName('')
    }
    setOpen(false)
    navigate(target)
  }

  return (
    <>
      <button
        type="button"
        className="notification-trigger"
        aria-label={`Thông báo vận hành${newItems.length ? `, ${newItems.length} mục mới` : ''}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <Bell size={21} weight={newItems.length ? 'fill' : 'regular'} aria-hidden="true" />
        {newItems.length ? (
          <span className="notification-trigger__count" aria-hidden="true">
            {newItems.length > 99 ? '99+' : newItems.length}
          </span>
        ) : null}
      </button>

      <Drawer
        open={open}
        title="Thông báo vận hành"
        // Esc/click nền khi đang mở hộp thoại xác nhận chỉ được đóng hộp thoại, không đóng luôn drawer.
        onClose={() => {
          if (!confirmTarget && !cancelTarget) setOpen(false)
        }}
        headerActions={
          <>
            <Button
              type="button"
              variant="ghost"
              icon={<GearSix size={18} weight="bold" />}
              onClick={() => {
                setOpen(false)
                navigate('/notification-settings')
              }}
            >
              Thiết lập
            </Button>
            <div className="notification-header-end">
              {visibleNewItems.length ? (
                <Button
                  type="button"
                  variant="ghost"
                  icon={<Checks size={18} weight="bold" aria-hidden="true" />}
                  title="Đánh dấu tất cả đã xem"
                  aria-label="Đánh dấu tất cả đã xem"
                  loading={stateMutation.isPending}
                  onClick={() => runStateAction('ack', visibleNewItems.map((item) => item.id))}
                >
                  Đã xem
                </Button>
              ) : null}
              <Button
                type="button"
                variant="secondary"
                className="ds-icon-button"
                icon={<ArrowsClockwise size={18} weight="bold" aria-hidden="true" />}
                title="Làm mới"
                aria-label="Làm mới"
                loading={query.isFetching}
                onClick={() => void query.refetch()}
              />
            </div>
          </>
        }
      >
        <div className="notification-center">
          <div className="notification-toolbar">
            <div className="notification-tabs" role="tablist" aria-label="Lọc thông báo">
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'open'}
                className={filter === 'open' ? 'is-active' : ''}
                onClick={() => setFilter('open')}
              >
                Cần xử lý <span>{openItems.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={filter === 'all'}
                className={filter === 'all' ? 'is-active' : ''}
                onClick={() => setFilter('all')}
              >
                Tất cả
              </button>
            </div>
            <div className="ds-input-group ds-input-group--search">
              <Select
                value={searchField}
                aria-label="Tìm theo"
                onChange={(event) => setSearchField(event.target.value as NotificationSearchField)}
              >
                <option value="host">Máy</option>
                <option value="user">Tài khoản</option>
              </Select>
              <div className="ds-search-input">
                <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                <input
                  className="ds-input"
                  type="search"
                  value={search}
                  placeholder={searchField === 'host' ? 'Nhập tên máy' : 'Nhập tên tài khoản'}
                  aria-label={searchField === 'host' ? 'Tìm theo máy' : 'Tìm theo tài khoản'}
                  onChange={(event) => setSearch(event.target.value)}
                />
                {search ? (
                  <button
                    type="button"
                    className="ds-search-input__clear"
                    aria-label="Xóa tìm kiếm"
                    onClick={() => setSearch('')}
                  >
                    <X size={18} weight="fill" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          {query.data?.dropped ? (
            <InlineAlert tone="warning">
              Máy chủ đã loại bớt thông báo cũ khỏi bộ nhớ. Danh sách hiện tại đã được đồng bộ lại.
            </InlineAlert>
          ) : null}
          {query.isLoading ? <StateView title="Đang tải thông báo…" /> : null}
          {query.isError ? (
            <StateView
              title="Không tải được thông báo"
              description={(query.error as Error).message}
              action={<Button onClick={() => query.refetch()}>Thử lại</Button>}
            />
          ) : null}
          {!query.isLoading && !query.isError && visibleItems.length === 0 ? (
            <StateView
              title={
                searching
                  ? 'Không có thông báo khớp'
                  : filter === 'open'
                    ? 'Không có việc đang chờ'
                    : 'Chưa có thông báo trong ca này'
              }
              description={
                searching
                  ? `Không có thông báo nào theo ${searchField === 'host' ? 'máy' : 'tài khoản'} "${search.trim()}".`
                  : 'Thông báo được lưu trong RAM và sẽ bắt đầu lại khi Server khởi động lại.'
              }
            />
          ) : null}

          <div className="notification-list" role="list" aria-live="polite">
            {visibleItems.map((notification) => {
              const target = notificationTarget(notification)
              const qrOrder = qrOrderMeta(notification)
              const qrActions = notification.actions.filter(
                (action) => action.id === QR_ACTION_CONFIRM || action.id === QR_ACTION_CANCEL,
              )
              const qrDisabledReason =
                (qrOrder.orderId && (locallyHandled[qrOrder.orderId] ?? handledOrders.get(qrOrder.orderId))) ||
                (notification.state === 'resolved' ? 'Thông báo này đã hoàn tất' : '') ||
                (!qrOrder.orderId ? 'Thông báo thiếu mã đơn' : '')
              return (
                <article
                  key={notification.id}
                  role="listitem"
                  className={`notification-item notification-item--${notification.severity}${
                    notification.state === 'new' ? ' is-new' : ''
                  }`}
                >
                  <div className="notification-item__marker" aria-hidden="true" />
                  <div className="notification-item__content">
                    <div className="notification-item__topline">
                      <StatusBadge tone={severityTone(notification)}>{stateLabel(notification)}</StatusBadge>
                      <time dateTime={new Date(notification.updatedAtMs).toISOString()}>
                        {relativeTime(notification.updatedAtMs)}
                      </time>
                    </div>
                    <h3>{notificationTitle(notification)}</h3>
                    <p>{notificationDescription(notification)}</p>
                    {notification.memberId ? <small>Hội viên</small> : null}
                    {qrActions.length ? (
                      <div className="notification-item__actions notification-item__actions--qr">
                        {qrActions.map((action) =>
                          action.id === QR_ACTION_CONFIRM ? (
                            <Button
                              key={action.id}
                              type="button"
                              variant="primary"
                              icon={<CheckCircle size={17} weight="bold" />}
                              disabled={Boolean(qrDisabledReason)}
                              title={qrDisabledReason || undefined}
                              onClick={() => {
                                setConfirmError('')
                                setConfirmTarget(notification)
                              }}
                            >
                              {action.label || 'Đã nhận được tiền'}
                            </Button>
                          ) : (
                            <Button
                              key={action.id}
                              type="button"
                              variant="secondary"
                              icon={<X size={17} weight="bold" />}
                              disabled={Boolean(qrDisabledReason)}
                              title={qrDisabledReason || undefined}
                              onClick={() => setCancelTarget(notification)}
                            >
                              {action.label || 'Hủy đơn'}
                            </Button>
                          ),
                        )}
                        {qrDisabledReason ? (
                          <small className="notification-item__reason">{qrDisabledReason}</small>
                        ) : null}
                      </div>
                    ) : null}
                    {/* Quy trình "Nhận xử lý → Hoàn tất" tạm bỏ (user chốt 2026-10-23: không có
                        quy trình này cho mọi sự kiện). Chỉ còn Mở chi tiết (khi có trang đích) + Đã xem. */}
                    {target || notification.state === 'new' ? (
                    <div className="notification-item__actions">
                      {target ? (
                        <Button
                          type="button"
                          variant="secondary"
                          icon={<ArrowSquareOut size={17} />}
                          onClick={() => openTarget(notification)}
                        >
                          Mở chi tiết
                        </Button>
                      ) : null}
                      {notification.state === 'new' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<Check size={17} />}
                          disabled={stateMutation.isPending}
                          onClick={() => runStateAction('ack', [notification.id])}
                        >
                          Đã xem
                        </Button>
                      ) : null}
                    </div>
                    ) : null}
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </Drawer>

      <QrManualConfirmDialog
        order={confirmTarget ? qrOrderMeta(confirmTarget) : null}
        pending={confirmMutation.isPending}
        error={confirmError}
        onCancel={() => {
          setConfirmTarget(null)
          setConfirmError('')
        }}
        onConfirm={(tid) => {
          if (!confirmTarget || confirmMutation.isPending) return
          confirmMutation.mutate({ orderId: qrOrderMeta(confirmTarget).orderId, tid })
        }}
      />
      <ConfirmAction
        open={cancelTarget !== null}
        title="Hủy đơn"
        description={cancelTarget ? `Hủy đơn ${qrOrderMeta(cancelTarget).orderId}?` : undefined}
        confirmLabel="Hủy đơn"
        cancelLabel="Giữ lại"
        danger
        pending={cancelMutation.isPending}
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => {
          if (!cancelTarget || cancelMutation.isPending) return
          cancelMutation.mutate(qrOrderMeta(cancelTarget).orderId)
        }}
      />
    </>
  )
}
