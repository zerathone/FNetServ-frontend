import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, CheckCircle, Hand, ArrowSquareOut } from '@phosphor-icons/react'
import { useNavigate } from 'react-router-dom'
import {
  getOperationNotificationSnapshot,
  OPERATIONS_NOTIFICATIONS_QUERY_KEY,
  updateOperationNotificationState,
  type OperationNotification,
} from '../../api/notifications'
import { Button, Drawer, InlineAlert, StateView, StatusBadge } from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { useWsStatusStore } from '../../store/wsStatus'
import {
  notificationDescription,
  notificationNeedsAction,
  notificationTarget,
  notificationTitle,
} from './notificationModel'
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
  const connected = useWsStatusStore((state) => state.connected)
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<ViewFilter>('open')

  const query = useQuery({
    queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY,
    queryFn: getOperationNotificationSnapshot,
    refetchInterval: connected ? 60_000 : 15_000,
    staleTime: 5_000,
  })

  const items = useMemo(
    () => [...(query.data?.items ?? [])].sort((left, right) => right.updatedAtMs - left.updatedAtMs),
    [query.data?.items],
  )
  // Task 6.6: "Cần xử lý" = việc còn phải làm. Loại `payment_recorded`/`qr_payment_success`
  // (xem notificationNeedsAction) để giao dịch thành công — loại tần suất cao nhất — không
  // đẩy thông báo lỗi tiền xuống dưới. Chúng vẫn nằm đủ ở tab "Tất cả".
  const openItems = items.filter(notificationNeedsAction)
  const visibleItems = filter === 'open' ? openItems : items
  const newItems = items.filter((item) => item.state === 'new')

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

  const openTarget = (notification: OperationNotification) => {
    const target = notificationTarget(notification)
    if (!target) return
    if (notification.state === 'new') runStateAction('ack', [notification.id])
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
        description="Hàng đợi trong ca trực · dữ liệu được làm mới từ REST và tín hiệu realtime."
        onClose={() => setOpen(false)}
        footer={
          <div className="notification-footer">
            <span>{connected ? 'Realtime đang kết nối' : 'Đang dùng đồng bộ dự phòng 15 giây'}</span>
            <Button
              type="button"
              variant="secondary"
              loading={query.isFetching}
              onClick={() => void query.refetch()}
            >
              Làm mới
            </Button>
          </div>
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
            {newItems.length ? (
              <Button
                type="button"
                variant="ghost"
                loading={stateMutation.isPending}
                onClick={() => runStateAction('ack', newItems.map((item) => item.id))}
              >
                Đánh dấu đã xem
              </Button>
            ) : null}
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
              title={filter === 'open' ? 'Không có việc đang chờ' : 'Chưa có thông báo trong ca này'}
              description="Thông báo được lưu trong RAM và sẽ bắt đầu lại khi Server khởi động lại."
            />
          ) : null}

          <div className="notification-list" role="list" aria-live="polite">
            {visibleItems.map((notification) => {
              const target = notificationTarget(notification)
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
                      {notification.state !== 'claimed' && notification.state !== 'resolved' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<Hand size={17} />}
                          disabled={stateMutation.isPending}
                          onClick={() => runStateAction('claim', [notification.id])}
                        >
                          Nhận xử lý
                        </Button>
                      ) : null}
                      {notification.state === 'claimed' ? (
                        <Button
                          type="button"
                          variant="ghost"
                          icon={<CheckCircle size={17} />}
                          disabled={stateMutation.isPending}
                          onClick={() => runStateAction('resolve', [notification.id])}
                        >
                          Hoàn tất
                        </Button>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </div>
      </Drawer>
    </>
  )
}
