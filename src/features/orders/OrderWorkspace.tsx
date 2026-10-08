import { Fragment, useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowsLeftRight,
  Bank,
  CheckCircle,
  CurrencyCircleDollar,
  HandCoins,
  Hourglass,
  MagnifyingGlass,
  Plus,
  Printer,
  QrCode,
  XCircle,
} from '@phosphor-icons/react'
import { ApiError, RbacDeniedError } from '../../api/client'
import { describeApiErrorCode } from '../../lib/apiErrorText'
import {
  clearAcceptedService,
  payRequest,
  payRequestDryRun,
  servicePayDryRun,
  servicePayFullCore,
  type PayRequestDryRunResponse,
  type PayRequestResponse,
  type ServicePayDryRunPayload,
  type ServicePayFullCorePayload,
} from '../../api/payment'
import { getWorkstationsRuntime } from '../../api/workstations'
import {
  acceptComboOrder,
  acceptServiceOrder,
  cancelServiceOrder,
  getAcceptedUnpaidOrders,
  getCompletedOrderStats,
  getCompletedTodayOrders,
  getPendingComboOrders,
  getPendingOrders,
  getServicePaidLabel,
  rejectComboOrder,
  type CompletedPaymentMethod,
  type PendingComboOrder,
  type PendingOrder,
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
  COMPLETED_METHOD_LABEL,
  ORDER_RIGHTS,
  QTY_MAX,
  QTY_MIN,
  acceptedUnpaidDetailIds,
  acceptedUnpaidSelectKey,
  canChangeQuantity,
  clampQuantity,
  clearAcceptedVouchers,
  describeInventoryWarnings,
  describeProcessedCount,
  groupAcceptedUnpaidOrders,
  groupCompletedOrders,
  groupOrders,
  groupQrOrders,
  orderAmount,
  qrAcceptItems,
  qrCancelItems,
  qrSelectKey,
  quantityOf,
  serviceCancelItems,
  serviceItems,
  serviceSelectKey,
  unitPriceOf,
  type AcceptedUnpaidGroup,
  type CancelItem,
  type CompletedGroup,
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
  type DeductRetry,
  type MachineLookup,
  type PayMethod,
} from './orderPayModel'
import { PrintTicketDialog } from './PrintTicketDialog'
import { StaffOrderDialog } from './StaffOrderDialog'
import './orders.css'
import './staffOrder.css'

const PAGE_SIZE = 20
// Parity ds-button__icon (design-system/components/Button.tsx actionIconProps) — icon hành động.
const actionIconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true as const }

type QueueEntry =
  | { kind: 'qr'; key: string; group: QrGroup }
  | { kind: 'service'; key: string; order: GroupedOrder }
  // task orders-accepted-merge (2026-10-06): gộp vào CHUNG danh sách với 'service' -- cùng bảng
  // ServiceDetailTb, chỉ khác Accept/ServicePaid nên khác nút hành động, không khác về hiển thị.
  | { kind: 'accepted-unpaid'; key: string; group: AcceptedUnpaidGroup }

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
  // Đơn ĐÃ DUYỆT còn nợ tiền — `/service/pay` nhánh `fullCore` (task service-pay-fullcore): cũng
  // đi qua `dryRun` trước, `preview` là số BE tính lại (+ số dư ví khi cấn trừ).
  | { type: 'au-pay-cash'; group: AcceptedUnpaidGroup; preview: PayRequestDryRunResponse }
  | { type: 'au-pay-deduct'; group: AcceptedUnpaidGroup; preview: PayRequestDryRunResponse }
  | { type: 'au-clear'; group: AcceptedUnpaidGroup }
  | { type: 'au-clear-selected'; keys: string[] }
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

/** BE trả "YYYY-MM-DD HH:MM:SS" (date_to + time_to) -- đổi sang dd/mm/yyyy hh:mm cho card combo. */
function formatExpireDate(value?: string) {
  if (!value) return '--'
  const parsed = new Date(value.trim().replace(' ', 'T'))
  if (Number.isNaN(parsed.getTime())) return value
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(parsed.getDate())}/${pad(parsed.getMonth() + 1)}/${parsed.getFullYear()} ${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`
}

/** zone = tên các nhóm máy nối bằng '|' (DAOCombo::get) -- đổi dấu nối sang "·" cho dễ đọc. */
function formatZoneList(value: string) {
  return value
    .split('|')
    .map((part) => part.trim())
    .filter(Boolean)
    .join(' · ')
}

function waitMinutes(createdAtMs: number, now: number) {
  if (!createdAtMs) return null
  return Math.max(0, Math.floor((now - createdAtMs) / 60_000))
}

function waitLabel(createdAtMs: number, now: number) {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return '–'
  if (minutes < 1) return 'vừa gọi'
  if (minutes < 60) return `${minutes}p`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h}g` : `${h}g ${m}p`
}

function waitTone(createdAtMs: number, now: number): 'neutral' | 'info' | 'warning' | 'danger' {
  const minutes = waitMinutes(createdAtMs, now)
  if (minutes === null) return 'neutral'
  if (minutes >= 20) return 'danger'
  if (minutes >= 10) return 'warning'
  return 'info'
}

// Đồng bộ màu với chấm ở nút thống kê "Hoàn thành" (.order-summary__dot--*, orders.css).
const COMPLETED_METHOD_TONE: Record<CompletedPaymentMethod, 'neutral' | 'success' | 'warning' | 'info'> = {
  cash: 'success',
  qr: 'warning',
  deduct: 'info',
  online: 'success',
  transfer: 'neutral',
}

