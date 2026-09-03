import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  acceptComboOrder,
  acceptServiceOrder,
  cancelServiceOrder,
  getPendingComboOrders,
  getPendingOrders,
  getServicePaidLabel,
  rejectComboOrder,
  type PendingComboOrder,
  type PendingOrder,
} from '../../api/orders'
import {
  Button,
  ConfirmAction,
  InlineAlert,
  ListPagination,
  PageHeader,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { useOrderQueueStore } from '../../store/orderQueue'
import { pushToast } from '../../store/toast'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { useWsStatusStore } from '../../store/wsStatus'
import './orders.css'

const PAGE_SIZE = 20

type GroupedOrder = PendingOrder & {
  children: PendingOrder[]
  createdAtMs: number
}

type Confirmation =
  | { type: 'accept-service'; order: GroupedOrder }
  | { type: 'cancel-service'; order: GroupedOrder }
  | { type: 'cancel-selected'; ids: number[] }
  | { type: 'accept-combo'; order: PendingComboOrder }
  | { type: 'reject-combo'; order: PendingComboOrder }
  | null

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

function parseCreatedAt(date?: string, time?: string) {
  if (!date || !time) return 0
  const parsed = new Date(`${date}T${time}`).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function parseComboCreatedAt(value?: string) {
  if (!value) return 0
  const normalized = value.trim().replace(' ', 'T')
  const parsed = new Date(normalized).getTime()
  return Number.isNaN(parsed) ? 0 : parsed
}

function waitMinutes(createdAtMs: number, now: number) {
  if (!createdAtMs) return null
  return Math.max(0, Math.floor((now - createdAtMs) / 60_000))
}

function waitLabel(createdAtMs: number, now: number) {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return 'Chưa có thời gian'
  if (minutes < 1) return 'Vừa gọi'
  if (minutes < 60) return `${minutes} phút`
  const hours = Math.floor(minutes / 60)
  return `${hours} giờ ${minutes % 60} phút`
}

function waitTone(createdAtMs: number, now: number): 'neutral' | 'info' | 'warning' | 'danger' {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return 'neutral'
  if (minutes >= 20) return 'danger'
  if (minutes >= 10) return 'warning'
  return 'info'
}

function groupOrders(orders: PendingOrder[]): GroupedOrder[] {
  const mainIds = new Set(
    orders
      .filter((order) => !order.parentId || order.parentId === 0)
      .map((order) => order.serviceDetailId),
  )
  const mains = orders.filter(
    (order) => !order.parentId || order.parentId === 0 || !mainIds.has(order.parentId),
  )
  const toppings = orders.filter(
    (order) => order.parentId && order.parentId > 0 && mainIds.has(order.parentId),
  )
  return mains
    .map((main) => ({
      ...main,
      children: toppings.filter((item) => item.parentId === main.serviceDetailId),
      createdAtMs: parseCreatedAt(main.serviceDate, main.serviceTime),
    }))
    .sort((left, right) => {
      if (!left.createdAtMs) return 1
      if (!right.createdAtMs) return -1
      return left.createdAtMs - right.createdAtMs
    })
}

function serviceItems(order: GroupedOrder) {
  // `/orders/pending` chỉ chứa ServicePaid IN (0,4,5). MFC tạo voucher cho cả ba
  // trạng thái, vì vậy `alreadyPaid` luôn false. Không suy luận `servicePaid !== 0`.
  return [
    {
      detailId: order.serviceDetailId,
      quantity: order.quantity,
      amount: order.amount,
      alreadyPaid: false,
    },
    ...order.children.map((child) => ({
      detailId: child.serviceDetailId,
      quantity: child.quantity,
      amount: child.amount,
      alreadyPaid: false,
    })),
  ]
}

function serviceCancelItems(order: GroupedOrder) {
  return [
    { type: 'service' as const, id: order.serviceDetailId },
    ...order.children.map((child) => ({
      type: 'service' as const,
      id: child.serviceDetailId,
    })),
  ]
}

function orderAmount(order: GroupedOrder) {
  return order.amount + order.children.reduce((sum, child) => sum + child.amount, 0)
}

export function OrderWorkspace() {
  const queryClient = useQueryClient()
  const connected = useWsStatusStore((state) => state.connected)
  const staffId = useAuthStore((state) => state.staffId)
  const selectedUserId = useOrderQueueStore((state) => state.selectedUserId)
  const hostName = useOrderQueueStore((state) => state.hostName)
  const setSelectedUserId = useOrderQueueStore((state) => state.setSelectedUserId)
  const setHostName = useOrderQueueStore((state) => state.setHostName)
  const [activeTab, setActiveTab] = useState<'service' | 'combo'>('service')
  const [servicePage, setServicePage] = useState(0)
  const [comboPage, setComboPage] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [now, setNow] = useState(() => Date.now())
  const serviceIntent = useIdempotentIntent('order-service-accept')
  const comboAcceptIntent = useIdempotentIntent('order-combo-accept')
  const comboRejectIntent = useIdempotentIntent('order-combo-reject')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const servicesQuery = useQuery({
    queryKey: ['pending-orders', selectedUserId],
    queryFn: () => getPendingOrders(selectedUserId || undefined),
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const comboQuery = useQuery({
    queryKey: ['pending-orders-combo'],
    queryFn: getPendingComboOrders,
    refetchInterval: connected ? 30_000 : 5_000,
  })

  const groupedOrders = useMemo(
    () =>
      groupOrders(servicesQuery.data ?? []).filter((order) =>
        hostName
          ? (order.hostName ?? '').toLocaleLowerCase('vi').includes(
              hostName.toLocaleLowerCase('vi'),
            )
          : true,
      ),
    [hostName, servicesQuery.data],
  )
  const comboOrders = useMemo(
    () =>
      (comboQuery.data ?? [])
        .filter((order) =>
          hostName
            ? (order.hostName ?? '').toLocaleLowerCase('vi').includes(
                hostName.toLocaleLowerCase('vi'),
              )
            : true,
        )
        .sort(
          (left, right) =>
            parseComboCreatedAt(left.createdAt) - parseComboCreatedAt(right.createdAt),
        ),
    [comboQuery.data, hostName],
  )
  const serviceTotalPages = Math.max(1, Math.ceil(groupedOrders.length / PAGE_SIZE))
  const comboTotalPages = Math.max(1, Math.ceil(comboOrders.length / PAGE_SIZE))
  const visibleServiceOrders = groupedOrders.slice(
    servicePage * PAGE_SIZE,
    (servicePage + 1) * PAGE_SIZE,
  )
  const visibleComboOrders = comboOrders.slice(
    comboPage * PAGE_SIZE,
    (comboPage + 1) * PAGE_SIZE,
  )

  useEffect(() => {
    setServicePage(0)
    setComboPage(0)
    setSelectedIds(new Set())
  }, [hostName, selectedUserId])

  useEffect(() => {
    if (servicePage >= serviceTotalPages) setServicePage(serviceTotalPages - 1)
  }, [servicePage, serviceTotalPages])

  useEffect(() => {
    if (comboPage >= comboTotalPages) setComboPage(comboTotalPages - 1)
  }, [comboPage, comboTotalPages])

  const serviceMutation = useMutation({
    mutationFn: (order: GroupedOrder) => {
      const items = serviceItems(order)
      return acceptServiceOrder({
        staffId: String(staffId ?? ''),
        userId: order.userId,
        anonymous: order.userId === 0,
        hostName: order.hostName || '',
        idem: serviceIntent.getKey(
          fingerprintIntent({
            userId: order.userId,
            hostName: order.hostName || '',
            serviceDetailId: order.serviceDetailId,
            items,
          }),
        ),
        items,
      })
    },
    onSuccess: (response) => {
      serviceIntent.clearKey()
      setConfirmation(null)
      pushToast(
        `Đã chấp nhận ${response.accepted} dòng dịch vụ${response.paymentId ? ` · Phiếu #${response.paymentId}` : ''}.`,
        'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const cancelMutation = useMutation({
    mutationFn: (orders: GroupedOrder[]) =>
      cancelServiceOrder({
        staffId: String(staffId ?? ''),
        items: orders.flatMap(serviceCancelItems),
      }),
    onSuccess: (response) => {
      setConfirmation(null)
      setSelectedIds(new Set())
      pushToast(`Đã hủy ${response.cancelled} dòng dịch vụ.`, 'success')
      void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const comboAcceptMutation = useMutation({
    mutationFn: (order: PendingComboOrder) =>
      acceptComboOrder({
        comboCardId: order.comboCardId,
        hostName: order.hostName ?? '',
        idem: comboAcceptIntent.getKey(
          fingerprintIntent({
            comboCardId: order.comboCardId,
            hostName: order.hostName ?? '',
            price: order.price,
          }),
        ),
      }),
    onSuccess: (response) => {
      comboAcceptIntent.clearKey()
      setConfirmation(null)
      pushToast(
        response.duplicated
          ? 'Đơn combo đã được xác nhận trước đó; không thu tiền lần hai.'
          : `Đã xác nhận thu tiền · Phiếu #${response.paymentId}.`,
        response.duplicated ? 'info' : 'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] })
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const comboRejectMutation = useMutation({
    mutationFn: (order: PendingComboOrder) =>
      rejectComboOrder({
        comboCardId: order.comboCardId,
        idem: comboRejectIntent.getKey(
          fingerprintIntent({ comboCardId: order.comboCardId }),
        ),
      }),
    onSuccess: (response) => {
      comboRejectIntent.clearKey()
      setConfirmation(null)
      pushToast(
        response.duplicated
          ? 'Đơn combo đã được xử lý trước đó.'
          : 'Đã từ chối đơn combo.',
        response.duplicated ? 'info' : 'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const selectedOrders = groupedOrders.filter((order) =>
    selectedIds.has(order.serviceDetailId),
  )
  const allSelected =
    visibleServiceOrders.length > 0 &&
    visibleServiceOrders.every((order) => selectedIds.has(order.serviceDetailId))
  const serviceTotal = groupedOrders.reduce(
    (sum, order) => sum + orderAmount(order),
    0,
  )
  const comboTotal = comboOrders.reduce((sum, order) => sum + order.price, 0)
  const pendingMutation =
    serviceMutation.isPending ||
    cancelMutation.isPending ||
    comboAcceptMutation.isPending ||
    comboRejectMutation.isPending

  const closeConfirmation = () => {
    if (pendingMutation) return
    if (confirmation?.type === 'accept-service') serviceIntent.clearKey()
    if (confirmation?.type === 'accept-combo') comboAcceptIntent.clearKey()
    if (confirmation?.type === 'reject-combo') comboRejectIntent.clearKey()
    setConfirmation(null)
  }

  const confirmAction = () => {
    if (!confirmation) return
    switch (confirmation.type) {
      case 'accept-service':
        serviceMutation.mutate(confirmation.order)
        break
      case 'cancel-service':
        cancelMutation.mutate([confirmation.order])
        break
      case 'cancel-selected':
        cancelMutation.mutate(
          groupedOrders.filter((order) => confirmation.ids.includes(order.serviceDetailId)),
        )
        break
      case 'accept-combo':
        comboAcceptMutation.mutate(confirmation.order)
        break
      case 'reject-combo':
        comboRejectMutation.mutate(confirmation.order)
        break
    }
  }

  return (
    <section className="order-workspace">
      <PageHeader
        eyebrow="Điểm bán hàng"
        title="Hàng đợi gọi món"
        description="Đơn chờ lâu được xếp trước; món chính và topping luôn xử lý cùng nhau."
        actions={
          <>
            <StatusBadge tone={connected ? 'success' : 'warning'}>
              {connected ? 'Realtime đã kết nối' : 'Đang dùng polling'}
            </StatusBadge>
            <Button
              type="button"
              variant="secondary"
              loading={servicesQuery.isFetching || comboQuery.isFetching}
              onClick={() => {
                void servicesQuery.refetch()
                void comboQuery.refetch()
              }}
            >
              Làm mới
            </Button>
          </>
        }
      />

      <div className="order-summary">
        <button
          type="button"
          className={activeTab === 'service' ? 'is-active' : ''}
          onClick={() => setActiveTab('service')}
        >
          <span>Dịch vụ chờ</span>
          <strong>{groupedOrders.length}</strong>
          <small>{formatMoney(serviceTotal)}</small>
        </button>
        <button
          type="button"
          className={activeTab === 'combo' ? 'is-active' : ''}
          onClick={() => setActiveTab('combo')}
        >
          <span>Combo chờ duyệt</span>
          <strong>{comboOrders.length}</strong>
          <small>{formatMoney(comboTotal)}</small>
        </button>
      </div>

      <div className="order-filters">
        <label className="ds-field">
          <span className="ds-field__label">Tên máy</span>
          <input
            className="ds-input"
            value={hostName}
            placeholder="Để trống = tất cả máy"
            onChange={(event) => setHostName(event.target.value)}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Mã khách hàng</span>
          <input
            className="ds-input"
            inputMode="numeric"
            value={selectedUserId}
            placeholder="Để trống = tất cả khách"
            onChange={(event) =>
              setSelectedUserId(event.target.value.replace(/\D/g, ''))
            }
          />
        </label>
        {hostName || selectedUserId ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setHostName('')
              setSelectedUserId('')
            }}
          >
            Xóa bộ lọc
          </Button>
        ) : null}
      </div>

      {activeTab === 'service' ? (
        <div className="order-panel">
          {selectedOrders.length > 0 ? (
            <div className="order-selection">
              <strong>{selectedOrders.length} đơn đã chọn</strong>
              <div>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() =>
                    setConfirmation({
                      type: 'cancel-selected',
                      ids: selectedOrders.map((order) => order.serviceDetailId),
                    })
                  }
                >
                  Hủy các đơn đã chọn
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                  Bỏ chọn
                </Button>
              </div>
            </div>
          ) : null}

          {servicesQuery.isLoading ? (
            <StateView title="Đang tải đơn dịch vụ" />
          ) : servicesQuery.isError ? (
            <StateView
              title="Không tải được đơn dịch vụ"
              description={(servicesQuery.error as Error).message}
              action={<Button onClick={() => servicesQuery.refetch()}>Thử lại</Button>}
            />
          ) : groupedOrders.length === 0 ? (
            <StateView
              title="Không có đơn dịch vụ đang chờ"
              description={
                hostName || selectedUserId
                  ? 'Không có đơn khớp bộ lọc hiện tại.'
                  : 'Đơn khách gọi từ máy trạm sẽ xuất hiện tại đây.'
              }
            />
          ) : (
            <>
              <ListPagination
                page={servicePage}
                totalPages={serviceTotalPages}
                canNext={servicePage < serviceTotalPages - 1}
                onPrevious={() => setServicePage((value) => Math.max(0, value - 1))}
                onNext={() => setServicePage((value) => Math.min(serviceTotalPages - 1, value + 1))}
              />
              <label className="order-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={() =>
                    setSelectedIds((current) => {
                      const next = new Set(current)
                      visibleServiceOrders.forEach((order) => {
                        if (allSelected) next.delete(order.serviceDetailId)
                        else next.add(order.serviceDetailId)
                      })
                      return next
                    })
                  }
                />
                Chọn tất cả đơn đang hiển thị
              </label>
              <div className="order-list-region">
                <div className="order-list">
                {visibleServiceOrders.map((order) => (
                  <article key={order.serviceDetailId} className="order-card">
                    <label className="order-card__check">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(order.serviceDetailId)}
                        aria-label={`Chọn đơn ${order.serviceName}`}
                        onChange={() =>
                          setSelectedIds((current) => {
                            const next = new Set(current)
                            if (next.has(order.serviceDetailId)) {
                              next.delete(order.serviceDetailId)
                            } else {
                              next.add(order.serviceDetailId)
                            }
                            return next
                          })
                        }
                      />
                    </label>
                    <div className="order-card__identity">
                      <strong>{order.hostName || 'Chưa xác định máy'}</strong>
                      <span>{order.userName || 'Khách vãng lai'}</span>
                      <StatusBadge tone={waitTone(order.createdAtMs, now)}>
                        Chờ {waitLabel(order.createdAtMs, now)}
                      </StatusBadge>
                    </div>
                    <div className="order-card__items">
                      <div>
                        <strong>{order.quantity} × {order.serviceName}</strong>
                        <span>{formatMoney(order.amount)} · {getServicePaidLabel(order.servicePaid)}</span>
                      </div>
                      {order.children.map((child) => (
                        <div key={child.serviceDetailId} className="order-card__topping">
                          <strong>+ {child.quantity} × {child.serviceName}</strong>
                          <span>{formatMoney(child.amount)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="order-card__total">
                      <span>Tổng đơn</span>
                      <strong>{formatMoney(orderAmount(order))}</strong>
                    </div>
                    <div className="order-card__actions">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={pendingMutation}
                        onClick={() => setConfirmation({ type: 'accept-service', order })}
                      >
                        Chấp nhận đơn
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={pendingMutation}
                        onClick={() => setConfirmation({ type: 'cancel-service', order })}
                      >
                        Từ chối
                      </Button>
                    </div>
                  </article>
                ))}
                </div>
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="order-panel">
          <InlineAlert tone="warning">
            Chỉ bấm “Đã thu tiền” sau khi đã nhận đủ tiền mặt. Giá combo được máy chủ đọc lại khi chốt.
          </InlineAlert>
          {comboQuery.isLoading ? (
            <StateView title="Đang tải đơn combo" />
          ) : comboQuery.isError ? (
            <StateView
              title="Không tải được đơn combo"
              description={(comboQuery.error as Error).message}
              action={<Button onClick={() => comboQuery.refetch()}>Thử lại</Button>}
            />
          ) : comboOrders.length === 0 ? (
            <StateView
              title="Không có combo chờ duyệt"
              description={
                hostName ? 'Không có đơn combo khớp máy đang lọc.' : 'Đơn combo tiền mặt sẽ xuất hiện tại đây.'
              }
            />
          ) : (
            <>
              <ListPagination
                page={comboPage}
                totalPages={comboTotalPages}
                canNext={comboPage < comboTotalPages - 1}
                onPrevious={() => setComboPage((value) => Math.max(0, value - 1))}
                onNext={() => setComboPage((value) => Math.min(comboTotalPages - 1, value + 1))}
              />
              <div className="order-list-region">
                <div className="order-list">
              {visibleComboOrders.map((order) => {
                const createdAt = parseComboCreatedAt(order.createdAt)
                return (
                  <article key={order.comboCardId} className="order-card order-card--combo">
                    <div className="order-card__identity">
                      <strong>{order.hostName || 'Chưa xác định máy'}</strong>
                      <span>{order.ownerName || 'Khách vãng lai'}</span>
                      <StatusBadge tone={waitTone(createdAt, now)}>
                        Chờ {waitLabel(createdAt, now)}
                      </StatusBadge>
                    </div>
                    <div className="order-card__items">
                      <div>
                        <strong>{order.comboName}</strong>
                        <span>Thẻ {order.comboUserName} · Hết hạn {order.expireDate}</span>
                      </div>
                      {order.zone ? <small>Khu vực: {order.zone}</small> : null}
                    </div>
                    <div className="order-card__total">
                      <span>Tiền mặt cần thu</span>
                      <strong>{formatMoney(order.price)}</strong>
                    </div>
                    <div className="order-card__actions">
                      <Button
                        type="button"
                        variant="primary"
                        disabled={pendingMutation}
                        onClick={() => setConfirmation({ type: 'accept-combo', order })}
                      >
                        Đã thu tiền
                      </Button>
                      <Button
                        type="button"
                        variant="danger"
                        disabled={pendingMutation}
                        onClick={() => setConfirmation({ type: 'reject-combo', order })}
                      >
                        Từ chối
                      </Button>
                    </div>
                  </article>
                )
              })}
                </div>
              </div>
            </>
          )}
        </div>
      )}

      <ConfirmAction
        open={Boolean(confirmation)}
        title={
          confirmation?.type === 'accept-service'
            ? 'Chấp nhận đơn dịch vụ?'
            : confirmation?.type === 'accept-combo'
              ? 'Xác nhận đã thu tiền combo?'
              : confirmation?.type === 'reject-combo'
                ? 'Từ chối đơn combo?'
                : confirmation?.type === 'cancel-selected'
                  ? `Hủy ${confirmation.ids.length} đơn đã chọn?`
                  : 'Từ chối đơn dịch vụ?'
        }
        description={
          confirmation?.type === 'accept-service' ||
          confirmation?.type === 'cancel-service'
            ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.userName || 'Khách vãng lai'}`
            : confirmation?.type === 'accept-combo' ||
                confirmation?.type === 'reject-combo'
              ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.comboName}`
              : undefined
        }
        confirmLabel={
          confirmation?.type === 'accept-service'
            ? 'Chấp nhận đơn'
            : confirmation?.type === 'accept-combo'
              ? 'Xác nhận đã thu tiền'
              : 'Xác nhận hủy'
        }
        danger={
          confirmation?.type === 'cancel-service' ||
          confirmation?.type === 'cancel-selected' ||
          confirmation?.type === 'reject-combo'
        }
        pending={pendingMutation}
        onCancel={closeConfirmation}
        onConfirm={confirmAction}
      >
        {confirmation?.type === 'accept-service' ? (
          <dl className="order-confirm-summary">
            <div><dt>Món chính + topping</dt><dd>{1 + confirmation.order.children.length} dòng</dd></div>
            <div><dt>Tổng đơn</dt><dd>{formatMoney(orderAmount(confirmation.order))}</dd></div>
            <div><dt>Phương thức khách chọn</dt><dd>{getServicePaidLabel(confirmation.order.servicePaid)}</dd></div>
          </dl>
        ) : confirmation?.type === 'accept-combo' ? (
          <div className="order-confirm-stack">
            <InlineAlert tone="warning">Xác nhận này có nghĩa là quầy đã nhận đủ tiền mặt.</InlineAlert>
            <dl className="order-confirm-summary">
              <div><dt>Combo</dt><dd>{confirmation.order.comboName}</dd></div>
              <div><dt>Số tiền</dt><dd>{formatMoney(confirmation.order.price)}</dd></div>
              <div><dt>Thẻ combo</dt><dd>{confirmation.order.comboUserName}</dd></div>
            </dl>
          </div>
        ) : (
          <InlineAlert tone="warning">
            Đơn bị hủy sẽ không sinh phiếu thu và khách không nhận món/combo này.
          </InlineAlert>
        )}
      </ConfirmAction>
    </section>
  )
}
