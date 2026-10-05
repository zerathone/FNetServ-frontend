import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle, CurrencyCircleDollar, HandCoins, MagnifyingGlass, XCircle } from '@phosphor-icons/react'
import { ApiError, RbacDeniedError } from '../../api/client'
import { describeApiErrorCode } from '../../lib/apiErrorText'
import {
  payRequest,
  payRequestDryRun,
  type PayRequestDryRunResponse,
  type PayRequestPayload,
  type PayRequestResponse,
} from '../../api/payment'
import { getWorkstationsRuntime } from '../../api/workstations'
import {
  acceptComboOrder,
  acceptServiceOrder,
  cancelServiceOrder,
  getAcceptedUnpaidSummary,
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
  Select,
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
  ORDER_RIGHTS,
  QTY_MAX,
  QTY_MIN,
  canChangeQuantity,
  clampQuantity,
  describeInventoryWarnings,
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
import {
  SERVICE_EXCEPT_RIGHT,
  classifyPayError,
  classifyPayResult,
  describeAlertReason,
  dryRunPayload,
  formatVnd,
  payFingerprint,
  payGates,
  payPayload,
  removeAlert,
  upsertAlert,
  type DeductAlert,
  type MachineLookup,
  type PayMethod,
} from './orderPayModel'
import './orders.css'

const PAGE_SIZE = 20
// Parity ds-button__icon (design-system/components/Button.tsx actionIconProps) — icon hành động.
const actionIconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true as const }

type QueueEntry =
  | { kind: 'qr'; key: string; group: QrGroup }
  | { kind: 'service'; key: string; order: GroupedOrder }

// task orders-qr-qty P5: Chấp nhận / Xác nhận phục vụ KHÔNG còn hộp xác nhận (parity Qt — thu ngân
// bấm liên tục; idem vẫn bắt buộc). Chỉ hủy/từ chối và combo tiền mặt còn hỏi lại.
type Confirmation =
  // service-payrequest-core: Thanh toán / Cấn trừ LUÔN hỏi lại (tiền thật) và đi qua `dryRun` trước —
  // `preview` là số BE tính lại, hộp xác nhận hiển thị số đó chứ không phải số trên thẻ.
  | { type: 'pay-cash'; order: GroupedOrder; preview: PayRequestDryRunResponse }
  | { type: 'pay-deduct'; order: GroupedOrder; preview: PayRequestDryRunResponse }
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

/** userId là key nội bộ, không bắt nhân viên gõ số — lọc theo tên khách (parity `matchesHost`). */
function matchesCustomer(userName: string | null | undefined, filter: string) {
  if (!filter) return true
  return (userName ?? '').toLocaleLowerCase('vi').includes(filter.toLocaleLowerCase('vi'))
}