// Icon thay cho chấm màu ở nút thống kê "Hoàn thành" -- cùng icon với action tương ứng trong trang
// (CurrencyCircleDollar/HandCoins đã dùng cho nút Thanh toán/Cấn trừ ở thẻ đơn).
const COMPLETED_METHOD_ICON: Record<CompletedPaymentMethod, typeof CheckCircle> = {
  cash: CurrencyCircleDollar,
  qr: QrCode,
  deduct: HandCoins,
  online: Bank,
  transfer: ArrowsLeftRight,
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
  // 'all' (= tile "Đơn chờ") hiện CẢ 4 nhóm (user chốt 2026-10-05: đơn đã duyệt còn nợ vẫn là "đơn
  // chờ" trên Web UI — Qt giữ cách cũ, không hiện); các giá trị còn lại lọc đúng 1 nhóm.
  // 'accepted-unpaid' không dùng chung selectedKeys/bulk-cancel vì endpoint xử lý khác hẳn
  // (xem renderAcceptedUnpaidCard).
  // 'completed' (tile "Đơn hoàn thành") NẰM NGOÀI "Đơn chờ" -- đơn đã đóng, không còn "chờ giải
  // quyết" gì nữa, nên không gộp vào view 'all'.
  const [activeView, setActiveView] = useState<
    'all' | 'service' | 'paid' | 'combo' | 'accepted-unpaid' | 'completed'
  >('all')
  // Lọc thêm trong view 'completed' theo hình thức thu (bấm dòng breakdown của tile); null = tất cả.
  const [completedMethod, setCompletedMethod] = useState<CompletedPaymentMethod | null>(null)
  // Gộp 2 ô lọc cũ thành 1 thanh search (parity /logs/system): dropdown chọn trường, 1 ô nhập.
  const [searchField, setSearchField] = useState<'customer' | 'host'>('customer')
  // servicePage giờ phân trang CHUNG cho danh sách đã gộp (Dịch vụ + QR + Đã duyệt-chưa thanh toán).
  const [servicePage, setServicePage] = useState(0)
  const [comboPage, setComboPage] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  // Khóa chọn riêng (acceptedUnpaidSelectKey) -- KHÔNG dùng chung `selectedKeys`/`cancelMutation` của
  // Dịch vụ: đó là `/service/cancel` (chỉ Accept=0), gọi nhầm cho Accept=1 sẽ hỏng dữ liệu (KNOWLEDGE.md §50).
  const [selectedAcceptedUnpaidKeys, setSelectedAcceptedUnpaidKeys] = useState<Set<string>>(new Set())
  const [confirmation, setConfirmation] = useState<Confirmation>(null)
  // task staff-service-order: "Gọi món hộ" (FE-1) + "In phiếu" theo đơn (FE-2). `printDetailIds` != null ⇒
  // hộp thoại in đang mở; hộp thoại Gọi món hộ tạm ẩn (không xếp chồng 2 modal) nhưng GIỮ state.
  const [staffOrderOpen, setStaffOrderOpen] = useState(false)
  const [printDetailIds, setPrintDetailIds] = useState<number[] | null>(null)
  const [qrCancelAck, setQrCancelAck] = useState(false)
  const [qtyOverrides, setQtyOverrides] = useState<QtyOverrides>({})
  const [now, setNow] = useState(() => Date.now())
  const serviceIntent = useIdempotentIntent('order-svc')
  const qrIntent = useIdempotentIntent('order-qr')
  const comboAcceptIntent = useIdempotentIntent('order-cb-acc')
  const comboRejectIntent = useIdempotentIntent('order-cb-rej')
  const payIntent = useIdempotentIntent('order-pay')
  const acceptedUnpaidPayIntent = useIdempotentIntent('order-au-pay')
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
  // khách vẫn CHƯA thanh toán (ServicePaid IN 0,4,5) -- về nghiệp vụ vẫn "chờ giải quyết". Toàn hệ
  // thống, không theo bộ lọc máy/khách đang gõ trên trang (lọc máy/khách áp riêng ở client giống
  // servicesQuery/comboQuery bên dưới).
  const acceptedUnpaidQuery = useQuery({
    queryKey: ['orders-accepted-unpaid'],
    queryFn: () => getAcceptedUnpaidOrders(),
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const acceptedUnpaidGroups = useMemo(
    () =>
      groupAcceptedUnpaidOrders(acceptedUnpaidQuery.data ?? []).filter(
        (group) => matchesHost(group.hostName, hostName) && matchesCustomer(group.userName, customerNameFilter),
      ),
    [acceptedUnpaidQuery.data, hostName, customerNameFilter],
  )
  const acceptedUnpaidTotal = acceptedUnpaidGroups.reduce((sum, group) => sum + group.total, 0)
  // Thanh toán/hủy ở trang này đổi luôn "Đơn hoàn thành" -- làm mới chung prefix ['orders-completed'].
  const refreshCompleted = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders-completed'] })
  }
  const refreshAcceptedUnpaid = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders-accepted-unpaid'] })
    refreshCompleted()
  }

  // Đơn dịch vụ đã thu tiền XONG hôm nay -- bấm vào card xem danh sách từng phiếu (giống Đã thanh
  // toán QR/Đã chấp nhận), lọc theo máy/khách đang gõ trên trang giống các nhóm khác.
  const completedTodayQuery = useQuery({
    queryKey: ['orders-completed', 'list'],
    queryFn: getCompletedTodayOrders,
    refetchInterval: connected ? 30_000 : 5_000,
  })
  // Số trên tile lấy từ BE (toàn quán, không theo ô tìm kiếm): cùng tập dòng với danh sách nên tổng
  // khớp nhau, và có số hủy mà danh sách không có.
  const completedStatsQuery = useQuery({
    queryKey: ['orders-completed', 'stats'],
    queryFn: getCompletedOrderStats,
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const completedStats = completedStatsQuery.data
  const completedGroups = useMemo(
    () =>
      groupCompletedOrders(completedTodayQuery.data ?? []).filter(
        (group) =>
          (!completedMethod || group.paymentMethod === completedMethod) &&
          matchesHost(group.hostName, hostName) &&
          matchesCustomer(group.userName, customerNameFilter),
      ),
    [completedTodayQuery.data, completedMethod, hostName, customerNameFilter],
  )
  const showCompleted = (method: CompletedPaymentMethod | null) => {
    setActiveView('completed')
    setCompletedMethod(method)
  }

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
  // task orders-accepted-merge (2026-10-06, user chốt): 'service' (Accept=0) + 'accepted-unpaid'
  // (Accept=1, chưa thu tiền) gộp CHUNG 1 danh sách theo thời gian chờ -- cùng bảng ServiceDetailTb,
  // chỉ khác NÚT hành động (renderServiceCard/renderAcceptedUnpaidCard tự chọn theo state của chính
  // nó), không còn tách panel/heading riêng như trước.
  const serviceAndAcceptedEntries = useMemo<QueueEntry[]>(
    () =>
      [
        ...groupedOrders.map((order) => ({ kind: 'service' as const, key: serviceSelectKey(order), order })),
        ...acceptedUnpaidGroups.map((group) => ({
          kind: 'accepted-unpaid' as const,
          key: acceptedUnpaidSelectKey(group),
          group,
        })),
      ].sort((left, right) => {
        const l = left.kind === 'service' ? left.order.createdAtMs : left.group.createdAtMs
        const r = right.kind === 'service' ? right.order.createdAtMs : right.group.createdAtMs
        if (!l) return 1
        if (!r) return -1
        return l - r
      }),
    [groupedOrders, acceptedUnpaidGroups],
  )
  const serviceEntries = useMemo<QueueEntry[]>(
    () => [...qrGroups.map((group) => ({ kind: 'qr' as const, key: qrSelectKey(group), group })), ...serviceAndAcceptedEntries],
    [qrGroups, serviceAndAcceptedEntries],
  )
  // activeView lọc đúng 1 loại dòng; 'all' (tile "Đơn chờ") giữ nguyên cả ba lẫn nhau như cũ.
  const visibleEntryKind =
    activeView === 'service'
      ? 'service'
      : activeView === 'paid'
        ? 'qr'
        : activeView === 'accepted-unpaid'
          ? 'accepted-unpaid'
          : null
  const filteredServiceEntries = useMemo(
    () => (visibleEntryKind ? serviceEntries.filter((entry) => entry.kind === visibleEntryKind) : serviceEntries),
    [serviceEntries, visibleEntryKind],
  )
  // 'accepted-unpaid' giờ hiện CHUNG panel với Dịch vụ (không còn panel/heading riêng) -- 'combo' và
  // 'completed' mới tách panel riêng (combo khác bảng dữ liệu; completed là đơn ĐÃ ĐÓNG, chỉ xem,
  // không chọn/hủy nên không hợp logic chung của panel chính).
  const showServicePanel = activeView !== 'combo' && activeView !== 'completed'
  const showComboPanel = activeView === 'all' || activeView === 'combo'
  const showCompletedPanel = activeView === 'completed'
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
    setSelectedAcceptedUnpaidKeys(new Set())
  }, [hostName, customerNameFilter, activeView])

  useEffect(() => {
    if (servicePage >= serviceTotalPages) setServicePage(serviceTotalPages - 1)
  }, [servicePage, serviceTotalPages])

  useEffect(() => {
    if (comboPage >= comboTotalPages) setComboPage(comboTotalPages - 1)
  }, [comboPage, comboTotalPages])

  const refreshServiceQueue = () => {
    void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
    refreshCompleted()
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
  // task service-pay-fullcore: dùng chung cho đơn chưa duyệt (`/service/payrequest`) và đơn ĐÃ DUYỆT
  // (`/service/pay`) — chỉ khác key idem và danh sách cần tải lại.
  const reportPayError = (error: unknown, endpoint: DeductRetry['endpoint']) => {
    // client.ts đã tự toast thông báo RBAC_DENIED của backend — không toast lần hai.
    if (!(error instanceof RbacDeniedError)) {
      pushToast(error instanceof Error ? error.message : 'Không xử lý được đơn.', 'error')
    }
    const code = error instanceof ApiError ? error.code : undefined
    const plan = classifyPayError(code)
    if (plan.resetKey) (endpoint === 'payrequest' ? payIntent : acceptedUnpaidPayIntent).clearKey()
    if (plan.refetch) {
      if (endpoint === 'payrequest') refreshServiceQueue()
      else refreshAcceptedUnpaid()
    }
    // Lỗi nghiệp vụ (có `code`) = backend đã từ chối, 0 ghi ⇒ đóng hộp. Lỗi mạng/timeout (không có
    // `code`) thì GIỮ hộp mở: bấm lại gửi đúng `idem` cũ nên không thu hai lần.
    if (error instanceof ApiError && error.code) setConfirmation(null)
  }

  // Một lối duy nhất cho cả lần bấm đầu và "Thử trừ ví lại" — `status=1` không có nghĩa là đã trừ ví.
  const handlePayResponse = (
    method: PayMethod,
    response: PayRequestResponse,
    retry: DeductRetry,
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
          retry,
        }),
      )
      pushToast(`${outcome.message} Xem cảnh báo ở đầu trang.`, 'error')
    } else {
      if (paymentId) setDeductAlerts((current) => removeAlert(current, paymentId))
      if (outcome.clearKey) (retry.endpoint === 'payrequest' ? payIntent : acceptedUnpaidPayIntent).clearKey()
      pushToast(outcome.message, outcome.kind === 'success' ? 'success' : 'info')
    }
    setConfirmation(null)
    if (retry.endpoint === 'payrequest') {
      clearOverrides(retry.request.items.map((item) => item.detailId))
      refreshServiceQueue()
    } else {
      refreshAcceptedUnpaid()
    }
    void invalidateMoneyQueries(queryClient)
  }

  const previewMutation = useMutation({
    mutationFn: ({ order, method }: { order: GroupedOrder; method: PayMethod }) =>
      payRequestDryRun(dryRunPayload(method, order, staffId ?? 0, qtyOverrides)),
    onSuccess: (preview, { order, method }) => {
      setConfirmation({ type: method === 'cash' ? 'pay-cash' : 'pay-deduct', order, preview })
      if (preview.code === 'invalid_lines') refreshServiceQueue()
    },
    onError: (error) => reportPayError(error, 'payrequest'),
  })

  const payMutation = useMutation({
    mutationFn: async ({ order, method }: { order: GroupedOrder; method: PayMethod }) => {
      // Fingerprint gồm hình thức + khách + từng dòng (detailId, SL) ⇒ đổi bất kỳ thứ gì là `idem` mới.
      const idem = payIntent.getKey(fingerprintIntent(payFingerprint(method, order, qtyOverrides)))
      const request = payPayload(method, order, staffId ?? 0, idem, qtyOverrides)
      return { response: await payRequest(request), request }
    },
    onSuccess: ({ response, request }, { order, method }) =>
      handlePayResponse(method, response, { endpoint: 'payrequest', request }, {
        hostName: order.hostName || '',
        // userId là key nội bộ — không hiển thị ra UI, kể cả khi thiếu userName.
        customerLabel: order.userName || 'Hội viên (chưa rõ tên)',
      }),
    onError: (error) => reportPayError(error, 'payrequest'),
  })

  // "Thử trừ ví lại": gửi lại ĐÚNG request cũ (cùng `idem`) tới ĐÚNG endpoint gốc. Backend nhận ra phiếu
  // đã ghi và chỉ chạy lại bước trừ ví (trạng thái a) — không tạo phiếu thứ hai, không trừ hai lần.
  const retryDeductMutation = useMutation({
    mutationFn: async (alert: DeductAlert) => {
      const retry = alert.retry
      const response =
        retry.endpoint === 'payrequest'
          ? await payRequest(retry.request)
          : await servicePayFullCore(retry.request)
      return { response, alert }
    },
    onSuccess: ({ response, alert }) =>
      handlePayResponse('deduct', response, alert.retry, {
        hostName: alert.hostName,
        customerLabel: alert.customerLabel,
      }),
    onError: (error, alert) => reportPayError(error, alert.retry.endpoint),
  })

  // ===== Đơn ĐÃ DUYỆT còn nợ tiền -- `/service/pay` + `/service/clearaccepted` nhánh `fullCore`, KHÁC
  // hẳn `/service/payrequest`/`/service/cancel` ở trên (những cái đó chỉ nhận đơn CHƯA duyệt, Accept=0;
  // xem handoff/HANDOFF_orders-accepted-unpaid-actions.md §2). task service-pay-fullcore: Cấn trừ trừ
  // ví thật (BE), có dryRun như nhóm Dịch vụ. =====
  const acceptedUnpaidDryRunPayload = (
    group: AcceptedUnpaidGroup,
    method: PayMethod,
  ): ServicePayDryRunPayload => ({
    staffId: staffId ?? 0,
    paymentMethod: method,
    hostName: group.hostName || '',
    vouchers: [{ voucherId: group.voucherId, detailIds: acceptedUnpaidDetailIds(group) }],
  })

  const acceptedUnpaidPreviewMutation = useMutation({
    mutationFn: ({ group, method }: { group: AcceptedUnpaidGroup; method: PayMethod }) =>
      servicePayDryRun(acceptedUnpaidDryRunPayload(group, method)),
    onSuccess: (preview, { group, method }) => {
      setConfirmation({ type: method === 'cash' ? 'au-pay-cash' : 'au-pay-deduct', group, preview })
      if (preview.code === 'invalid_lines') refreshAcceptedUnpaid()
    },
    onError: (error) => reportPayError(error, 'service-pay'),
  })

  const acceptedUnpaidPayMutation = useMutation({
    mutationFn: async ({ group, method }: { group: AcceptedUnpaidGroup; method: PayMethod }) => {
      const base = acceptedUnpaidDryRunPayload(group, method)
      // Fingerprint gồm hình thức + phiếu + máy + từng dòng ⇒ đổi bất kỳ thứ gì là `idem` mới.
      const idem = acceptedUnpaidPayIntent.getKey(
        fingerprintIntent({
          method,
          voucherId: group.voucherId,
          servicePaid: group.servicePaid,
          hostName: base.hostName,
          detailIds: base.vouchers[0].detailIds,
        }),
      )
      const request: ServicePayFullCorePayload = { ...base, idem, fullCore: true }
      return { response: await servicePayFullCore(request), request }
    },
    onSuccess: ({ response, request }, { group, method }) =>
      handlePayResponse(method, response, { endpoint: 'service-pay', request }, {
        hostName: group.hostName || '',
        customerLabel: group.userName || 'Hội viên (chưa rõ tên)',
      }),
    onError: (error) => reportPayError(error, 'service-pay'),
  })

  const acceptedUnpaidClearMutation = useMutation({
    mutationFn: (group: AcceptedUnpaidGroup) =>
      clearAcceptedService({
        staffId: staffId ?? 0,
        vouchers: clearAcceptedVouchers([group]),
        fullCore: true,
      }),
    onSuccess: (response) => {
      setConfirmation(null)
      pushToast(
        response.processed > 0 ? 'Đã hủy đơn.' : 'Đơn đã được xử lý trước đó.',
        response.processed > 0 ? 'success' : 'info',
      )
      refreshAcceptedUnpaid()
    },
    onError: (error) => {
      pushToast(error.message, 'error')
      refreshAcceptedUnpaid()
    },
  })

  // Hủy hàng loạt -- /service/clearaccepted nhận MẢNG vouchers nên gửi 1 lần cho mọi card đã chọn
  // (card cùng phiếu gộp về 1 entry).
  const acceptedUnpaidBulkClearMutation = useMutation({
    mutationFn: (keys: string[]) => {
      const groups = acceptedUnpaidGroups.filter((group) => keys.includes(acceptedUnpaidSelectKey(group)))
      return clearAcceptedService({
        staffId: staffId ?? 0,
        vouchers: clearAcceptedVouchers(groups),
        fullCore: true,
      })
    },
    onSuccess: (response) => {
      setConfirmation(null)
      setSelectedAcceptedUnpaidKeys(new Set())
      pushToast(
        response.processed > 0 ? `Đã hủy ${response.processed} phiếu.` : 'Các phiếu đã được xử lý trước đó.',
        response.processed > 0 ? 'success' : 'info',
      )
      refreshAcceptedUnpaid()
    },
    onError: (error) => {
      pushToast(error.message, 'error')
      refreshAcceptedUnpaid()
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
  // "Chọn tất cả" của Dịch vụ chỉ gom key kiểu qr/service -- đơn đã duyệt dùng khoá/bulk action riêng
  // (selectedAcceptedUnpaidKeys, xem ghi chú ở toggleAcceptedUnpaidSelection).
  const cancellableVisibleEntries = visibleServiceEntries.filter((entry) => entry.kind !== 'accepted-unpaid')
  const allSelected =
    cancellableVisibleEntries.length > 0 &&
    cancellableVisibleEntries.every((entry) => selectedKeys.has(entry.key))
  const selectedAcceptedUnpaidGroups = acceptedUnpaidGroups.filter((group) =>
    selectedAcceptedUnpaidKeys.has(acceptedUnpaidSelectKey(group)),
  )
  const visibleAcceptedUnpaidEntries = visibleServiceEntries.filter(
    (entry): entry is Extract<QueueEntry, { kind: 'accepted-unpaid' }> => entry.kind === 'accepted-unpaid',
  )
  const allAcceptedUnpaidSelected =
    visibleAcceptedUnpaidEntries.length > 0 &&
    visibleAcceptedUnpaidEntries.every((entry) => selectedAcceptedUnpaidKeys.has(entry.key))
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
    comboRejectMutation.isPending ||
    acceptedUnpaidPreviewMutation.isPending ||
    acceptedUnpaidPayMutation.isPending ||
    acceptedUnpaidClearMutation.isPending ||
    acceptedUnpaidBulkClearMutation.isPending

  const cancelItemsForKeys = (keys: string[]) =>
    keys.flatMap((key) => {
      const entry = entryByKey.get(key)
      if (!entry || entry.kind === 'accepted-unpaid') return []
      return entry.kind === 'qr' ? qrCancelItems(entry.group) : serviceCancelItems(entry.order)
    })
  const selectionHasQr = (keys: string[]) => keys.some((key) => entryByKey.get(key)?.kind === 'qr')
  // Danh sách món (tên × SL) hiện trong các hộp xác nhận hủy/từ chối đơn dịch vụ; combo thì null (đã có tên combo).
  const cancelLines = (() => {
    if (!confirmation) return null
    const ofLine = (line: PendingOrder, name = line.serviceName) => ({
      key: line.serviceDetailId,
      name,
      quantity: line.quantity,
    })
    switch (confirmation.type) {
      case 'cancel-service':
        return [confirmation.order, ...confirmation.order.children].map((line) =>
          ofLine(line, line === confirmation.order ? line.serviceName : `+ ${line.serviceName}`),
        )
      case 'cancel-qr':
      case 'au-clear':
        return confirmation.group.lines.map((line) => ofLine(line))
      case 'cancel-selected':
        return cancelItemsForKeys(confirmation.keys).map((item) => ({
          key: item.id,
          name: item.serviceName,
          quantity: item.quantity,
        }))
      case 'au-clear-selected':
        return acceptedUnpaidGroups
          .filter((group) => confirmation.keys.includes(acceptedUnpaidSelectKey(group)))
          .flatMap((group) => group.lines.map((line) => ofLine(line)))
      default:
        return null
    }
  })()
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
    if (confirmation?.type === 'au-pay-cash' || confirmation?.type === 'au-pay-deduct')
      acceptedUnpaidPayIntent.clearKey()
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
      case 'au-pay-cash':
        acceptedUnpaidPayMutation.mutate({ group: confirmation.group, method: 'cash' })
        break
      case 'au-pay-deduct':
        acceptedUnpaidPayMutation.mutate({ group: confirmation.group, method: 'deduct' })
        break
      case 'au-clear':
        acceptedUnpaidClearMutation.mutate(confirmation.group)
        break
      case 'au-clear-selected':
        acceptedUnpaidBulkClearMutation.mutate(confirmation.keys)
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

  const toggleAcceptedUnpaidSelection = (key: string) =>
    setSelectedAcceptedUnpaidKeys((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  // task staff-service-order (FE-2): in theo ĐÚNG các dòng của thẻ (không theo nhóm userId — khách vãng
  // lai dùng chung 1 userId). Chỉ in khi bấm; Qt đã tự in sau accept/pay nên hộp thoại có cảnh báo in trùng.
  const renderPrintButton = (detailIds: number[]) => (
    <Button
      type="button"
      variant="ghost"
      icon={<Printer {...actionIconProps} />}
      disabled={pendingMutation}
      title="In phiếu dịch vụ ra máy in bếp/quầy"
      onClick={() => setPrintDetailIds(detailIds)}
    >
      In phiếu
    </Button>
  )

  // Hộp xác nhận: luôn liệt kê TÊN từng món × số lượng (không ghi chung chung "N dòng").
  const renderConfirmItems = (lines: Array<{ key: number; name: string; quantity: number }>) => (
    <div className="order-confirm-summary__items">
      <dt>Món</dt>
      <dd>
        <ul className="staff-order__summary-items">
          {lines.map((line) => (
            <li key={line.key}>
              <span>{line.name}</span>
              <span>× {line.quantity}</span>
            </li>
          ))}
        </ul>
      </dd>
    </div>
  )

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
        <span className="order-card__username">{group.userName || 'Khách vãng lai'}</span>
        <div className="order-card__meta-row">
          <span className="order-card__voucher-id">#{group.voucherId}</span>
          <StatusBadge tone={waitTone(group.createdAtMs, now)}>
            Chờ {waitLabel(group.createdAtMs, now)}
          </StatusBadge>
          <StatusBadge tone="success">Đã trả QR</StatusBadge>
        </div>
      </div>
      <div className="order-card__items">
        {group.lines.map((line) => (
          <div key={line.serviceDetailId} className="order-card__line">
            <div className="order-card__line-main">
              <strong>{line.serviceName}</strong>
              <span>{formatMoney(unitPriceOf(line))}</span>
            </div>
            <div className="order-card__line-qty">
              <span className="order-card__line-qty-value">× {line.quantity}</span>
            </div>
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
        {renderPrintButton(group.lines.map((line) => line.serviceDetailId))}
      </div>
    </article>
  )

  // Đơn ĐÃ THU TIỀN XONG -- chỉ xem, không checkbox/không actions (đã đóng, không còn thao tác gì).
  const renderCompletedCard = (group: CompletedGroup) => (
    <article key={`done:${group.voucherId}`} className="order-card order-card--completed order-card--printable">
      <div className="order-card__identity">
        <strong>{group.hostName || 'Chưa xác định máy'}</strong>
        <span className="order-card__username">{group.userName || 'Khách vãng lai'}</span>
        <div className="order-card__meta-row">
          <span className="order-card__voucher-id">#{group.voucherId}</span>
          <StatusBadge tone={group.paymentMethod ? COMPLETED_METHOD_TONE[group.paymentMethod] : 'success'}>
            {group.paymentMethod ? COMPLETED_METHOD_LABEL[group.paymentMethod] : 'Hoàn thành'}
          </StatusBadge>
        </div>
        {group.paidTime ? (
          <small className="order-card__paid-time">Thu lúc {group.paidTime.slice(0, 5)}</small>
        ) : null}
      </div>
      <div className="order-card__items">
        {group.lines.map((line) => (
          <div key={line.serviceDetailId} className="order-card__line">
            <div className="order-card__line-main">
              <strong>{line.serviceName}</strong>
              <span>{formatMoney(unitPriceOf(line))}</span>
            </div>
            <div className="order-card__line-qty">
              <span className="order-card__line-qty-value">× {line.quantity}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="order-card__total">
        <span>Đã thu</span>
        <strong>{formatMoney(group.paidTotal)}</strong>
      </div>
      <div className="order-card__actions">
        {renderPrintButton(group.lines.map((line) => line.serviceDetailId))}
      </div>
    </article>
  )

  // Đơn ĐÃ DUYỆT còn nợ tiền -- checkbox chỉ phục vụ Hủy hàng loạt (giống Dịch vụ); Thanh toán/Cấn trừ
  // vẫn LUÔN theo từng card riêng, không có bản hàng loạt. Nút khóa theo hình thức khách đã chọn tại máy
  // (user chốt 2026-10-05, BE kiểm lại): mỗi card chỉ một hình thức (gom theo voucherId + servicePaid).
  const acceptedUnpaidGates = (group: AcceptedUnpaidGroup) => {
    const cashReason =
      group.lockedMethod === 'deduct' ? 'Khách đã chọn cấn trừ tại máy — dùng nút Cấn trừ.' : undefined
    const deductReason =
      group.lockedMethod === 'cash'
        ? 'Khách đã chọn tiền mặt tại máy — dùng nút Thanh toán.'
        : !canDeduct
          ? `Thiếu quyền cấn trừ dịch vụ (${SERVICE_EXCEPT_RIGHT}).`
          : !group.hostName
            ? 'Hội viên không online tại máy nào — không cấn trừ được.'
            : undefined
    return { cashReason, deductReason }
  }

  const renderAcceptedUnpaidCard = (group: AcceptedUnpaidGroup) => {
    const { cashReason, deductReason } = acceptedUnpaidGates(group)
    const selectKey = acceptedUnpaidSelectKey(group)
    return (
    <article key={selectKey} className="order-card">
      <label className="order-card__check">
        <input
          type="checkbox"
          checked={selectedAcceptedUnpaidKeys.has(selectKey)}
          aria-label={`Chọn phiếu #${group.voucherId}`}
          onChange={() => toggleAcceptedUnpaidSelection(selectKey)}
        />
      </label>
      <div className="order-card__identity">
        <strong>{group.hostName || 'Chưa xác định máy'}</strong>
        <span className="order-card__username">{group.userName || 'Khách vãng lai'}</span>
        <div className="order-card__meta-row">
          <span className="order-card__voucher-id">#{group.voucherId}</span>
          <StatusBadge tone={waitTone(group.createdAtMs, now)}>
            Chờ {waitLabel(group.createdAtMs, now)}
          </StatusBadge>
          {group.lockedMethod ? (
            <StatusBadge tone="info">
              {group.lockedMethod === 'cash' ? 'Tiền mặt' : 'Cấn trừ'}
            </StatusBadge>
          ) : null}
        </div>
      </div>
      <div className="order-card__items">
        {group.lines.map((line) => (
          <div key={line.serviceDetailId} className="order-card__line">
            <div className="order-card__line-main">
              <strong>{line.serviceName}</strong>
              <span>{formatMoney(unitPriceOf(line))}</span>
            </div>
            <div className="order-card__line-qty">
              <span className="order-card__line-qty-value">× {line.quantity}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="order-card__total">
        <span>Chưa thu</span>
        <strong>{formatMoney(group.total)}</strong>
      </div>
      <div className="order-card__actions">
        <Button
          type="button"
          variant="primary"
          icon={<CurrencyCircleDollar {...actionIconProps} />}
          disabled={pendingMutation || Boolean(cashReason)}
          title={cashReason}
          onClick={() => acceptedUnpaidPreviewMutation.mutate({ group, method: 'cash' })}
        >
          Thanh toán
        </Button>
        <Button
          type="button"
          variant="secondary"
          icon={<HandCoins {...actionIconProps} />}
          disabled={pendingMutation || Boolean(deductReason)}
          title={deductReason}
          onClick={() => acceptedUnpaidPreviewMutation.mutate({ group, method: 'deduct' })}
        >
          Cấn trừ
        </Button>
        <Button
          type="button"
          variant="danger-outline"
          icon={<XCircle {...actionIconProps} />}
          disabled={pendingMutation || !canCancel}
          title={cancelTitle}
          onClick={() => setConfirmation({ type: 'au-clear', group })}
        >
          Hủy
        </Button>
        {renderPrintButton(acceptedUnpaidDetailIds(group))}
      </div>
    </article>
    )
  }

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
          <span className="order-card__username">{order.userName || 'Khách vãng lai'}</span>
          <div className="order-card__meta-row">
            <StatusBadge tone={waitTone(order.createdAtMs, now)}>
              Chờ {waitLabel(order.createdAtMs, now)}
            </StatusBadge>
          </div>
        </div>
        <div className="order-card__items">
          <div className="order-card__line">
            <div className="order-card__line-main">
              <strong>{order.serviceName}</strong>
              <span>{formatMoney(unitPriceOf(order))}</span>
            </div>
            <div className="order-card__line-qty">
              {editable ? <span>Số lượng</span> : null}
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
              ) : (
                <span className="order-card__line-qty-value">× {quantity}</span>
              )}
              {editable ? null : <span>{getServicePaidLabel(order.servicePaid)}</span>}
            </div>
          </div>
          {order.children.map((child) => (
            <div key={child.serviceDetailId} className="order-card__topping order-card__line">
              <div className="order-card__line-main">
                <strong>+ {child.serviceName}</strong>
                <span>{formatMoney(unitPriceOf(child))}</span>
              </div>
              <div className="order-card__line-qty">
                <span className="order-card__line-qty-value">× {child.quantity}</span>
              </div>
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
          {renderPrintButton([order.serviceDetailId, ...order.children.map((child) => child.serviceDetailId)])}
        </div>
      </article>
    )
  }

  return (
    <section className="order-workspace">
      <PageHeader
        eyebrow="Thu ngân"
        title="Đơn dịch vụ"
        actions={
          <>
          <Button
            type="button"
            variant="primary"
            icon={<Plus {...actionIconProps} />}
            onClick={() => setStaffOrderOpen(true)}
            title="Nhân viên chọn món thay khách đang ngồi máy hoặc khách vãng lai tại quầy"
          >
            Tạo đơn
          </Button>
          <PollingStatus
            connected={connected}
            // Lỗi của danh sách đơn đã duyệt (vd Server cũ chưa có /orders/accepted-unpaid) chỉ báo ở
            // panel của nó — không làm cả trang báo lỗi.
            isError={servicesQuery.isError || comboQuery.isError}
            isFetching={servicesQuery.isFetching || comboQuery.isFetching || acceptedUnpaidQuery.isFetching}
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
              void acceptedUnpaidQuery.refetch()
            }}
          />
          </>
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
        {/* Đơn dịch vụ đã thu tiền XONG hôm nay -- bấm xem danh sách từng phiếu. Nằm NGOÀI "Đơn chờ"
            (khác scope: đây là đơn đã đóng, không còn "chờ giải quyết" gì nữa). Xếp TRÊN "Đơn chờ". */}
        <div className="order-summary__card order-summary__card--completed">
          <button
            type="button"
            className={`order-summary__total order-summary__total--completed ${activeView === 'completed' && !completedMethod ? 'is-active' : ''}`}
            title="Đơn dịch vụ đã thu tiền xong hôm nay, toàn quán (không gồm nạp giờ / bán thẻ / combo). Số đếm là số phiếu."
            onClick={() => showCompleted(null)}
          >
            <CheckCircle className="order-summary__total-icon" size={28} weight="fill" aria-hidden="true" />
            <div className="order-summary__total-completed-text">
              <span className="order-summary__total-label">Hoàn thành</span>
              <strong className="order-summary__total-amount">
                {completedStats ? formatMoney(completedStats.completed.amount) : '—'}
              </strong>
              <small className="order-summary__total-count">
                {completedStats ? completedStats.completed.count : '—'} đơn
              </small>
            </div>
          </button>
          {completedStats ? (
            <div className="order-summary__breakdown">
              {/* cash/qr/deduct luôn hiện; chuyển khoản / nợ chuyển máy chỉ hiện khi có phiếu. */}
              {completedStats.completed.byType
                .filter((row) => row.count > 0 || row.key === 'cash' || row.key === 'qr' || row.key === 'deduct')
                .map((row, index) => {
                  const MethodIcon = COMPLETED_METHOD_ICON[row.key]
                  return (
                    <Fragment key={row.key}>
                    {/* Dấu "|" phân cách giữa các nút hình thức thu (giống dấu trước cụm "Đã hủy"). */}
                    {index > 0 ? (
                      <span className="order-summary__breakdown-divider" aria-hidden="true">
                        |
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={`order-summary__row order-summary__completed-method ${activeView === 'completed' && completedMethod === row.key ? 'is-active' : ''}`}
                      onClick={() => showCompleted(row.key)}
                    >
                      <span className="order-summary__row-label-line">
                        <span className="order-summary__label">{COMPLETED_METHOD_LABEL[row.key]}</span>
                      </span>
                      <strong className="order-summary__row-amount">{formatMoney(row.amount)}</strong>
                      <small className="order-summary__row-count">{row.count} đơn</small>
                      <MethodIcon
                        className={`order-summary__row-icon-bg order-summary__row-icon-bg--${row.key}`}
                        size={30}
                        weight="fill"
                        aria-hidden="true"
                      />
                    </button>
                    </Fragment>
                  )
                })}
              {/* Không có danh sách đơn hủy để mở -> chỉ hiển thị, không bấm được. */}
              <div
                className="order-summary__row order-summary__row--static order-summary__completed-method"
                title="Số đơn bị hủy hôm nay qua trang này (hủy combo hoặc hủy từ phần mềm cũ không được đếm)"
              >
                <span className="order-summary__row-label-line">
                  <span className="order-summary__dot order-summary__dot--cancelled" aria-hidden="true" />
                  <span className="order-summary__label">Đã hủy</span>
                </span>
                <strong className="order-summary__row-amount order-summary__row-amount--neutral">
                  {completedStats.cancelled.count} đơn
                </strong>
              </div>
            </div>
          ) : null}
        </div>

        <div className="order-summary__card">
          <button
            type="button"
            className={`order-summary__total ${activeView === 'all' ? 'is-active' : ''}`}
            onClick={() => setActiveView('all')}
          >
            <Hourglass className="order-summary__total-icon--pending" size={28} weight="fill" aria-hidden="true" />
            <div className="order-summary__total__text">
              <span>Đơn chờ</span>
              <small className="order-summary__hint order-summary__total-hint">
                {formatMoney(serviceTotal + comboTotal + acceptedUnpaidTotal + qrPaidTotal)}
              </small>
            </div>
            <strong>{groupedOrders.length + qrGroups.length + comboOrders.length + acceptedUnpaidGroups.length}</strong>
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
                <small className="order-summary__hint">{formatMoney(serviceTotal)}</small>
              </span>
              <strong>{groupedOrders.length}</strong>
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
            {/* Đơn ĐÃ DUYỆT nhưng còn nợ tiền -- CÓ nằm trong tổng "Đơn chờ" và view "Tất cả" (user chốt
                2026-10-05, chỉ Web UI; Qt không hiện). Bấm vào lọc đúng view này. */}
            <button
              type="button"
              className={`order-summary__row order-summary__accepted-unpaid ${activeView === 'accepted-unpaid' ? 'is-active' : ''}`}
              onClick={() => setActiveView('accepted-unpaid')}
              title="Đơn đã bấm Chấp nhận nhưng khách chưa thanh toán -- vẫn đang chờ giải quyết"
            >
              <span className="order-summary__dot order-summary__dot--accepted-unpaid" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Đã chấp nhận</span>
                <small className="order-summary__hint">
                  {formatMoney(acceptedUnpaidTotal)}
                  <span className="order-summary__hint--muted"> · chưa thu</span>
                </small>
              </span>
              <strong>{acceptedUnpaidGroups.length}</strong>
            </button>
            <button
              type="button"
              className={`order-summary__row order-summary__paid ${activeView === 'paid' ? 'is-active' : ''} ${qrGroups.length > 0 ? 'has-value' : ''}`}
              onClick={() => setActiveView('paid')}
            >
              <span className="order-summary__dot order-summary__dot--paid" aria-hidden="true" />
              <span className="order-summary__row-text">
                <span className="order-summary__label">Đã thanh toán</span>
                <small className="order-summary__hint">{formatMoney(qrPaidTotal)}</small>
              </span>
              <strong>{qrGroups.length}</strong>
            </button>
          </div>
        </div>
      </div>

      <div className="order-filters">
        <label className="ds-field order-search">
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
        <div
          className={`order-panel ${
            !servicesQuery.isLoading &&
            !servicesQuery.isError &&
            !acceptedUnpaidQuery.isLoading &&
            !acceptedUnpaidQuery.isError &&
            filteredServiceEntries.length === 0
              ? 'order-panel--compact'
              : ''
          }`}
        >
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

          {/* Đơn ĐÃ DUYỆT còn nợ tiền -- selection/endpoint hoàn toàn khác (Hủy = /service/clearaccepted,
              không phải /service/cancel) nên giữ thanh chọn riêng dù giờ cùng 1 danh sách thẻ. */}
          {selectedAcceptedUnpaidGroups.length > 0 ? (
            <div className="order-selection">
              <strong>{selectedAcceptedUnpaidGroups.length} phiếu đã chọn (đã duyệt)</strong>
              <div>
                <Button
                  type="button"
                  variant="danger"
                  disabled={!canCancel}
                  title={cancelTitle}
                  onClick={() =>
                    setConfirmation({
                      type: 'au-clear-selected',
                      keys: selectedAcceptedUnpaidGroups.map((group) => acceptedUnpaidSelectKey(group)),
                    })
                  }
                >
                  Hủy các phiếu đã chọn
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedAcceptedUnpaidKeys(new Set())}
                >
                  Bỏ chọn
                </Button>
              </div>
            </div>
          ) : null}

          {servicesQuery.isLoading || acceptedUnpaidQuery.isLoading ? (
            <StateView title="Đang tải đơn chờ" />
          ) : servicesQuery.isError ? (
            <StateView
              title="Không tải được đơn dịch vụ"
              description={(servicesQuery.error as Error).message}
              action={<Button onClick={() => servicesQuery.refetch()}>Thử lại</Button>}
            />
          ) : acceptedUnpaidQuery.isError ? (
            <StateView
              title="Không tải được danh sách đơn đã duyệt"
              description={(acceptedUnpaidQuery.error as Error).message}
              action={<Button onClick={() => acceptedUnpaidQuery.refetch()}>Thử lại</Button>}
            />
          ) : filteredServiceEntries.length === 0 ? (
            // Rỗng là trạng thái phổ biến (hết việc) -- hiện 1 dòng ngắn, KHÔNG dùng StateView (ds-state
            // cao 10rem, tốn diện tích trang khi phải nhìn liên tục).
            <p className="order-empty-compact">
              {activeView === 'paid'
                ? 'Không có đơn đã thanh toán đang chờ món.'
                : activeView === 'accepted-unpaid'
                  ? 'Không có đơn đã duyệt nào còn nợ tiền.'
                  : hostName || customerNameFilter
                    ? 'Không có đơn khớp bộ lọc hiện tại.'
                    : 'Không có đơn nào đang chờ xử lý.'}
            </p>
          ) : (
            <>
              <ListPagination
                page={servicePage}
                totalPages={serviceTotalPages}
                canNext={servicePage < serviceTotalPages - 1}
                onPrevious={() => setServicePage((value) => Math.max(0, value - 1))}
                onNext={() => setServicePage((value) => Math.min(serviceTotalPages - 1, value + 1))}
              />
              {cancellableVisibleEntries.length > 0 ? (
                <label className="order-select-all">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelectedKeys((current) => {
                        const next = new Set(current)
                        cancellableVisibleEntries.forEach((entry) => {
                          if (allSelected) next.delete(entry.key)
                          else next.add(entry.key)
                        })
                        return next
                      })
                    }
                  />
                  Chọn tất cả đơn dịch vụ đang hiển thị
                </label>
              ) : null}
              {visibleAcceptedUnpaidEntries.length > 0 ? (
                <label className="order-select-all">
                  <input
                    type="checkbox"
                    checked={allAcceptedUnpaidSelected}
                    onChange={() =>
                      setSelectedAcceptedUnpaidKeys((current) => {
                        const next = new Set(current)
                        visibleAcceptedUnpaidEntries.forEach((entry) => {
                          if (allAcceptedUnpaidSelected) next.delete(entry.key)
                          else next.add(entry.key)
                        })
                        return next
                      })
                    }
                  />
                  Chọn tất cả đơn đã duyệt đang hiển thị
                </label>
              ) : null}
              <div className="order-list-region">
                <div className="order-list">
                  {visibleServiceEntries.map((entry) => {
                    if (entry.kind === 'qr') return renderQrCard(entry.group)
                    if (entry.kind === 'service') return renderServiceCard(entry.order)
                    return renderAcceptedUnpaidCard(entry.group)
                  })}
                </div>
              </div>
            </>
          )}
        </div>
      ) : null}

      {showComboPanel ? (
        <div className="order-panel">
          {activeView === 'all' ? <h3 className="order-panel__heading">Combo chờ duyệt</h3> : null}
          {comboQuery.isLoading ? (
            <StateView title="Đang tải đơn combo" />
          ) : comboQuery.isError ? (
            <StateView
              title="Không tải được đơn combo"
              description={(comboQuery.error as Error).message}
              action={<Button onClick={() => comboQuery.refetch()}>Thử lại</Button>}
            />
          ) : comboOrders.length === 0 ? (
            // Rỗng là trạng thái phổ biến (hết việc) -- hiện 1 dòng ngắn như panel Dịch vụ & đã thanh
            // toán, KHÔNG dùng StateView (cao 10rem, tốn diện tích trang khi phải nhìn liên tục).
            <p className="order-empty-compact">
              {hostName ? 'Không có đơn combo khớp máy đang lọc.' : 'Không có combo chờ duyệt.'}
            </p>
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
                      <span className="order-card__username">{order.ownerName || 'Khách vãng lai'}</span>
                      <div className="order-card__meta-row">
                        <StatusBadge tone={waitTone(createdAt, now)}>
                          Chờ {waitLabel(createdAt, now)}
                        </StatusBadge>
                      </div>
                    </div>
                    <div className="order-card__items">
                      <div>
                        <strong>{order.comboName}</strong>
                        <span>
                          Hết hạn <strong className="order-card__expire-value">{formatExpireDate(order.expireDate)}</strong>
                        </span>
                      </div>
                      {order.zone ? (
                        <small>
                          Khu vực: <span className="order-card__zone-value">{formatZoneList(order.zone)}</span>
                        </small>
                      ) : null}
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

      {showCompletedPanel ? (
        <div className="order-panel">
          <h3 className="order-panel__heading">
            Đơn hoàn thành hôm nay{completedMethod ? ` · ${COMPLETED_METHOD_LABEL[completedMethod]}` : ''}
          </h3>
          {completedTodayQuery.isLoading ? (
            <StateView title="Đang tải đơn hoàn thành" />
          ) : completedTodayQuery.isError ? (
            <StateView
              title="Không tải được đơn hoàn thành"
              description={(completedTodayQuery.error as Error).message}
              action={<Button onClick={() => completedTodayQuery.refetch()}>Thử lại</Button>}
            />
          ) : completedGroups.length === 0 ? (
            <StateView
              title="Chưa có đơn hoàn thành hôm nay"
              description={
                hostName || customerNameFilter || completedMethod
                  ? 'Không có đơn khớp bộ lọc hiện tại.'
                  : 'Đơn dịch vụ sau khi thu tiền xong sẽ xuất hiện tại đây.'
              }
            />
          ) : (
            <div className="order-list-region">
              <div className="order-list">{completedGroups.map((group) => renderCompletedCard(group))}</div>
            </div>
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
                  : confirmation?.type === 'au-pay-cash'
                    ? 'Xác nhận đã thu tiền mặt?'
                    : confirmation?.type === 'au-pay-deduct'
                      ? 'Cấn trừ vào tài khoản hội viên?'
                      : confirmation?.type === 'au-clear'
                        ? `Hủy phiếu #${confirmation.group.voucherId}?`
                        : confirmation?.type === 'au-clear-selected'
                          ? `Hủy ${confirmation.keys.length} phiếu đã chọn?`
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
                : confirmation?.type === 'au-pay-cash' ||
                    confirmation?.type === 'au-pay-deduct' ||
                    confirmation?.type === 'au-clear'
                  ? `${confirmation.group.hostName || 'Chưa xác định máy'} · ${confirmation.group.userName || 'Khách vãng lai'}`
                  : undefined
        }
        confirmLabel={
          confirmation?.type === 'accept-combo'
            ? 'Xác nhận đã thu tiền'
            : confirmation?.type === 'pay-cash' || confirmation?.type === 'au-pay-cash'
              ? 'Đã thu tiền mặt'
              : confirmation?.type === 'pay-deduct' || confirmation?.type === 'au-pay-deduct'
                ? 'Cấn trừ'
                : 'Xác nhận hủy'
        }
        danger={
          confirmation?.type === 'cancel-service' ||
          confirmation?.type === 'cancel-qr' ||
          confirmation?.type === 'cancel-selected' ||
          confirmation?.type === 'reject-combo' ||
          confirmation?.type === 'au-clear' ||
          confirmation?.type === 'au-clear-selected'
        }
        pending={pendingMutation}
        // Thanh toán/Cấn trừ: `ok:false` ⇒ hiện lý do của backend và KHÔNG cho xác nhận.
        confirmDisabled={
          (confirmNeedsQrAck && !qrCancelAck) ||
          ((confirmation?.type === 'pay-cash' ||
            confirmation?.type === 'pay-deduct' ||
            confirmation?.type === 'au-pay-cash' ||
            confirmation?.type === 'au-pay-deduct') &&
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
                Chỉ xác nhận sau khi đã nhận đủ tiền mặt.
              </InlineAlert>
            ) : (
              <InlineAlert tone="warning">
                Trừ trực tiếp vào tài khoản chính của hội viên đang online tại máy này. Không hoàn tác được từ trang này.
              </InlineAlert>
            )}
            <dl className="order-confirm-summary">
              {renderConfirmItems(
                [confirmation.order, ...confirmation.order.children].map((line) => ({
                  key: line.serviceDetailId,
                  name: line === confirmation.order ? line.serviceName : `+ ${line.serviceName}`,
                  quantity: quantityOf(line, qtyOverrides),
                })),
              )}
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
        ) : confirmation?.type === 'au-pay-cash' || confirmation?.type === 'au-pay-deduct' ? (
          // task service-pay-fullcore: số trong hộp là số BE tính lại qua `dryRun` (`/service/pay`).
          <div className="order-confirm-stack">
            {confirmation.preview.ok === false ? (
              <InlineAlert tone="danger">
                {confirmation.preview.message || 'Không thực hiện được.'}
              </InlineAlert>
            ) : (
              <InlineAlert tone="warning">
                {confirmation.type === 'au-pay-cash'
                  ? 'Chỉ xác nhận sau khi đã nhận đủ tiền mặt.'
                  : 'Trừ trực tiếp vào tài khoản chính của hội viên đang online tại máy này. Không hoàn tác được từ trang này.'}
              </InlineAlert>
            )}
            <dl className="order-confirm-summary">
              <div><dt>Phiếu</dt><dd>#{confirmation.group.voucherId}</dd></div>
              {renderConfirmItems(
                confirmation.group.lines.map((line) => ({
                  key: line.serviceDetailId,
                  name: line.serviceName,
                  quantity: line.quantity,
                })),
              )}
              <div>
                <dt>{confirmation.type === 'au-pay-cash' ? 'Cần thu' : 'Tổng phí cấn trừ'}</dt>
                <dd>
                  {formatMoney(
                    typeof confirmation.preview.total === 'number'
                      ? confirmation.preview.total
                      : confirmation.group.total,
                  )}
                </dd>
              </div>
              {confirmation.type === 'au-pay-deduct' && confirmation.preview.memberName ? (
                <div><dt>Hội viên</dt><dd>{confirmation.preview.memberName}</dd></div>
              ) : null}
              {confirmation.type === 'au-pay-deduct' && typeof confirmation.preview.walletMain === 'number' ? (
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
              <div><dt>Khách chọn trên máy</dt><dd>{getServicePaidLabel(confirmation.group.servicePaid)}</dd></div>
            </dl>
          </div>
        ) : confirmNeedsQrAck ? (
          <div className="order-confirm-stack">
            {cancelLines ? <dl className="order-confirm-summary">{renderConfirmItems(cancelLines)}</dl> : null}
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
          <div className="order-confirm-stack">
            {cancelLines ? <dl className="order-confirm-summary">{renderConfirmItems(cancelLines)}</dl> : null}
            <InlineAlert tone="warning">
              Đơn bị hủy sẽ không sinh phiếu thu và khách không nhận món/combo này.
            </InlineAlert>
          </div>
        )}
      </ConfirmAction>

      <StaffOrderDialog
        open={staffOrderOpen && printDetailIds === null}
        onClose={() => setStaffOrderOpen(false)}
        onPrint={(detailIds) => setPrintDetailIds(detailIds)}
      />
      <PrintTicketDialog detailIds={printDetailIds} onClose={() => setPrintDetailIds(null)} />
    </section>
  )
}
