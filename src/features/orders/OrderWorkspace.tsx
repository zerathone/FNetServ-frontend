import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { describeApiErrorCode } from '../../lib/apiErrorText'
import {
  acceptComboOrder,
  acceptServiceOrder,
  cancelServiceOrder,
  getPendingComboOrders,
  getPendingOrders,
  getServicePaidLabel,
  rejectComboOrder,
  type PendingComboOrder,
} from '../../api/orders'
import {
  Button,
  ConfirmAction,
  InlineAlert,
  ListPagination,
  PageHeader,
  PollingStatus,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { useOrderQueueStore } from '../../store/orderQueue'
import { pushToast } from '../../store/toast'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { useWsStatusStore } from '../../store/wsStatus'
import {
  QTY_MAX,
  QTY_MIN,
  canChangeQuantity,
  clampQuantity,
  describeProcessedCount,
  groupOrders,
  groupQrOrders,
  lineAmount,
  orderAmount,
  qrAcceptItems,
  qrCancelItems,
  qrSelectKey,
  quantityOf,
  serviceCancelItems,
  serviceItems,
  serviceSelectKey,
  type CancelItem,
  type GroupedOrder,
  type QrGroup,
  type QtyOverrides,
} from './orderQueueModel'
import './orders.css'

const PAGE_SIZE = 20

type QueueEntry =
  | { kind: 'qr'; key: string; group: QrGroup }
  | { kind: 'service'; key: string; order: GroupedOrder }

// task orders-qr-qty P5: Chấp nhận / Xác nhận phục vụ KHÔNG còn hộp xác nhận (parity Qt — thu ngân
// bấm liên tục; idem vẫn bắt buộc). Chỉ hủy/từ chối và combo tiền mặt còn hỏi lại.
type Confirmation =
  | { type: 'cancel-service'; order: GroupedOrder }
  | { type: 'cancel-qr'; group: QrGroup }
  | { type: 'cancel-selected'; keys: string[] }
  | { type: 'accept-combo'; order: PendingComboOrder }
  | { type: 'reject-combo'; order: PendingComboOrder }
  | null

const QR_CANCEL_WARNING =
  'Khách đã chuyển khoản. Hệ thống chỉ đánh dấu phiếu đã hủy, KHÔNG hoàn tiền — phải hoàn tiền thủ công cho khách.'

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
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

function matchesHost(hostName: string | null | undefined, filter: string) {
  if (!filter) return true
  return (hostName ?? '').toLocaleLowerCase('vi').includes(filter.toLocaleLowerCase('vi'))
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
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  const [qrCancelAck, setQrCancelAck] = useState(false)
  const [qtyOverrides, setQtyOverrides] = useState<QtyOverrides>({})
  const [now, setNow] = useState(() => Date.now())
  const serviceIntent = useIdempotentIntent('order-svc')
  const qrIntent = useIdempotentIntent('order-qr')
  const comboAcceptIntent = useIdempotentIntent('order-cb-acc')
  const comboRejectIntent = useIdempotentIntent('order-cb-rej')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setQrCancelAck(false)
  }, [confirmation])

  const servicesQuery = useQuery({
    // Khóa riêng 'with-paid': trang /orders/legacy dùng dạng response cũ (không includePaid).
    queryKey: ['pending-orders', selectedUserId, 'with-paid'],
    queryFn: () => getPendingOrders(selectedUserId || undefined, { includePaid: true }),
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const comboQuery = useQuery({
    queryKey: ['pending-orders-combo'],
    queryFn: getPendingComboOrders,
    refetchInterval: connected ? 30_000 : 5_000,
  })

  const groupedOrders = useMemo(
    () => groupOrders(servicesQuery.data ?? []).filter((order) => matchesHost(order.hostName, hostName)),
    [hostName, servicesQuery.data],
  )
  const qrGroups = useMemo(
    () => groupQrOrders(servicesQuery.data ?? []).filter((group) => matchesHost(group.hostName, hostName)),
    [hostName, servicesQuery.data],
  )
  // Đơn QR (khách đã trả tiền, đang chờ món) xếp TRÊN CÙNG, không lẫn vào đơn thường.
  const serviceEntries = useMemo<QueueEntry[]>(
    () => [
      ...qrGroups.map((group) => ({ kind: 'qr' as const, key: qrSelectKey(group), group })),
      ...groupedOrders.map((order) => ({ kind: 'service' as const, key: serviceSelectKey(order), order })),
    ],
    [groupedOrders, qrGroups],
  )
  const comboOrders = useMemo(
    () =>
      (comboQuery.data ?? [])
        .filter((order) => matchesHost(order.hostName, hostName))
        .sort(
          (left, right) =>
            parseComboCreatedAt(left.createdAt) - parseComboCreatedAt(right.createdAt),
        ),
    [comboQuery.data, hostName],
  )
  const serviceTotalPages = Math.max(1, Math.ceil(serviceEntries.length / PAGE_SIZE))
  const comboTotalPages = Math.max(1, Math.ceil(comboOrders.length / PAGE_SIZE))
  const visibleServiceEntries = serviceEntries.slice(
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
    setSelectedKeys(new Set())
  }, [hostName, selectedUserId])

  useEffect(() => {
    if (servicePage >= serviceTotalPages) setServicePage(serviceTotalPages - 1)
  }, [servicePage, serviceTotalPages])

  useEffect(() => {
    if (comboPage >= comboTotalPages) setComboPage(comboTotalPages - 1)
  }, [comboPage, comboTotalPages])

  const refreshServiceQueue = () => {
    void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
  }

  const clearOverrides = (ids: number[]) =>
    setQtyOverrides((current) => {
      const next = { ...current }
      ids.forEach((id) => delete next[id])
      return next
    })

  const serviceMutation = useMutation({
    mutationFn: (order: GroupedOrder) => {
      const items = serviceItems(order, qtyOverrides)
      return acceptServiceOrder({
        staffId: String(staffId ?? ''),
        userId: order.userId,
        anonymous: order.userId === 0,
        hostName: order.hostName || '',
        idem: serviceIntent.getKey(
          // Fingerprint gồm số lượng từng dòng ⇒ đổi SL là ý định mới (idem mới).
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
    onSuccess: (response, order) => {
      serviceIntent.clearKey()
      setConfirmation(null)
      clearOverrides([order.serviceDetailId, ...order.children.map((child) => child.serviceDetailId)])
      const result = describeProcessedCount(response.accepted, 'chấp nhận')
      const detail =
        response.accepted > 0
          ? `${response.paymentId ? ` · Phiếu #${response.paymentId}` : ''}${
              typeof response.amount === 'number' ? ` · ${formatMoney(response.amount)}` : ''
            }`
          : ''
      pushToast(`${result.message}${detail}`, result.tone)
      refreshServiceQueue()
      void invalidateMoneyQueries(queryClient)
    },
    onError: (error) => {
      pushToast(error.message, 'error')
      refreshServiceQueue()
    },
  })

  const qrAcceptMutation = useMutation({
    mutationFn: (group: QrGroup) => {
      const items = qrAcceptItems(group)
      return acceptServiceOrder({
        staffId: String(staffId ?? ''),
        userId: group.userId,
        anonymous: group.userId === 0,
        hostName: group.hostName || '',
        idem: qrIntent.getKey(fingerprintIntent({ voucherId: group.voucherId, items })),
        items,
      })
    },
    onSuccess: (response, group) => {
      qrIntent.clearKey()
      setConfirmation(null)
      const result = describeProcessedCount(response.accepted, 'xác nhận phục vụ')
      pushToast(
        response.accepted > 0 ? `${result.message} · Phiếu QR #${group.voucherId}` : result.message,
        result.tone,
      )
      refreshServiceQueue()
    },
    onError: (error) => {
      pushToast(error.message, 'error')
      refreshServiceQueue()
    },
  })

  const cancelMutation = useMutation({
    mutationFn: (items: CancelItem[]) =>
      cancelServiceOrder({
        staffId: String(staffId ?? ''),
        items,
      }),
    onSuccess: (response) => {
      setConfirmation(null)
      setSelectedKeys(new Set())
      const result = describeProcessedCount(response.cancelled, 'hủy')
      pushToast(result.message, result.tone)
      refreshServiceQueue()
    },
    onError: (error) => {
      pushToast(error.message, 'error')
      refreshServiceQueue()
    },
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

  const entryByKey = useMemo(
    () => new Map(serviceEntries.map((entry) => [entry.key, entry])),
    [serviceEntries],
  )
  const selectedEntries = serviceEntries.filter((entry) => selectedKeys.has(entry.key))
  const allSelected =
    visibleServiceEntries.length > 0 &&
    visibleServiceEntries.every((entry) => selectedKeys.has(entry.key))
  const serviceTotal = groupedOrders.reduce(
    (sum, order) => sum + orderAmount(order, qtyOverrides),
    0,
  )
  const qrPaidTotal = qrGroups.reduce((sum, group) => sum + group.paidTotal, 0)
  const comboTotal = comboOrders.reduce((sum, order) => sum + order.price, 0)
  const pendingMutation =
    serviceMutation.isPending ||
    qrAcceptMutation.isPending ||
    cancelMutation.isPending ||
    comboAcceptMutation.isPending ||
    comboRejectMutation.isPending

  const cancelItemsForKeys = (keys: string[]) =>
    keys.flatMap((key) => {
      const entry = entryByKey.get(key)
      if (!entry) return []
      return entry.kind === 'qr' ? qrCancelItems(entry.group) : serviceCancelItems(entry.order)
    })
  const selectionHasQr = (keys: string[]) => keys.some((key) => entryByKey.get(key)?.kind === 'qr')
  const confirmNeedsQrAck =
    confirmation?.type === 'cancel-qr' ||
    (confirmation?.type === 'cancel-selected' && selectionHasQr(confirmation.keys))

  const setQuantity = (order: GroupedOrder, value: number) => {
    const next = clampQuantity(value)
    setQtyOverrides((current) => {
      const updated = { ...current }
      if (next === order.quantity) delete updated[order.serviceDetailId]
      else updated[order.serviceDetailId] = next
      return updated
    })
  }

  const closeConfirmation = () => {
    if (pendingMutation) return
    if (confirmation?.type === 'accept-combo') comboAcceptIntent.clearKey()
    if (confirmation?.type === 'reject-combo') comboRejectIntent.clearKey()
    setConfirmation(null)
  }

  const confirmAction = () => {
    if (!confirmation) return
    switch (confirmation.type) {
      case 'cancel-service':
        cancelMutation.mutate(serviceCancelItems(confirmation.order))
        break
      case 'cancel-qr':
        cancelMutation.mutate(qrCancelItems(confirmation.group))
        break
      case 'cancel-selected':
        cancelMutation.mutate(cancelItemsForKeys(confirmation.keys))
        break
      case 'accept-combo':
        comboAcceptMutation.mutate(confirmation.order)
        break
      case 'reject-combo':
        comboRejectMutation.mutate(confirmation.order)
        break
    }
  }

  const toggleKey = (key: string) =>
    setSelectedKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const renderQrCard = (group: QrGroup) => (
    <article key={qrSelectKey(group)} className="order-card order-card--qr">
      <label className="order-card__check">
        <input
          type="checkbox"
          checked={selectedKeys.has(qrSelectKey(group))}
          aria-label={`Chọn phiếu QR #${group.voucherId}`}
          onChange={() => toggleKey(qrSelectKey(group))}
        />
      </label>
      <div className="order-card__identity">
        <strong>{group.hostName || 'Chưa xác định máy'}</strong>
        <span>{group.userName || 'Khách vãng lai'}</span>
        <StatusBadge tone="success">Đã trả QR · Phiếu #{group.voucherId}</StatusBadge>
        <StatusBadge tone={waitTone(group.createdAtMs, now)}>
          Chờ {waitLabel(group.createdAtMs, now)}
        </StatusBadge>
      </div>
      <div className="order-card__items">
        {group.lines.map((line) => (
          <div key={line.serviceDetailId}>
            <strong>{line.quantity} × {line.serviceName}</strong>
            <span>{formatMoney(line.serviceAmount ?? line.amount)}</span>
          </div>
        ))}
      </div>
      <div className="order-card__total">
        <span>Đã thu</span>
        <strong>{formatMoney(group.paidTotal)}</strong>
      </div>
      <div className="order-card__actions">
        <Button
          type="button"
          variant="primary"
          disabled={pendingMutation}
          onClick={() => qrAcceptMutation.mutate(group)}
        >
          Xác nhận phục vụ
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pendingMutation}
          onClick={() => setConfirmation({ type: 'cancel-qr', group })}
        >
          Hủy
        </Button>
      </div>
    </article>
  )

  const renderServiceCard = (order: GroupedOrder) => {
    const key = serviceSelectKey(order)
    const quantity = quantityOf(order, qtyOverrides)
    const editable = canChangeQuantity(order)
    return (
      <article key={key} className="order-card">
        <label className="order-card__check">
          <input
            type="checkbox"
            checked={selectedKeys.has(key)}
            aria-label={`Chọn đơn ${order.serviceName}`}
            onChange={() => toggleKey(key)}
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
            <strong>{quantity} × {order.serviceName}</strong>
            <span>
              {formatMoney(lineAmount(order, qtyOverrides))} · {getServicePaidLabel(order.servicePaid)}
            </span>
            {editable ? (
              <div className="order-qty" role="group" aria-label={`Số lượng ${order.serviceName}`}>
                <button
                  type="button"
                  className="order-qty__btn"
                  disabled={pendingMutation || quantity <= QTY_MIN}
                  aria-label="Giảm số lượng"
                  onClick={() => setQuantity(order, quantity - 1)}
                >
                  −
                </button>
                <input
                  className="order-qty__input"
                  inputMode="numeric"
                  value={quantity}
                  aria-label="Số lượng"
                  disabled={pendingMutation}
                  onChange={(event) => {
                    const digits = event.target.value.replace(/\D/g, '')
                    if (digits) setQuantity(order, Number(digits))
                  }}
                />
                <button
                  type="button"
                  className="order-qty__btn"
                  disabled={pendingMutation || quantity >= QTY_MAX}
                  aria-label="Tăng số lượng"
                  onClick={() => setQuantity(order, quantity + 1)}
                >
                  +
                </button>
              </div>
            ) : null}
          </div>
          {order.children.map((child) => (
            <div key={child.serviceDetailId} className="order-card__topping">
              <strong>+ {child.quantity} × {child.serviceName}</strong>
              <span>{formatMoney(lineAmount(child, qtyOverrides))}</span>
            </div>
          ))}
        </div>
        <div className="order-card__total">
          <span>Tổng đơn</span>
          <strong>{formatMoney(orderAmount(order, qtyOverrides))}</strong>
        </div>
        <div className="order-card__actions">
          <Button
            type="button"
            variant="primary"
            disabled={pendingMutation}
            onClick={() => serviceMutation.mutate(order)}
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
    )
  }

  return (
    <section className="order-workspace">
      <PageHeader
        eyebrow="Thu ngân"
        title="Hàng đợi gọi món"
        description="Đơn khách đã trả QR xếp trên cùng; đơn chờ lâu xếp trước; món chính và topping luôn xử lý cùng nhau."
        actions={
          <PollingStatus
            connected={connected}
            isError={servicesQuery.isError || comboQuery.isError}
            isFetching={servicesQuery.isFetching || comboQuery.isFetching}
            dataUpdatedAt={servicesQuery.dataUpdatedAt}
            intervalMs={connected ? 30_000 : 5_000}
            errorDetail={
              servicesQuery.error || comboQuery.error
                ? describeApiErrorCode(servicesQuery.error ?? comboQuery.error)
                : undefined
            }
            onRefresh={() => {
              void servicesQuery.refetch()
              void comboQuery.refetch()
            }}
          />
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
          <small>Cần thu {formatMoney(serviceTotal)}</small>
        </button>
        <button
          type="button"
          className={qrGroups.length > 0 ? 'order-summary__qr' : ''}
          onClick={() => setActiveTab('service')}
        >
          <span>Đã trả QR chờ món</span>
          <strong>{qrGroups.length}</strong>
          <small>Đã thu {formatMoney(qrPaidTotal)}</small>
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
          {selectedEntries.length > 0 ? (
            <div className="order-selection">
              <strong>{selectedEntries.length} đơn đã chọn</strong>
              <div>
                <Button
                  type="button"
                  variant="danger"
                  onClick={() =>
                    setConfirmation({
                      type: 'cancel-selected',
                      keys: selectedEntries.map((entry) => entry.key),
                    })
                  }
                >
                  Hủy các đơn đã chọn
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelectedKeys(new Set())}>
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
          ) : serviceEntries.length === 0 ? (
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
                    setSelectedKeys((current) => {
                      const next = new Set(current)
                      visibleServiceEntries.forEach((entry) => {
                        if (allSelected) next.delete(entry.key)
                        else next.add(entry.key)
                      })
                      return next
                    })
                  }
                />
                Chọn tất cả đơn đang hiển thị
              </label>
              <div className="order-list-region">
                <div className="order-list">
                  {visibleServiceEntries.map((entry) =>
                    entry.kind === 'qr' ? renderQrCard(entry.group) : renderServiceCard(entry.order),
                  )}
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
          confirmation?.type === 'cancel-qr'
            ? `Hủy đơn đã trả QR #${confirmation.group.voucherId}?`
            : confirmation?.type === 'accept-combo'
              ? 'Xác nhận đã thu tiền combo?'
              : confirmation?.type === 'reject-combo'
                ? 'Từ chối đơn combo?'
                : confirmation?.type === 'cancel-selected'
                  ? `Hủy ${confirmation.keys.length} đơn đã chọn?`
                  : 'Từ chối đơn dịch vụ?'
        }
        description={
          confirmation?.type === 'cancel-service'
            ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.userName || 'Khách vãng lai'}`
            : confirmation?.type === 'cancel-qr'
              ? `${confirmation.group.hostName || 'Chưa xác định máy'} · ${confirmation.group.userName || 'Khách vãng lai'}`
              : confirmation?.type === 'accept-combo' ||
                  confirmation?.type === 'reject-combo'
                ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.comboName}`
                : undefined
        }
        confirmLabel={confirmation?.type === 'accept-combo' ? 'Xác nhận đã thu tiền' : 'Xác nhận hủy'}
        danger={
          confirmation?.type === 'cancel-service' ||
          confirmation?.type === 'cancel-qr' ||
          confirmation?.type === 'cancel-selected' ||
          confirmation?.type === 'reject-combo'
        }
        pending={pendingMutation}
        confirmDisabled={confirmNeedsQrAck && !qrCancelAck}
        onCancel={closeConfirmation}
        onConfirm={confirmAction}
      >
        {confirmation?.type === 'accept-combo' ? (
          <div className="order-confirm-stack">
            <InlineAlert tone="warning">Xác nhận này có nghĩa là quầy đã nhận đủ tiền mặt.</InlineAlert>
            <dl className="order-confirm-summary">
              <div><dt>Combo</dt><dd>{confirmation.order.comboName}</dd></div>
              <div><dt>Số tiền</dt><dd>{formatMoney(confirmation.order.price)}</dd></div>
              <div><dt>Thẻ combo</dt><dd>{confirmation.order.comboUserName}</dd></div>
            </dl>
          </div>
        ) : confirmNeedsQrAck ? (
          <div className="order-confirm-stack">
            <InlineAlert tone="danger">{QR_CANCEL_WARNING}</InlineAlert>
            <label className="order-confirm-ack">
              <input
                type="checkbox"
                checked={qrCancelAck}
                onChange={(event) => setQrCancelAck(event.target.checked)}
              />
              Tôi hiểu: phải hoàn tiền thủ công cho khách.
            </label>
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