export function OrderWorkspace() {
  const queryClient = useQueryClient()
  const connected = useWsStatusStore((state) => state.connected)
  const staffId = useAuthStore((state) => state.staffId)
  // task orders-qr-qty P5: Hủy/Từ chối cần R_DELETE_ORDER (44). Chỉ là UX — backend vẫn chặn.
  const canCancel = useAuthStore((state) => state.hasRight(ORDER_RIGHTS.DELETE_ORDER))
  const cancelTitle = canCancel ? undefined : `Thiếu quyền hủy đơn (${ORDER_RIGHTS.DELETE_ORDER})`
  // service-payrequest-core: chỉ Cấn trừ cần 9224 (Thanh toán tiền mặt thì không — parity Qt). Chỉ là UX.
  const canDeduct = useAuthStore((state) => state.hasRight(SERVICE_EXCEPT_RIGHT))
  const customerNameFilter = useOrderQueueStore((state) => state.customerNameFilter)
  const hostName = useOrderQueueStore((state) => state.hostName)
  const setCustomerNameFilter = useOrderQueueStore((state) => state.setCustomerNameFilter)
  const setHostName = useOrderQueueStore((state) => state.setHostName)
  // 'all' (= tile "Đơn chờ") hiện cả 3 nhóm cùng lúc; 3 giá trị còn lại lọc đúng 1 nhóm.
  const [activeView, setActiveView] = useState<'all' | 'service' | 'paid' | 'combo'>('all')
  // Gộp 2 ô lọc cũ thành 1 thanh search (parity /logs/system): dropdown chọn trường, 1 ô nhập.
  const [searchField, setSearchField] = useState<'customer' | 'host'>('customer')
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
  const payIntent = useIdempotentIntent('order-pay')
  // Banner cố định "đã ghi phiếu cấn trừ nhưng chưa trừ ví" — KHÔNG phải toast tự tắt (KNOWLEDGE §47).
  const [deductAlerts, setDeductAlerts] = useState<DeductAlert[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    setQrCancelAck(false)
  }, [confirmation])

  const servicesQuery = useQuery({
    // Khóa riêng 'with-paid': trang /orders/legacy dùng dạng response cũ (không includePaid).
    // Luôn tải hết mọi khách (không round-trip theo userId) — lọc theo tên khách ở client, parity hostName.
    queryKey: ['pending-orders', 'with-paid'],
    queryFn: () => getPendingOrders(undefined, { includePaid: true }),
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const comboQuery = useQuery({
    queryKey: ['pending-orders-combo'],
    queryFn: getPendingComboOrders,
    refetchInterval: connected ? 30_000 : 5_000,
  })
  // Đơn đã bấm "Chấp nhận" (Accept=1) nên không còn nằm trong servicesQuery (chỉ Accept=0), nhưng
  // khách vẫn CHƯA thanh toán (ServicePaid=0) -- về nghiệp vụ vẫn "chờ giải quyết". Toàn hệ thống,
  // không theo bộ lọc máy/khách đang gõ trên trang.
  const acceptedUnpaidQuery = useQuery({
    queryKey: ['orders-accepted-unpaid-summary'],
    queryFn: getAcceptedUnpaidSummary,
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const acceptedUnpaid = acceptedUnpaidQuery.data ?? { count: 0, amount: 0 }

  // Dùng chung cache `['workstations']` với trang Máy trạm (cùng queryFn). Chỉ để bật/tắt nút theo
  // trạng thái máy / loại tài khoản (parity Qt) — lỗi hoặc chưa tải ⇒ KHÔNG chặn gì, backend vẫn kiểm.
  const workstationsQuery = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    refetchInterval: connected ? 30_000 : 10_000,
    retry: false,
  })
  const machineByHost = useMemo(() => {
    const items = workstationsQuery.data?.items
    if (!items) return undefined
    return new Map(items.map((machine) => [machine.hostName.toLocaleLowerCase('vi'), machine]))
  }, [workstationsQuery.data])
  const machineFor = (host: string | null | undefined): MachineLookup => {
    if (!machineByHost || !host) return undefined
    return machineByHost.get(host.toLocaleLowerCase('vi')) ?? null
  }

  const groupedOrders = useMemo(
    () =>
      groupOrders(servicesQuery.data ?? []).filter(
        (order) => matchesHost(order.hostName, hostName) && matchesCustomer(order.userName, customerNameFilter),
      ),
    [hostName, customerNameFilter, servicesQuery.data],
  )
  const qrGroups = useMemo(
    () =>
      groupQrOrders(servicesQuery.data ?? []).filter(
        (group) => matchesHost(group.hostName, hostName) && matchesCustomer(group.userName, customerNameFilter),
      ),
    [hostName, customerNameFilter, servicesQuery.data],
  )
  // Đơn QR (khách đã trả tiền, đang chờ món) xếp TRÊN CÙNG, không lẫn vào đơn thường.
  const serviceEntries = useMemo<QueueEntry[]>(
    () => [
      ...qrGroups.map((group) => ({ kind: 'qr' as const, key: qrSelectKey(group), group })),
      ...groupedOrders.map((order) => ({ kind: 'service' as const, key: serviceSelectKey(order), order })),
    ],
    [groupedOrders, qrGroups],
  )
  // activeView lọc đúng 1 loại dòng; 'all' (tile "Đơn chờ") giữ nguyên cả hai lẫn nhau như cũ.
  const visibleEntryKind = activeView === 'service' ? 'service' : activeView === 'paid' ? 'qr' : null
  const filteredServiceEntries = useMemo(
    () => (visibleEntryKind ? serviceEntries.filter((entry) => entry.kind === visibleEntryKind) : serviceEntries),
    [serviceEntries, visibleEntryKind],
  )
  const showServicePanel = activeView !== 'combo'
  const showComboPanel = activeView === 'all' || activeView === 'combo'
  const comboOrders = useMemo(
    () =>
      (comboQuery.data ?? [])
        .filter(
          (order) =>
            matchesHost(order.hostName, hostName) && matchesCustomer(order.ownerName, customerNameFilter),
        )
        .sort(
          (left, right) =>
            parseComboCreatedAt(left.createdAt) - parseComboCreatedAt(right.createdAt),
        ),
    [comboQuery.data, hostName, customerNameFilter],
  )
  const serviceTotalPages = Math.max(1, Math.ceil(filteredServiceEntries.length / PAGE_SIZE))
  const comboTotalPages = Math.max(1, Math.ceil(comboOrders.length / PAGE_SIZE))
  const visibleServiceEntries = filteredServiceEntries.slice(
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
  }, [hostName, customerNameFilter, activeView])

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
      const lowStock = describeInventoryWarnings(response.inventoryWarnings)
      if (lowStock) pushToast(lowStock, 'info')
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
      const lowStock = describeInventoryWarnings(response.inventoryWarnings)
      if (lowStock) pushToast(lowStock, 'info')
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

  // ===== service-payrequest-core: Thanh toán tiền mặt / Cấn trừ (nhánh `fullCore`) =====
  const reportPayError = (error: unknown) => {
    // client.ts đã tự toast thông báo RBAC_DENIED của backend — không toast lần hai.
    if (!(error instanceof RbacDeniedError)) {
      pushToast(error instanceof Error ? error.message : 'Không xử lý được đơn.', 'error')
    }
    const code = error instanceof ApiError ? error.code : undefined
    const plan = classifyPayError(code)
    if (plan.resetKey) payIntent.clearKey()
    if (plan.refetch) refreshServiceQueue()
    // Lỗi nghiệp vụ (có `code`) = backend đã từ chối, 0 ghi ⇒ đóng hộp. Lỗi mạng/timeout (không có
    // `code`) thì GIỮ hộp mở: bấm lại gửi đúng `idem` cũ nên không thu hai lần.
    if (error instanceof ApiError && error.code) setConfirmation(null)
  }

  // Một lối duy nhất cho cả lần bấm đầu và "Thử trừ ví lại" — `status=1` không có nghĩa là đã trừ ví.
  const handlePayResponse = (
    method: PayMethod,
    response: PayRequestResponse,
    request: PayRequestPayload,
    who: { hostName: string; customerLabel: string },
  ) => {
    const outcome = classifyPayResult(method, response)
    const paymentId = response.paymentId ?? 0
    if (outcome.kind === 'manual-fix') {
      setDeductAlerts((current) =>
        upsertAlert(current, {
          paymentId,
          hostName: who.hostName,
          customerLabel: who.customerLabel,
          amount: response.amount ?? response.total ?? 0,
          code: outcome.code,
          retryable: outcome.retryable,
          request,
        }),
      )
      pushToast(`${outcome.message} Xem cảnh báo ở đầu trang.`, 'error')
    } else {
      if (paymentId) setDeductAlerts((current) => removeAlert(current, paymentId))
      if (outcome.clearKey) payIntent.clearKey()
      pushToast(outcome.message, outcome.kind === 'success' ? 'success' : 'info')
    }
    setConfirmation(null)
    clearOverrides(request.items.map((item) => item.detailId))
    refreshServiceQueue()
    void invalidateMoneyQueries(queryClient)
  }

  const previewMutation = useMutation({
    mutationFn: ({ order, method }: { order: GroupedOrder; method: PayMethod }) =>
      payRequestDryRun(dryRunPayload(method, order, staffId ?? 0, qtyOverrides)),
    onSuccess: (preview, { order, method }) => {
      setConfirmation({ type: method === 'cash' ? 'pay-cash' : 'pay-deduct', order, preview })
      if (preview.code === 'invalid_lines') refreshServiceQueue()
    },
    onError: reportPayError,
  })

  const payMutation = useMutation({
    mutationFn: async ({ order, method }: { order: GroupedOrder; method: PayMethod }) => {
      // Fingerprint gồm hình thức + khách + từng dòng (detailId, SL) ⇒ đổi bất kỳ thứ gì là `idem` mới.
      const idem = payIntent.getKey(fingerprintIntent(payFingerprint(method, order, qtyOverrides)))
      const request = payPayload(method, order, staffId ?? 0, idem, qtyOverrides)
      return { response: await payRequest(request), request }
    },
    onSuccess: ({ response, request }, { order, method }) =>
      handlePayResponse(method, response, request, {
        hostName: order.hostName || '',
        // userId là key nội bộ — không hiển thị ra UI, kể cả khi thiếu userName.
        customerLabel: order.userName || 'Hội viên (chưa rõ tên)',
      }),
    onError: reportPayError,
  })

  // "Thử trừ ví lại": gửi lại ĐÚNG request cũ (cùng `idem`). Backend nhận ra phiếu đã ghi và chỉ chạy lại
  // bước trừ ví (trạng thái a) — không tạo phiếu thứ hai, không trừ hai lần.
  const retryDeductMutation = useMutation({
    mutationFn: async (alert: DeductAlert) => ({
      response: await payRequest(alert.request),
      alert,
    }),
    onSuccess: ({ response, alert }) =>
      handlePayResponse('deduct', response, alert.request, {
        hostName: alert.hostName,
        customerLabel: alert.customerLabel,
      }),
    onError: reportPayError,
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
    previewMutation.isPending ||
    payMutation.isPending ||
    retryDeductMutation.isPending ||
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
      case 'pay-cash':
        payMutation.mutate({ order: confirmation.order, method: 'cash' })
        break
      case 'pay-deduct':
        payMutation.mutate({ order: confirmation.order, method: 'deduct' })
        break
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
          disabled={pendingMutation || !canCancel}
          title={cancelTitle}
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
    // Parity Qt `OnOffRequestFunction`: trạng thái máy / loại tài khoản khoá Chấp nhận, Thanh toán,
    // Cấn trừ và đổi số lượng. Chưa có dữ liệu máy ⇒ không chặn (backend vẫn kiểm).
    const gates = payGates(order, machineFor(order.hostName), canDeduct)
    const editable = canChangeQuantity(order) && gates.accept.enabled
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
            <span>
              {formatMoney(lineAmount(order, qtyOverrides))} · {getServicePaidLabel(order.servicePaid)}
            </span>
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
            variant="secondary"
            icon={<CheckCircle {...actionIconProps} />}
            disabled={pendingMutation || !gates.accept.enabled}
            title={gates.accept.reason}
            onClick={() => serviceMutation.mutate(order)}
          >
            Chấp nhận
          </Button>
          <Button
            type="button"
            variant="primary"
            icon={<CurrencyCircleDollar {...actionIconProps} />}
            disabled={pendingMutation || !gates.cash.enabled}
            title={gates.cash.reason ?? 'Thu tiền mặt và chốt đơn ngay'}
            onClick={() => previewMutation.mutate({ order, method: 'cash' })}
          >
            Thanh toán
          </Button>
          <Button
            type="button"
            variant="secondary"
            icon={<HandCoins {...actionIconProps} />}
            disabled={pendingMutation || !gates.deduct.enabled}
            title={gates.deduct.reason ?? 'Trừ vào tài khoản hội viên đang online'}
            onClick={() => previewMutation.mutate({ order, method: 'deduct' })}
          >
            Cấn trừ
          </Button>
          <Button
            type="button"
            variant="danger-outline"
            icon={<XCircle {...actionIconProps} />}
            disabled={pendingMutation || !canCancel}
            title={cancelTitle}
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

      {deductAlerts.map((alert) => (
        <InlineAlert key={alert.paymentId} tone="danger">
          <div className="order-deduct-alert">
            <strong>
              Đã ghi phiếu cấn trừ #{alert.paymentId} ({formatVnd(alert.amount)}) cho{' '}
              {alert.hostName || 'máy ??'} · {alert.customerLabel} nhưng CHƯA trừ ví hội viên.
            </strong>
            <span>Đã ghi log “Cấn trừ lỗi” vào nhật ký hệ thống. {describeAlertReason(alert.code)}</span>
            <small>
              Cảnh báo này mất khi tải lại trang — nhật ký “Cấn trừ lỗi” là nơi xử lý chính.
            </small>
            <div className="order-deduct-alert__actions">
              {alert.retryable ? (
                <Button
                  type="button"
                  variant="primary"
                  loading={retryDeductMutation.isPending}
                  disabled={pendingMutation}
                  onClick={() => retryDeductMutation.mutate(alert)}
                >
                  Thử trừ ví lại
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                disabled={retryDeductMutation.isPending}
                onClick={() => setDeductAlerts((current) => removeAlert(current, alert.paymentId))}
              >
                Đã xử lý / Đóng
              </Button>
            </div>
          </div>
        </InlineAlert>
      ))}

      <div className="order-summary" aria-label="Tổng quan đơn chờ">
        <div className="order-summary__card">
          <button
            type="button"
            className={`order-summary__total ${activeView === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveView('all')}
          >
            <span>Đơn chờ</span>
            <strong>{groupedOrders.length + qrGroups.length + comboOrders.length}</strong>
          </button>
          <div className="order-summary__breakdown">
            <button
              type="button"
              className={`order-summary__row order-summary__service ${activeView === 'service' ? 'is-active' : ''}`}
              onClick={() => setActiveView('service')}
            >
              <span className="order-summary__dot order-summary__dot--service" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Dịch vụ</span>
                <small className="order-summary__hint">Cần thu {formatMoney(serviceTotal)}</small>
              </span>
              <strong>{groupedOrders.length}</strong>
            </button>
            <button
              type="button"
              className={`order-summary__row order-summary__paid ${activeView === 'paid' ? 'is-active' : ''} ${qrGroups.length > 0 ? 'has-value' : ''}`}
              onClick={() => setActiveView('paid')}
            >
              <span className="order-summary__dot order-summary__dot--paid" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Đã thanh toán</span>
                <small className="order-summary__hint">Đã thu {formatMoney(qrPaidTotal)}</small>
              </span>
              <strong>{qrGroups.length}</strong>
            </button>
            <button
              type="button"
              className={`order-summary__row order-summary__combo ${activeView === 'combo' ? 'is-active' : ''}`}
              onClick={() => setActiveView('combo')}
            >
              <span className="order-summary__dot order-summary__dot--combo" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Combo</span>
                <small className="order-summary__hint">{formatMoney(comboTotal)}</small>
              </span>
              <strong>{comboOrders.length}</strong>
            </button>
            {/* Đơn đã duyệt nhưng chưa thu tiền -- toàn hệ thống, không nằm trong 3 nhóm lọc ở trên
                (activeView) nên chỉ hiển thị thông tin, không bấm được. */}
            <div
              className="order-summary__row order-summary__accepted-unpaid"
              title={`Đơn đã bấm Chấp nhận nhưng khách chưa thanh toán -- vẫn đang chờ giải quyết (${formatMoney(acceptedUnpaid.amount)})`}
            >
              <span className="order-summary__dot order-summary__dot--accepted-unpaid" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Đã chấp nhận - chưa thanh toán</span>
                <small className="order-summary__hint">{formatMoney(acceptedUnpaid.amount)}</small>
              </span>
              <strong>{acceptedUnpaid.count}</strong>
            </div>
          </div>
        </div>
      </div>

      <div className="order-filters">
        <label className="ds-field" style={{ flex: 1 }}>
          <span className="ds-visually-hidden">Tìm kiếm</span>
          <div className="ds-input-group ds-input-group--search">
            <Select
              value={searchField}
              onChange={(event) => setSearchField(event.target.value as 'customer' | 'host')}
            >
              <option value="customer">Tài khoản</option>
              <option value="host">Tên máy</option>
            </Select>
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                className="ds-input"
                type="search"
                placeholder={searchField === 'host' ? 'Nhập tên máy' : 'Nhập tên tài khoản'}
                value={searchField === 'host' ? hostName : customerNameFilter}
                onChange={(event) =>
                  searchField === 'host'
                    ? setHostName(event.target.value)
                    : setCustomerNameFilter(event.target.value)
                }
              />
              {(searchField === 'host' ? hostName : customerNameFilter) ? (
                <button
                  type="button"
                  className="ds-search-input__clear"
                  aria-label="Xóa từ khóa tìm kiếm"
                  title="Xóa từ khóa"
                  onClick={() => (searchField === 'host' ? setHostName('') : setCustomerNameFilter(''))}
                >
                  <XCircle size={17} weight="fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
        </label>
        {hostName || customerNameFilter ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setHostName('')
              setCustomerNameFilter('')
            }}
          >
            Xóa bộ lọc
          </Button>
        ) : null}
      </div>

      {showServicePanel ? (
        <div className="order-panel">
          {activeView === 'all' ? <h3 className="order-panel__heading">Dịch vụ &amp; đã thanh toán</h3> : null}
          {selectedEntries.length > 0 ? (
            <div className="order-selection">
              <strong>{selectedEntries.length} đơn đã chọn</strong>
              <div>
                <Button
                  type="button"
                  variant="danger"
                  disabled={!canCancel}
                  title={cancelTitle}
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
          ) : filteredServiceEntries.length === 0 ? (
            <StateView
              title={
                activeView === 'paid'
                  ? 'Không có đơn đã thanh toán đang chờ món'
                  : 'Không có đơn dịch vụ đang chờ'
              }
              description={
                hostName || customerNameFilter
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
      ) : null}

      {showComboPanel ? (
        <div className="order-panel">
          {activeView === 'all' ? <h3 className="order-panel__heading">Combo chờ duyệt</h3> : null}
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
                        variant="danger-outline"
                        icon={<XCircle {...actionIconProps} />}
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
      ) : null}

      <ConfirmAction
        open={Boolean(confirmation)}
        title={
          confirmation?.type === 'pay-cash'
            ? 'Xác nhận đã thu tiền mặt?'
            : confirmation?.type === 'pay-deduct'
              ? 'Cấn trừ vào tài khoản hội viên?'
              : confirmation?.type === 'cancel-qr'
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
          confirmation?.type === 'cancel-service' ||
          confirmation?.type === 'pay-cash' ||
          confirmation?.type === 'pay-deduct'
            ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.userName || 'Khách vãng lai'}`
            : confirmation?.type === 'cancel-qr'
              ? `${confirmation.group.hostName || 'Chưa xác định máy'} · ${confirmation.group.userName || 'Khách vãng lai'}`
              : confirmation?.type === 'accept-combo' ||
                  confirmation?.type === 'reject-combo'
                ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.comboName}`
                : undefined
        }
        confirmLabel={
          confirmation?.type === 'accept-combo'
            ? 'Xác nhận đã thu tiền'
            : confirmation?.type === 'pay-cash'
              ? 'Đã thu tiền mặt'
              : confirmation?.type === 'pay-deduct'
                ? 'Cấn trừ'
                : 'Xác nhận hủy'
        }
        danger={
          confirmation?.type === 'cancel-service' ||
          confirmation?.type === 'cancel-qr' ||
          confirmation?.type === 'cancel-selected' ||
          confirmation?.type === 'reject-combo'
        }
        pending={pendingMutation}
        // Thanh toán/Cấn trừ: `ok:false` ⇒ hiện lý do của backend và KHÔNG cho xác nhận.
        confirmDisabled={
          (confirmNeedsQrAck && !qrCancelAck) ||
          ((confirmation?.type === 'pay-cash' || confirmation?.type === 'pay-deduct') &&
            confirmation.preview.ok === false)
        }
        onCancel={closeConfirmation}
        onConfirm={confirmAction}
      >
        {confirmation?.type === 'pay-cash' || confirmation?.type === 'pay-deduct' ? (
          <div className="order-confirm-stack">
            {confirmation.preview.ok === false ? (
              <InlineAlert tone="danger">
                {confirmation.preview.message || 'Không thực hiện được.'}
              </InlineAlert>
            ) : confirmation.type === 'pay-cash' ? (
              <InlineAlert tone="warning">
                Chỉ xác nhận sau khi đã nhận đủ tiền mặt. Số tiền do máy chủ tính lại từ dữ liệu đơn.
              </InlineAlert>
            ) : (
              <InlineAlert tone="warning">
                Trừ trực tiếp vào tài khoản chính của hội viên đang online tại máy này. Không hoàn tác được từ trang này.
              </InlineAlert>
            )}
            <dl className="order-confirm-summary">
              <div><dt>Món</dt><dd>{1 + confirmation.order.children.length} dòng</dd></div>
              <div>
                <dt>{confirmation.type === 'pay-cash' ? 'Cần thu' : 'Tổng phí cấn trừ'}</dt>
                <dd>
                  {typeof confirmation.preview.total === 'number'
                    ? formatMoney(confirmation.preview.total)
                    : formatMoney(orderAmount(confirmation.order, qtyOverrides))}
                </dd>
              </div>
              {confirmation.type === 'pay-deduct' && confirmation.preview.memberName ? (
                <div><dt>Hội viên</dt><dd>{confirmation.preview.memberName}</dd></div>
              ) : null}
              {confirmation.type === 'pay-deduct' && typeof confirmation.preview.walletMain === 'number' ? (
                <>
                  <div><dt>Tài khoản chính</dt><dd>{formatMoney(confirmation.preview.walletMain)}</dd></div>
                  {typeof confirmation.preview.total === 'number' ? (
                    <div>
                      <dt>Còn lại sau khi trừ</dt>
                      <dd>{formatMoney(confirmation.preview.walletMain - confirmation.preview.total)}</dd>
                    </div>
                  ) : null}
                </>
              ) : null}
              <div><dt>Khách chọn trên máy</dt><dd>{getServicePaidLabel(confirmation.order.servicePaid)}</dd></div>
            </dl>
          </div>
        ) : confirmation?.type === 'accept-combo' ? (
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
