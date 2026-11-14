import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowsLeftRight,
  Bank,
  CheckCircle,
  CurrencyCircleDollar,
  HandCoins,
  MagnifyingGlass,
  Plus,
  Printer,
  QrCode,
  Stack,
  XCircle,
} from '@phosphor-icons/react'
import { describeApiErrorCode } from '../../lib/apiErrorText'
import { getWorkstationsRuntime } from '../../api/workstations'
import {
  getAcceptedUnpaidOrders,
  getCompletedOrderStats,
  getCompletedTodayOrders,
  getPendingOrders,
  getServicePaidLabel,
  type CompletedPaymentMethod,
} from '../../api/orders'
import {
  Button,
  InlineAlert,
  ListPagination,
  PageHeader,
  PollingStatus,
  SearchListButton,
  Select,
  StateView,
  StatusBadge,
} from '../../design-system/components'
import { useOrderQueueStore, type OrderView } from '../../store/orderQueue'
import { useRevenuePrefs } from '../../store/revenuePrefs'
import { formatShiftStart } from '../../lib/shiftTime'
import { useWsStatusStore } from '../../store/wsStatus'
import {
  COMPLETED_METHOD_LABEL,
  QTY_MAX,
  QTY_MIN,
  acceptedUnpaidDetailIds,
  acceptedUnpaidSelectKey,
  canChangeQuantity,
  groupAcceptedUnpaidOrders,
  groupCompletedOrders,
  groupOrders,
  groupQrOrders,
  orderAmount,
  qrCancelItems,
  qrSelectKey,
  quantityOf,
  serviceCancelItems,
  serviceSelectKey,
  unitPriceOf,
  type AcceptedUnpaidGroup,
  type CompletedGroup,
  type GroupedOrder,
  type QrGroup,
} from './orderQueueModel'
import {
  SERVICE_PAID_CASH,
  SERVICE_PAID_DEDUCT,
  acceptedUnpaidGates,
  describeAlertReason,
  formatVnd,
  payGates,
  removeAlert,
  type MachineLookup,
} from './orderPayModel'
import { waitLabel, waitTone } from './orderWaitTime'
import { OrderSteps } from './OrderSteps'
import { OrderConfirmDialog } from './OrderConfirmDialog'
import { PrintTicketDialog } from './PrintTicketDialog'
import { useOrderActions } from './useOrderActions'
import { StaffOrderDialog } from './StaffOrderDialog'
import './orders.css'
import './staffOrder.css'

const PAGE_SIZE = 20
const ORDER_SEARCH_LIST_ID = 'order-search-options'
// Parity ds-button__icon (design-system/components/Button.tsx actionIconProps) — icon hành động.
const actionIconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true as const }

type QueueEntry =
  | { kind: 'qr'; key: string; group: QrGroup }
  | { kind: 'service'; key: string; order: GroupedOrder }
  // task orders-accepted-merge (2026-10-06): gộp vào CHUNG danh sách với 'service' -- cùng bảng
  // ServiceDetailTb, chỉ khác Accept/ServicePaid nên khác nút hành động, không khác về hiển thị.
  | { kind: 'accepted-unpaid'; key: string; group: AcceptedUnpaidGroup }

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

// Combo chờ duyệt (formatExpireDate / formatZoneList / parseComboCreatedAt + danh sách + Đã thu tiền / Từ chối)
// đã chuyển sang trang /combo_sale (features/checkout/ComboPendingPanel) -- user chốt 2026-10-10.
// waitLabel/waitTone dùng chung -> ./orderWaitTime.

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

/**
 * Lọc theo số đơn = mã phiếu (`#208` trên thẻ), gõ "208" hoặc "#208", khớp một phần. Đơn chờ duyệt thường
 * (Accept=0, chưa duyệt) CHƯA có phiếu (voucherId = 0) nên không có số đơn và bị loại khi đang lọc theo số.
 */
function matchesVoucher(voucherId: number | null | undefined, filter: string) {
  const query = filter.replace(/^\s*#?/, '').trim()
  if (!query) return true
  return Boolean(voucherId) && String(voucherId).includes(query)
}

/** userId là key nội bộ, không bắt nhân viên gõ số — lọc theo tên khách (parity `matchesHost`). */
function matchesCustomer(userName: string | null | undefined, filter: string) {
  if (!filter) return true
  return (userName ?? '').toLocaleLowerCase('vi').includes(filter.toLocaleLowerCase('vi'))
}

export function OrderWorkspace() {
  const connected = useWsStatusStore((state) => state.connected)
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
  // Nhóm mở sẵn có thể do trang khác đặt (vd bấm "Đã nhận món" ở bảng máy → 'accepted-unpaid'); đọc ở đây (thuần),
  // xóa trong effect bên dưới để lần vào sau về mặc định.
  const [activeView, setActiveView] = useState<OrderView>(() => useOrderQueueStore.getState().initialView ?? 'all')
  useEffect(() => {
    useOrderQueueStore.getState().setInitialView(null)
  }, [])
  // Lọc thêm trong view 'completed' theo hình thức thu (bấm dòng breakdown của tile); null = tất cả.
  const [completedMethod, setCompletedMethod] = useState<CompletedPaymentMethod | null>(null)
  // Gộp 2 ô lọc cũ thành 1 thanh search (parity /logs/system): dropdown chọn trường, 1 ô nhập.
  // Mở trang khi store đã có sẵn lọc máy (từ thông báo/chi tiết máy) thì combo phải hiện "Tên máy",
  // nếu không ô nhập sẽ trống trong khi danh sách đang bị lọc.
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [searchField, setSearchField] = useState<'customer' | 'host' | 'voucher'>(() =>
    hostName && !customerNameFilter ? 'host' : 'customer',
  )
  // Lọc theo số đơn chỉ dùng trong trang này (không như tên máy/tài khoản được trang khác đặt sẵn qua store).
  const [voucherFilter, setVoucherFilter] = useState('')
  const hasSearch = Boolean(hostName || customerNameFilter || voucherFilter)
  const searchValue =
    searchField === 'host' ? hostName : searchField === 'voucher' ? voucherFilter : customerNameFilter
  const setSearchValue = (value: string) =>
    searchField === 'host'
      ? setHostName(value)
      : searchField === 'voucher'
        ? setVoucherFilter(value)
        : setCustomerNameFilter(value)
  // servicePage giờ phân trang CHUNG cho danh sách đã gộp (Dịch vụ + QR + Đã duyệt-chưa thanh toán).
  const [servicePage, setServicePage] = useState(0)
  // Trang riêng cho danh sách đơn hoàn thành (24 giờ có thể hàng trăm phiếu) — không dùng chung `servicePage`.
  const [completedPage, setCompletedPage] = useState(0)
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set())
  // Khóa chọn riêng (acceptedUnpaidSelectKey) -- KHÔNG dùng chung `selectedKeys`/`cancelMutation` của
  // Dịch vụ: đó là `/service/cancel` (chỉ Accept=0), gọi nhầm cho Accept=1 sẽ hỏng dữ liệu (KNOWLEDGE.md §50).
  const [selectedAcceptedUnpaidKeys, setSelectedAcceptedUnpaidKeys] = useState<Set<string>>(new Set())
  const actions = useOrderActions({
    onCancelled: () => setSelectedKeys(new Set()),
    onAcceptedUnpaidBulkCleared: () => setSelectedAcceptedUnpaidKeys(new Set()),
  })
  const {
    canCancel,
    cancelTitle,
    canDeduct,
    deductAlerts,
    pendingMutation,
    previewMutation,
    acceptedUnpaidPreviewMutation,
    qrAcceptMutation,
    qtyOverrides,
    retryDeductMutation,
    serviceMutation,
    setConfirmation,
    setDeductAlerts,
    setQuantity,
  } = actions
  // task staff-service-order: "Gọi món hộ" (FE-1) + "In phiếu" theo đơn (FE-2). `printDetailIds` != null ⇒
  // hộp thoại in đang mở; hộp thoại Gọi món hộ tạm ẩn (không xếp chồng 2 modal) nhưng GIỮ state.
  const [staffOrderOpen, setStaffOrderOpen] = useState(false)
  const [printDetailIds, setPrintDetailIds] = useState<number[] | null>(null)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const servicesQuery = useQuery({
    // Khóa riêng 'with-paid': trang /orders/legacy dùng dạng response cũ (không includePaid).
    // Luôn tải hết mọi khách (không round-trip theo userId) — lọc theo tên khách ở client, parity hostName.
    queryKey: ['pending-orders', 'with-paid'],
    queryFn: () => getPendingOrders(undefined, { includePaid: true }),
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
        (group) =>
          matchesHost(group.hostName, hostName) &&
          matchesCustomer(group.userName, customerNameFilter) &&
          matchesVoucher(group.voucherId, voucherFilter),
      ),
    [acceptedUnpaidQuery.data, hostName, customerNameFilter, voucherFilter],
  )
  const acceptedUnpaidTotal = acceptedUnpaidGroups.reduce((sum, group) => sum + group.total, 0)

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
          matchesCustomer(group.userName, customerNameFilter) &&
          matchesVoucher(group.voucherId, voucherFilter),
      ),
    [completedTodayQuery.data, completedMethod, hostName, customerNameFilter, voucherFilter],
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

  // Gợi ý cho ô tìm: tài khoản / số đơn lấy từ CHÍNH các danh sách API đã tải (đơn chờ, đã duyệt, hoàn thành hôm nay)
  // nên là tập kết quả cố định, không phải gõ mò. Tên máy lấy từ danh sách máy đang chạy.
  const searchOptions = useMemo(() => {
    const lines = [
      ...(servicesQuery.data ?? []),
      ...(acceptedUnpaidQuery.data ?? []),
      ...(completedTodayQuery.data ?? []),
    ]
    const customers = new Set<string>()
    const vouchers = new Set<number>()
    for (const line of lines) {
      const name = line.userName?.trim()
      if (name) customers.add(name)
      if (line.voucherId) vouchers.add(line.voucherId)
    }
    return {
      customer: [...customers].sort((a, b) => a.localeCompare(b, 'vi', { sensitivity: 'base' })),
      voucher: [...vouchers].sort((a, b) => b - a).map(String),
      host: (workstationsQuery.data?.items ?? []).map((machine) => machine.hostName),
    }
  }, [servicesQuery.data, acceptedUnpaidQuery.data, completedTodayQuery.data, workstationsQuery.data])

  const groupedOrders = useMemo(
    () =>
      groupOrders(servicesQuery.data ?? []).filter(
        (order) =>
          matchesHost(order.hostName, hostName) &&
          matchesCustomer(order.userName, customerNameFilter) &&
          matchesVoucher(order.voucherId, voucherFilter),
      ),
    [hostName, customerNameFilter, voucherFilter, servicesQuery.data],
  )
  const qrGroups = useMemo(
    () =>
      groupQrOrders(servicesQuery.data ?? []).filter(
        (group) =>
          matchesHost(group.hostName, hostName) &&
          matchesCustomer(group.userName, customerNameFilter) &&
          matchesVoucher(group.voucherId, voucherFilter),
      ),
    [hostName, customerNameFilter, voucherFilter, servicesQuery.data],
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
  // 'accepted-unpaid' giờ hiện CHUNG panel với Dịch vụ (không còn panel/heading riêng) -- 'completed'
  // tách panel riêng (đơn ĐÃ ĐÓNG, chỉ xem, không chọn/hủy nên không hợp logic chung của panel chính).
  // Combo chờ duyệt đã chuyển sang /combo_sale (user chốt 2026-10-10).
  const showServicePanel = activeView !== 'completed'
  const showCompletedPanel = activeView === 'completed'
  const serviceTotalPages = Math.max(1, Math.ceil(filteredServiceEntries.length / PAGE_SIZE))
  const visibleServiceEntries = filteredServiceEntries.slice(
    servicePage * PAGE_SIZE,
    (servicePage + 1) * PAGE_SIZE,
  )

  useEffect(() => {
    setServicePage(0)
    setSelectedKeys(new Set())
    setSelectedAcceptedUnpaidKeys(new Set())
  }, [hostName, customerNameFilter, voucherFilter, activeView])

  useEffect(() => {
    if (servicePage >= serviceTotalPages) setServicePage(serviceTotalPages - 1)
  }, [servicePage, serviceTotalPages])

  // Đơn hoàn thành: cùng cách phân trang với danh sách chờ. Về trang đầu khi đổi bộ lọc (kể cả `completedMethod`,
  // mà effect của danh sách chờ không theo dõi); kẹp lại khi số trang giảm sau một lần poll.
  const completedTotalPages = Math.max(1, Math.ceil(completedGroups.length / PAGE_SIZE))
  const visibleCompletedGroups = completedGroups.slice(completedPage * PAGE_SIZE, (completedPage + 1) * PAGE_SIZE)

  useEffect(() => {
    setCompletedPage(0)
  }, [hostName, customerNameFilter, voucherFilter, completedMethod, activeView])

  useEffect(() => {
    if (completedPage >= completedTotalPages) setCompletedPage(completedTotalPages - 1)
  }, [completedPage, completedTotalPages])

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
      variant="neutral"
      className="order-card__print"
      icon={<Printer {...actionIconProps} />}
      disabled={pendingMutation}
      title="In phiếu dịch vụ ra máy in bếp/quầy"
      aria-label="In phiếu"
      onClick={() => setPrintDetailIds(detailIds)}
    />
  )

  // Badge hình thức thanh toán khách đã chọn tại máy, dưới số tiền của thẻ đơn (cùng kiểu thẻ ở trang Đặt máy
  // và thẻ "Đã thu"). servicePaid 4 = tiền mặt, 5 = cấn trừ; 0 = khách chưa chọn ⇒ không hiện gì.
  const renderChosenMethodBadge = (servicePaid: number) => {
    const method: CompletedPaymentMethod | null =
      servicePaid === SERVICE_PAID_CASH ? 'cash' : servicePaid === SERVICE_PAID_DEDUCT ? 'deduct' : null
    if (!method) return null
    const PayIcon = COMPLETED_METHOD_ICON[method]
    return (
      <StatusBadge tone={COMPLETED_METHOD_TONE[method]}>
        <span className="order-card__pay">
          <PayIcon size={14} weight="fill" aria-hidden="true" />
          {COMPLETED_METHOD_LABEL[method]}
        </span>
      </StatusBadge>
    )
  }

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
      <div className="order-card__total order-card__total--print">
        {renderPrintButton(group.lines.map((line) => line.serviceDetailId))}
        <span>Đã thu</span>
        <strong>{formatMoney(group.paidTotal)}</strong>
      </div>
      <OrderSteps kind="qr" times={[group.createdAtMs]} />
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

  // Đơn ĐÃ THU TIỀN XONG -- chỉ xem, không checkbox/không actions (đã đóng, không còn thao tác gì).
  const renderCompletedCard = (group: CompletedGroup) => (
    <article key={`done:${group.voucherId}`} className="order-card order-card--completed order-card--printable">
      <div className="order-card__identity">
        <strong>{group.hostName || 'Chưa xác định máy'}</strong>
        <span className="order-card__username">{group.userName || 'Khách vãng lai'}</span>
        <div className="order-card__meta-row">
          <span className="order-card__voucher-id">#{group.voucherId}</span>
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
      <div className="order-card__total order-card__total--print">
        {renderPrintButton(group.lines.map((line) => line.serviceDetailId))}
        <span>Đã thu</span>
        <strong>{formatMoney(group.paidTotal)}</strong>
        {/* Hình thức thu: badge có icon, in đậm, đứng dưới số tiền (cùng kiểu thẻ đơn ở trang Đặt máy). */}
        {(() => {
          const PayIcon = group.paymentMethod ? COMPLETED_METHOD_ICON[group.paymentMethod] : CheckCircle
          return (
            <StatusBadge tone={group.paymentMethod ? COMPLETED_METHOD_TONE[group.paymentMethod] : 'success'}>
              <span className="order-card__pay">
                <PayIcon size={14} weight="fill" aria-hidden="true" />
                {group.paymentMethod ? COMPLETED_METHOD_LABEL[group.paymentMethod] : 'Hoàn thành'}
              </span>
            </StatusBadge>
          )
        })()}
      </div>
      <OrderSteps kind="completed" times={[group.createdAtMs, undefined, group.paidAtMs]} />
    </article>
  )

  // Đơn ĐÃ DUYỆT còn nợ tiền -- checkbox chỉ phục vụ Hủy hàng loạt (giống Dịch vụ); Thanh toán/Cấn trừ
  // vẫn LUÔN theo từng card riêng, không có bản hàng loạt. Nút khóa theo hình thức khách đã chọn tại máy
  // (user chốt 2026-10-05, BE kiểm lại): mỗi card chỉ một hình thức (gom theo voucherId + servicePaid).
  const renderAcceptedUnpaidCard = (group: AcceptedUnpaidGroup) => {
    const { cashReason, deductReason } = acceptedUnpaidGates(group, canDeduct)
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
      <div className="order-card__total order-card__total--print">
        {renderPrintButton(acceptedUnpaidDetailIds(group))}
        <span>Chưa thu</span>
        <strong>{formatMoney(group.total)}</strong>
        {renderChosenMethodBadge(group.servicePaid)}
      </div>
      <OrderSteps kind="accepted" times={[group.createdAtMs]} />
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
        {/* Khách đã chọn tiền mặt tại máy thì ẩn hẳn nút Cấn trừ, không để disabled. */}
        {group.lockedMethod === 'cash' ? null : (
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
        )}
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
        <div className="order-card__total order-card__total--print">
          {renderPrintButton([order.serviceDetailId, ...order.children.map((child) => child.serviceDetailId)])}
          <span>Tổng đơn</span>
          <strong>{formatMoney(orderAmount(order, qtyOverrides))}</strong>
          {renderChosenMethodBadge(order.servicePaid)}
        </div>
        <OrderSteps kind="pending" times={[order.createdAtMs]} />
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
          {/* Khách đã chọn tiền mặt tại máy thì không còn cấn trừ được -- ẩn hẳn nút, không để disabled. */}
          {order.servicePaid === SERVICE_PAID_CASH ? null : (
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
          )}
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

  // Ô check ở góc ô "Cấn trừ": bỏ check (mặc định) = tiền cấn trừ (trừ vào số dư ví, không phải tiền thu mới) KHÔNG tính vào
  // tổng "Doanh thu". Chỉ đổi cách hiển thị tổng trên máy này; số liệu từng hình thức và báo cáo không đổi.
  const deductInRevenue = useRevenuePrefs((state) => state.deductInRevenue)
  const setDeductInRevenue = useRevenuePrefs((state) => state.setDeductInRevenue)
  const deductRow = completedStats?.completed.byType.find((row) => row.key === 'deduct')
  const revenueAmount = completedStats
    ? completedStats.completed.amount - (deductInRevenue ? 0 : (deductRow?.amount ?? 0))
    : null
  const revenueCount = completedStats
    ? completedStats.completed.count - (deductInRevenue ? 0 : (deductRow?.count ?? 0))
    : null

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
            isError={servicesQuery.isError}
            isFetching={servicesQuery.isFetching || acceptedUnpaidQuery.isFetching}
            dataUpdatedAt={servicesQuery.dataUpdatedAt}
            intervalMs={connected ? 30_000 : 5_000}
            errorDetail={servicesQuery.error ? describeApiErrorCode(servicesQuery.error) : undefined}
            onRefresh={() => {
              void servicesQuery.refetch()
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
            title={`Đơn dịch vụ đã thu tiền xong hôm nay, toàn quán (không gồm nạp giờ / bán thẻ / combo). Số đếm là số phiếu.${
              deductInRevenue ? '' : ' Không gồm cấn trừ.'
            }`}
            onClick={() => showCompleted(null)}
          >
            <CheckCircle className="order-summary__total-icon" size={28} weight="fill" aria-hidden="true" />
            <div className="order-summary__total-completed-text">
              <span className="order-summary__total-label">Doanh thu</span>
              <strong className="order-summary__total-amount">
                {revenueAmount !== null ? formatMoney(revenueAmount) : '—'}
              </strong>
              <small className="order-summary__total-count">
                {revenueCount !== null ? revenueCount : '—'} đơn
              </small>
              {formatShiftStart(completedStats?.shiftStart) ? (
                <small className="order-summary__total-count" title="Thời điểm bắt đầu tính thống kê này (giờ máy chủ).">
                  Ca từ {formatShiftStart(completedStats?.shiftStart)}
                </small>
              ) : null}
            </div>
          </button>
          {completedStats ? (
            <div className="order-summary__breakdown">
              {/* cash/qr/deduct luôn hiện; chuyển khoản / nợ chuyển máy chỉ hiện khi có phiếu. */}
              {completedStats.completed.byType
                .filter((row) => row.count > 0 || row.key === 'cash' || row.key === 'qr' || row.key === 'deduct')
                .map((row, index) => {
                  const MethodIcon = COMPLETED_METHOD_ICON[row.key]
                  const isDeduct = row.key === 'deduct'
                  const methodButton = (
                    <button
                      type="button"
                      className={`order-summary__row order-summary__completed-method ${activeView === 'completed' && completedMethod === row.key ? 'is-active' : ''}${
                        isDeduct && !deductInRevenue ? ' is-excluded' : ''
                      }`}
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
                  )
                  return (
                    <Fragment key={row.key}>
                    {/* Dấu "|" phân cách giữa các nút hình thức thu (giống dấu trước cụm "Đã hủy"). */}
                    {index > 0 ? (
                      <span className="order-summary__breakdown-divider" aria-hidden="true">
                        |
                      </span>
                    ) : null}
                    {isDeduct ? (
                      // Checkbox là anh em của nút (không lồng trong <button>), đè lên góc trên phải ô.
                      <div className="order-summary__row-wrap">
                        {methodButton}
                        <input
                          type="checkbox"
                          className="order-summary__deduct-toggle"
                          checked={deductInRevenue}
                          aria-label="Tính cấn trừ vào doanh thu"
                          title={deductInRevenue ? 'Đang tính cấn trừ vào doanh thu — bấm để bỏ' : 'Không tính cấn trừ vào doanh thu — bấm để tính'}
                          onChange={(event) => setDeductInRevenue(event.target.checked)}
                        />
                      </div>
                    ) : (
                      methodButton
                    )}
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
            <Stack className="order-summary__total-icon--pending" size={28} weight="fill" aria-hidden="true" />
            <div className="order-summary__total__text">
              <span>Đơn chờ</span>
              <small className="order-summary__hint order-summary__total-hint">
                {formatMoney(serviceTotal + acceptedUnpaidTotal + qrPaidTotal)}
              </small>
            </div>
            <strong>{groupedOrders.length + qrGroups.length + acceptedUnpaidGroups.length}</strong>
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
              onChange={(event) => setSearchField(event.target.value as 'customer' | 'host' | 'voucher')}
            >
              <option value="customer">Tài khoản</option>
              <option value="host">Máy</option>
              <option value="voucher">Số đơn</option>
            </Select>
            <div className="ds-search-input">
              <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
              <input
                ref={searchInputRef}
                className="ds-input"
                type="search"
                list={ORDER_SEARCH_LIST_ID}
                placeholder={
                  searchField === 'host'
                    ? 'Nhập hoặc chọn tên máy'
                    : searchField === 'voucher'
                      ? 'Nhập hoặc chọn số đơn'
                      : 'Nhập hoặc chọn tài khoản'
                }
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
              <SearchListButton
                inputRef={searchInputRef}
                label={
                  searchField === 'host' ? 'Chọn tên máy' : searchField === 'voucher' ? 'Chọn số đơn' : 'Chọn tài khoản'
                }
              />
              {searchValue ? (
                <button
                  type="button"
                  className="ds-search-input__clear"
                  aria-label="Xóa từ khóa tìm kiếm"
                  title="Xóa từ khóa"
                  onClick={() => setSearchValue('')}
                >
                  <XCircle size={17} weight="fill" aria-hidden="true" />
                </button>
              ) : null}
            </div>
          </div>
          <datalist id={ORDER_SEARCH_LIST_ID}>
            {searchOptions[searchField].map((value) => (
              <option key={value} value={value} />
            ))}
          </datalist>
        </label>
        {hasSearch ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setHostName('')
              setCustomerNameFilter('')
              setVoucherFilter('')
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
          {/* 1 thanh chọn + 1 nút Hủy cho mọi loại thẻ. Đơn dịch vụ/QR (`/service/cancel`) và đơn đã duyệt
              (`/service/clearaccepted`) vẫn là hai endpoint -- confirmAction gọi riêng từng bên. */}
          {selectedEntries.length + selectedAcceptedUnpaidGroups.length > 0 ? (
            <div className="order-selection">
              <strong>{selectedEntries.length + selectedAcceptedUnpaidGroups.length} đơn đã chọn</strong>
              <div>
                <Button
                  type="button"
                  variant="danger"
                  disabled={!canCancel}
                  title={cancelTitle}
                  onClick={() =>
                    setConfirmation({
                      type: 'cancel-selected',
                      items: selectedEntries.flatMap((entry) =>
                        entry.kind === 'qr'
                          ? qrCancelItems(entry.group)
                          : entry.kind === 'service'
                            ? serviceCancelItems(entry.order)
                            : [],
                      ),
                      auGroups: selectedAcceptedUnpaidGroups,
                      entryCount: selectedEntries.length + selectedAcceptedUnpaidGroups.length,
                      hasQr: selectedEntries.some((entry) => entry.kind === 'qr'),
                    })
                  }
                >
                  Hủy các đơn đã chọn
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setSelectedKeys(new Set())
                    setSelectedAcceptedUnpaidKeys(new Set())
                  }}
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
                  : hasSearch
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
              {/* 1 ô chọn tất cả cho mọi loại thẻ đang hiển thị. Hai tập chọn (dịch vụ/QR và đã duyệt) vẫn tách
                  riêng vì Hủy đi hai endpoint khác nhau -- ô này chỉ đặt/bỏ cả hai cùng lúc. */}
              {cancellableVisibleEntries.length + visibleAcceptedUnpaidEntries.length > 0 ? (
                <label className="order-select-all">
                  <input
                    type="checkbox"
                    checked={
                      (cancellableVisibleEntries.length === 0 || allSelected) &&
                      (visibleAcceptedUnpaidEntries.length === 0 || allAcceptedUnpaidSelected)
                    }
                    onChange={(event) => {
                      const checked = event.target.checked
                      const apply = (current: Set<string>, keys: string[]) => {
                        const next = new Set(current)
                        keys.forEach((key) => (checked ? next.add(key) : next.delete(key)))
                        return next
                      }
                      setSelectedKeys((current) => apply(current, cancellableVisibleEntries.map((entry) => entry.key)))
                      setSelectedAcceptedUnpaidKeys((current) =>
                        apply(current, visibleAcceptedUnpaidEntries.map((entry) => entry.key)),
                      )
                    }}
                  />
                  Chọn tất cả đơn đang hiển thị
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
                hasSearch || completedMethod
                  ? 'Không có đơn khớp bộ lọc hiện tại.'
                  : 'Đơn dịch vụ sau khi thu tiền xong sẽ xuất hiện tại đây.'
              }
            />
          ) : (
            <>
              <ListPagination
                page={completedPage}
                totalPages={completedTotalPages}
                canNext={completedPage < completedTotalPages - 1}
                onPrevious={() => setCompletedPage((value) => Math.max(0, value - 1))}
                onNext={() => setCompletedPage((value) => Math.min(completedTotalPages - 1, value + 1))}
              />
              <div className="order-list-region">
                <div className="order-list">{visibleCompletedGroups.map((group) => renderCompletedCard(group))}</div>
              </div>
            </>
          )}
        </div>
      ) : null}

      <OrderConfirmDialog actions={actions} />

      <StaffOrderDialog
        open={staffOrderOpen && printDetailIds === null}
        defaultMode="guest"
        onClose={() => setStaffOrderOpen(false)}
        onPrint={(detailIds) => setPrintDetailIds(detailIds)}
      />
      <PrintTicketDialog detailIds={printDetailIds} onClose={() => setPrintDetailIds(null)} />
    </section>
  )
}
