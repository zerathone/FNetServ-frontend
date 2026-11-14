// Bộ điều khiển dùng chung cho "Dịch vụ chờ" ở trang Máy trạm (parity màn Qt "Danh sách dịch vụ chờ"): đơn dịch vụ chưa
// chấp nhận + combo chờ xác nhận + khách nạp tiền chung một danh sách; chuột phải / nút "⋯" mở menu thao tác.
// Hai kiểu hiển thị (khung bên phải `PendingServicePanel`, thẻ trên thanh công cụ `PendingServiceChips`) dùng CHUNG
// một nguồn dữ liệu, một menu và các hộp xác nhận ở đây. Mọi hành động đi qua `useOrderActions` + `OrderConfirmDialog`
// (cùng trang /orders) và `useComboPendingActions` (cùng trang /combo_sale) — không có đường ghi tiền riêng.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ArrowSquareOut,
  CheckCircle,
  CurrencyCircleDollar,
  HandCoins,
  PencilSimple,
  Trash,
} from '@phosphor-icons/react'
import { getAcceptedUnpaidOrders, getCompletedTodayOrders, getPendingOrders } from '../../api/orders'
import {
  getOperationNotificationSnapshot,
  OPERATIONS_NOTIFICATIONS_QUERY_KEY,
  updateOperationNotificationState,
} from '../../api/notifications'
import { pushToast } from '../../store/toast'
import { notificationIsDisplayable } from '../notifications/notificationModel'
import { Button, ConfirmAction, InlineAlert } from '../../design-system/components'
import { useOrderQueueStore, type OrderView } from '../../store/orderQueue'
import { useWsStatusStore } from '../../store/wsStatus'
import { parseComboCreatedAt, usePendingComboOrders } from '../checkout/comboPendingModel'
import { useComboPendingActions } from '../checkout/useComboPendingActions'
import { OrderConfirmDialog } from '../orders/OrderConfirmDialog'
import { isCounterGuest } from '../orders/counterGuest'
import {
  COMPLETED_METHOD_LABEL,
  QTY_MAX,
  QTY_MIN,
  canChangeQuantity,
  clampQuantity,
  groupAcceptedUnpaidOrders,
  groupCompletedOrders,
  groupOrders,
  orderAmount,
  quantityOf,
  type GroupedOrder,
} from '../orders/orderQueueModel'
import {
  MACHINE_STATUS,
  SERVICE_PAID_CASH,
  SERVICE_PAID_DEDUCT,
  USER_GROUP,
  acceptedUnpaidGates,
  describeAlertReason,
  formatVnd,
  payGates,
  removeAlert,
  type MachineLookup,
} from '../orders/orderPayModel'
import { useOrderActions } from '../orders/useOrderActions'
import '../orders/orders.css'
import './pending-service-panel.css'
import {
  MENU_HEIGHT,
  MENU_WIDTH,
  compactWait,
  readCollapsed,
  readMode,
  readView,
  suggestMoneyOf,
  writeCollapsed,
  writeMode,
  writeView,
  type MachineSource,
  type PendingDisplayMode,
  type PendingPanelView,
  type PendingRow,
  type PendingRowView,
} from './pendingServiceModel'

type MenuState = { rowKey: string; x: number; y: number }

type PendingServicesOptions = {
  machines: readonly MachineSource[]
  /** Mở bảng chi tiết của máy (trang Máy trạm). */
  onOpenMachine: (hostName: string) => void
  /** Mở hộp Nạp tiền hội viên của máy, điền sẵn số tiền khách xin; xong thì đánh dấu các thông báo đã xử lý. */
  onDeposit: (hostName: string, suggestMoney: number, notificationIds: string[]) => void
}

export function usePendingServices({ machines, onOpenMachine, onDeposit }: PendingServicesOptions) {
  const queryClient = useQueryClient()
  const connected = useWsStatusStore((state) => state.connected)
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mode, setModeState] = useState<PendingDisplayMode>(readMode)
  const [view, setViewState] = useState<PendingPanelView>(readView)
  const [now, setNow] = useState(() => Date.now())
  const [selectedKey, setSelectedKey] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [qtyEdit, setQtyEdit] = useState<{ order: GroupedOrder; value: number } | null>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  const navigate = useNavigate()
  const setOrderHost = useOrderQueueStore((state) => state.setHostName)
  const setOrderCustomerName = useOrderQueueStore((state) => state.setCustomerNameFilter)
  const setOrderInitialView = useOrderQueueStore((state) => state.setInitialView)
  const actions = useOrderActions()
  const comboActions = useComboPendingActions()
  const { query: comboQuery, orders: comboOrders } = usePendingComboOrders()
  const servicesQuery = useQuery({
    // Cùng khóa với trang /orders: dùng chung cache, WS/invalidate làm mới cả hai.
    queryKey: ['pending-orders', 'with-paid'],
    queryFn: () => getPendingOrders(undefined, { includePaid: true }),
    refetchInterval: connected ? 30_000 : 5_000,
  })

  // Tab "Đã duyệt": cùng khóa với /orders (dùng chung cache; thanh toán/hủy ở đâu cũng làm mới cả hai nơi).
  // Đơn chưa thu luôn tải; đơn hoàn thành tải khi khung đang mở (cả hai đều có huy hiệu đếm trên tab "Đã duyệt").
  const unpaidQuery = useQuery({
    queryKey: ['orders-accepted-unpaid'],
    queryFn: () => getAcceptedUnpaidOrders(),
    refetchInterval: connected ? 30_000 : 5_000,
  })
  const completedQuery = useQuery({
    queryKey: ['orders-completed', 'list'],
    queryFn: getCompletedTodayOrders,
    enabled: mode === 'panel' && !collapsed,
    refetchInterval: connected ? 30_000 : 5_000,
  })

  // Cùng khóa với hộp thông báo: dùng chung cache, WS/invalidate làm mới cả hai.
  const notificationsQuery = useQuery({
    queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY,
    queryFn: getOperationNotificationSnapshot,
    refetchInterval: connected ? 60_000 : 15_000,
    staleTime: 5_000,
  })
  const resolveRequestMutation = useMutation({
    mutationFn: (ids: string[]) => updateOperationNotificationState('resolve', ids),
    onSuccess: (result) => {
      if (result.notFound.length) {
        pushToast('Thông báo đã mất do máy chủ khởi động lại; danh sách sẽ được đồng bộ.', 'info')
      }
      void queryClient.invalidateQueries({ queryKey: OPERATIONS_NOTIFICATIONS_QUERY_KEY })
    },
    onError: (error: Error) => pushToast(error.message, 'error'),
  })

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const machineByHost = useMemo(
    () => new Map(machines.map((machine) => [machine.hostName.toLocaleLowerCase('vi'), machine])),
    [machines],
  )
  const machineFor = (host: string | null | undefined): MachineLookup => {
    if (!host || machines.length === 0) return undefined
    return machineByHost.get(host.toLocaleLowerCase('vi')) ?? null
  }

  const rows = useMemo<PendingRow[]>(() => {
    const services = groupOrders(servicesQuery.data ?? []).map((order) => ({
      kind: 'service' as const,
      key: `s:${order.serviceDetailId}`,
      createdAtMs: order.createdAtMs,
      order,
    }))
    const combos = comboOrders.map((order) => ({
      kind: 'combo' as const,
      key: `c:${order.comboCardId}`,
      createdAtMs: parseComboCreatedAt(order.createdAt),
      order,
    }))
    const requests = (notificationsQuery.data?.items ?? [])
      .filter((item) => item.type === 'charge_request' && item.state !== 'resolved' && notificationIsDisplayable(item))
      .map((item) => ({
        kind: 'request' as const,
        key: `r:${item.id}`,
        createdAtMs: item.createdAtMs,
        item,
      }))
    // Chờ lâu nhất lên đầu; dòng không rõ giờ xuống cuối.
    return [...services, ...combos, ...requests].sort((left, right) => {
      if (!left.createdAtMs) return 1
      if (!right.createdAtMs) return -1
      return left.createdAtMs - right.createdAtMs
    })
  }, [servicesQuery.data, comboOrders, notificationsQuery.data])

  // Tab "Đã duyệt": đơn chưa thu (chờ lâu nhất lên đầu) và đơn hoàn thành hôm nay (mới thu xếp trước, do groupCompletedOrders).
  const unpaidRows = useMemo<PendingRow[]>(
    () =>
      groupAcceptedUnpaidOrders(unpaidQuery.data ?? []).map((group) => ({
        kind: 'unpaid' as const,
        key: `u:${group.voucherId}:${group.servicePaid}`,
        createdAtMs: group.createdAtMs,
        group,
      })),
    [unpaidQuery.data],
  )
  const doneRows = useMemo<PendingRow[]>(
    () =>
      groupCompletedOrders(completedQuery.data ?? []).map((group) => ({
        kind: 'done' as const,
        key: `d:${group.voucherId}`,
        createdAtMs: group.paidAtMs,
        group,
      })),
    [completedQuery.data],
  )

  // Dòng mờ dưới tên máy: tên hội viên, hoặc "vãng lai" nếu là khách vãng lai; loại khác (nhân viên, thẻ combo, admin)
  // và khi không xác định được thì không hiện. Loại tài khoản lấy từ phiên đang ngồi máy (đơn không mang loại).
  const customerLineOf = (row: PendingRow) => {
    if (row.kind === 'combo') return ''
    const host = row.kind === 'request' ? row.item.hostName : row.kind === 'service' ? row.order.hostName : row.group.hostName
    const machine = host ? machineByHost.get(host.toLocaleLowerCase('vi')) : undefined
    if (row.kind === 'request') {
      if (machine?.userGroupType === USER_GROUP.anonym) return 'vãng lai'
      return machine?.userGroupType === USER_GROUP.member ? (machine.userName ?? '') : ''
    }
    const order = row.kind === 'service' ? row.order : row.group
    // userId = 0 là đơn chưa gắn tài khoản (khách vãng lai — server gửi `anonymous: userId === 0`); khách tại quầy cũng vậy.
    if (order.userId === 0 || isCounterGuest(order)) return 'vãng lai'
    if (!machine || machine.userId !== order.userId) return ''
    if (machine.userGroupType === USER_GROUP.anonym) return 'vãng lai'
    return machine.userGroupType === USER_GROUP.member ? order.userName || machine.userName || '' : ''
  }

  const viewOf = (row: PendingRow): PendingRowView => {
    if (row.kind === 'request') {
      const { item } = row
      const repeated = item.count > 1 ? ` · lặp ${item.count} lần` : ''
      return {
        host: item.hostName || '—',
        name: 'Nạp tiền',
        quantity: null as number | null,
        changed: false,
        amount: suggestMoneyOf(item),
        payKind: 'request' as const,
        detail: `Khách nạp tiền${repeated}${item.body ? ` — ${item.body}` : ''}`,
      }
    }
    if (row.kind === 'combo') {
      return {
        host: row.order.hostName || '—',
        name: row.order.comboName,
        quantity: 1 as number | null,
        changed: false,
        // Chỉ hiển thị. Combo luôn thu tiền mặt.
        amount: row.order.price,
        payKind: 'cash' as 'cash' | 'deduct' | 'request' | null,
        detail: [row.order.ownerName || 'Khách vãng lai', 'Combo'].join(' · '),
      }
    }
    if (row.kind === 'unpaid') {
      const { group } = row
      const chosen = group.lockedMethod === 'cash' ? 'Tiền mặt' : group.lockedMethod === 'deduct' ? 'Cấn trừ' : ''
      return {
        host: group.hostName || '—',
        name: group.lines.map((line) => line.serviceName).join(', '),
        quantity: group.lines.reduce((sum, line) => sum + line.quantity, 0) as number | null,
        changed: false,
        // Chỉ hiển thị (số tiền thật do server tính lại ở bước Thanh toán/Cấn trừ).
        amount: group.total,
        payKind: group.lockedMethod as 'cash' | 'deduct' | 'request' | null,
        detail: [group.userName || 'Khách vãng lai', `Phiếu #${group.voucherId}`, 'Đã duyệt, chưa thu tiền', chosen]
          .filter(Boolean)
          .join(' · '),
        waitText: compactWait(group.createdAtMs, now),
      }
    }
    if (row.kind === 'done') {
      const { group } = row
      const method = group.paymentMethod
      return {
        host: group.hostName || '—',
        name: group.lines.map((line) => line.serviceName).join(', '),
        quantity: group.lines.reduce((sum, line) => sum + line.quantity, 0) as number | null,
        changed: false,
        amount: group.paidTotal,
        payKind: (method === 'cash' || method === 'deduct' ? method : null) as 'cash' | 'deduct' | 'request' | null,
        detail: [
          group.userName || 'Khách vãng lai',
          `Phiếu #${group.voucherId}`,
          method ? `Đã thu (${COMPLETED_METHOD_LABEL[method]})` : 'Hoàn thành',
          group.paidTime ? `lúc ${group.paidTime.slice(0, 5)}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
        waitText: group.paidTime ? group.paidTime.slice(0, 5) : '—',
      }
    }
    const { order } = row
    const quantity = quantityOf(order, actions.qtyOverrides)
    return {
      host: order.hostName || '—',
      name: order.serviceName,
      quantity: quantity as number | null,
      changed: quantity !== order.quantity,
      // Chỉ hiển thị (số tiền thật do server tính lại ở bước Thanh toán/Cấn trừ).
      amount: orderAmount(order, actions.qtyOverrides),
      payKind: (order.servicePaid === SERVICE_PAID_CASH
        ? 'cash'
        : order.servicePaid === SERVICE_PAID_DEDUCT
          ? 'deduct'
          : null) as 'cash' | 'deduct' | 'request' | null,
      detail: [
        order.userName || 'Khách vãng lai',
        order.children.length ? `+${order.children.length} topping` : '',
        order.servicePaid === SERVICE_PAID_CASH ? 'Tiền mặt' : '',
        order.servicePaid === SERVICE_PAID_DEDUCT ? 'Cấn trừ' : '',
      ]
        .filter(Boolean)
        .join(' · '),
    }
  }

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writeCollapsed(!current)
      return !current
    })
    setMenu(null)
  }

  const setView = (next: PendingPanelView) => {
    writeView(next)
    setViewState(next)
    setMenu(null)
    setSelectedKey(null)
  }

  const setMode = (next: PendingDisplayMode) => {
    writeMode(next)
    setModeState(next)
    setMenu(null)
  }

  // Menu: đóng khi bấm ra ngoài / Esc / cuộn / đổi cỡ cửa sổ (vị trí neo theo lúc mở).
  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    const onPointerDown = (event: globalThis.PointerEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return
      close()
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('scroll', close, true)
    window.addEventListener('resize', close)
    menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('scroll', close, true)
      window.removeEventListener('resize', close)
    }
  }, [menu])

  // Dòng vừa được xử lý xong biến mất khỏi danh sách ⇒ đóng menu/bỏ chọn nếu dòng đó không còn.
  const menuRow = menu
    ? [...rows, ...unpaidRows, ...doneRows].find((row) => row.key === menu.rowKey)
    : undefined
  useEffect(() => {
    if (menu && !menuRow) setMenu(null)
  }, [menu, menuRow])

  const openMenuAt = (row: PendingRow, x: number, y: number) => {
    setSelectedKey(row.key)
    setMenu({
      rowKey: row.key,
      x: Math.max(4, Math.min(x, window.innerWidth - MENU_WIDTH - 4)),
      y: Math.max(4, Math.min(y, window.innerHeight - MENU_HEIGHT - 4)),
    })
  }

  const onContextMenu = (row: PendingRow) => (event: MouseEvent) => {
    event.preventDefault()
    openMenuAt(row, event.clientX, event.clientY)
  }

  const onRowKeyDown = (row: PendingRow) => (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10') || event.key === 'Enter') {
      event.preventDefault()
      const rect = event.currentTarget.getBoundingClientRect()
      openMenuAt(row, rect.left + 24, rect.bottom)
    }
  }

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
    if (items.length === 0) return
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1
    items[(next + items.length) % items.length].focus()
  }

  const choose = (run: () => void) => () => {
    setMenu(null)
    run()
  }

  const busy = actions.pendingMutation || comboActions.pendingMutation

  // Sang /orders với máy lọc sẵn + nhóm mở sẵn; xóa lọc tên tài khoản vì store này sống suốt phiên (như khi mở từ thông báo).
  const openOrders = (hostName: string | null, initialView: OrderView) => {
    setOrderHost(hostName ?? '')
    setOrderCustomerName('')
    setOrderInitialView(initialView)
    navigate('/orders')
  }

  const renderMenu = (row: PendingRow) => {
    if (row.kind === 'request') {
      const { item } = row
      const machine = machineFor(item.hostName)
      // Nạp tiền hội viên cần máy đang ONLINE với hội viên thật (không phải khách vãng lai / ADMIN). Chưa có dữ liệu
      // máy ⇒ không tự chặn (backend vẫn kiểm).
      const depositReason =
        machine === null
          ? 'Không thấy máy này trong danh sách máy đang chạy.'
          : machine &&
              (machine.status !== MACHINE_STATUS.ONLINE ||
                machine.userId === 0 ||
                machine.userGroupType === USER_GROUP.anonym)
            ? 'Máy không có hội viên đang online để nạp tiền.'
            : undefined
      return (
        <>
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            disabled={Boolean(depositReason)}
            title={depositReason ?? 'Mở nạp tiền hội viên cho máy này, điền sẵn số tiền khách xin'}
            onClick={choose(() => onDeposit(item.hostName, suggestMoneyOf(item), [item.id]))}
          >
            <CurrencyCircleDollar size={17} weight="fill" aria-hidden="true" />
            Nạp tiền
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            title="Mở chi tiết máy"
            onClick={choose(() => onOpenMachine(item.hostName))}
          >
            <ArrowSquareOut size={17} weight="bold" aria-hidden="true" />
            Chi tiết
          </button>
          <div className="ws-pending__menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            disabled={resolveRequestMutation.isPending}
            title="Khách đã nạp bằng cách khác hoặc không cần nạp nữa — bỏ dòng này"
            onClick={choose(() => resolveRequestMutation.mutate([item.id]))}
          >
            <CheckCircle size={17} weight="fill" aria-hidden="true" />
            Đã xử lý
          </button>
        </>
      )
    }
    if (row.kind === 'combo') {
      return (
        <>
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            disabled={busy}
            title="Xác nhận đã nhận đủ tiền mặt cho combo"
            onClick={choose(() => comboActions.askAccept(row.order))}
          >
            <CheckCircle size={17} weight="fill" aria-hidden="true" />
            Chấp nhận
          </button>
          <div className="ws-pending__menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            title="Mở trang Bán COMBO để xem chi tiết và duyệt"
            onClick={choose(() => navigate('/combo_sale'))}
          >
            <ArrowSquareOut size={17} weight="bold" aria-hidden="true" />
            Chi tiết
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item ws-pending__menu-item--danger"
            disabled={busy}
            onClick={choose(() => comboActions.askReject(row.order))}
          >
            <Trash size={17} weight="fill" aria-hidden="true" />
            Hủy
          </button>
        </>
      )
    }
    if (row.kind === 'unpaid') {
      const { group } = row
      const { cashReason, deductReason } = acceptedUnpaidGates(group, actions.canDeduct)
      return (
        <>
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            disabled={busy || Boolean(cashReason)}
            title={cashReason ?? 'Thu tiền mặt và chốt đơn ngay'}
            onClick={choose(() => actions.acceptedUnpaidPreviewMutation.mutate({ group, method: 'cash' }))}
          >
            <CurrencyCircleDollar size={17} weight="fill" aria-hidden="true" />
            Thanh toán
          </button>
          {/* Khách đã chọn tiền mặt tại máy thì không còn cấn trừ được -- ẩn hẳn, không để disabled (như thẻ ở /orders). */}
          {group.lockedMethod === 'cash' ? null : (
            <button
              type="button"
              role="menuitem"
              className="ws-pending__menu-item"
              disabled={busy || Boolean(deductReason)}
              title={deductReason ?? 'Trừ vào tài khoản hội viên đang online'}
              onClick={choose(() => actions.acceptedUnpaidPreviewMutation.mutate({ group, method: 'deduct' }))}
            >
              <HandCoins size={17} weight="fill" aria-hidden="true" />
              Cấn trừ
            </button>
          )}
          <div className="ws-pending__menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            title="Mở trang Đơn dịch vụ (nhóm Đã chấp nhận, lọc theo máy này) để xem chi tiết"
            onClick={choose(() => openOrders(group.hostName, 'accepted-unpaid'))}
          >
            <ArrowSquareOut size={17} weight="bold" aria-hidden="true" />
            Chi tiết
          </button>
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item ws-pending__menu-item--danger"
            disabled={busy || !actions.canCancel}
            title={actions.cancelTitle}
            onClick={choose(() => actions.setConfirmation({ type: 'au-clear', group }))}
          >
            <Trash size={17} weight="fill" aria-hidden="true" />
            Hủy
          </button>
        </>
      )
    }
    if (row.kind === 'done') {
      return (
        <button
          type="button"
          role="menuitem"
          className="ws-pending__menu-item"
          title="Mở trang Đơn dịch vụ (nhóm Đơn hoàn thành, lọc theo máy này)"
          onClick={choose(() => openOrders(row.group.hostName, 'completed'))}
        >
          <ArrowSquareOut size={17} weight="bold" aria-hidden="true" />
          Chi tiết
        </button>
      )
    }
    const { order } = row
    const gates = payGates(order, machineFor(order.hostName), actions.canDeduct)
    const canEditQty = canChangeQuantity(order) && gates.accept.enabled
    return (
      <>
        <button
          type="button"
          role="menuitem"
          className="ws-pending__menu-item"
          disabled={busy || !gates.accept.enabled}
          title={gates.accept.reason}
          onClick={choose(() => actions.serviceMutation.mutate(order))}
        >
          <CheckCircle size={17} weight="fill" aria-hidden="true" />
          Chấp nhận
        </button>
        <button
          type="button"
          role="menuitem"
          className="ws-pending__menu-item"
          disabled={busy || !gates.cash.enabled}
          title={gates.cash.reason ?? 'Thu tiền mặt và chốt đơn ngay'}
          onClick={choose(() => actions.previewMutation.mutate({ order, method: 'cash' }))}
        >
          <CurrencyCircleDollar size={17} weight="fill" aria-hidden="true" />
          Thanh toán
        </button>
        {/* Khách đã chọn tiền mặt tại máy thì không còn cấn trừ được -- ẩn hẳn, không để disabled (như thẻ ở /orders). */}
        {order.servicePaid === SERVICE_PAID_CASH ? null : (
          <button
            type="button"
            role="menuitem"
            className="ws-pending__menu-item"
            disabled={busy || !gates.deduct.enabled}
            title={gates.deduct.reason ?? 'Trừ vào tài khoản hội viên đang online'}
            onClick={choose(() => actions.previewMutation.mutate({ order, method: 'deduct' }))}
          >
            <HandCoins size={17} weight="fill" aria-hidden="true" />
            Cấn trừ
          </button>
        )}
        <div className="ws-pending__menu-sep" role="separator" />
        <button
          type="button"
          role="menuitem"
          className="ws-pending__menu-item"
          title="Mở trang Đơn dịch vụ (lọc theo máy này) để xem chi tiết và duyệt"
          onClick={choose(() => {
            // Lọc sẵn theo máy; xóa lọc tên tài khoản vì store này sống suốt phiên (như khi mở từ thông báo).
            setOrderHost(order.hostName ?? '')
            setOrderCustomerName('')
            navigate('/orders')
          })}
        >
          <ArrowSquareOut size={17} weight="bold" aria-hidden="true" />
          Chi tiết
        </button>
        <button
          type="button"
          role="menuitem"
          className="ws-pending__menu-item"
          disabled={busy || !canEditQty}
          title={canEditQty ? undefined : gates.accept.reason ?? 'Đơn này không đổi được số lượng'}
          onClick={choose(() => setQtyEdit({ order, value: quantityOf(order, actions.qtyOverrides) }))}
        >
          <PencilSimple size={17} weight="fill" aria-hidden="true" />
          Thay đổi số lượng
        </button>
        <button
          type="button"
          role="menuitem"
          className="ws-pending__menu-item ws-pending__menu-item--danger"
          disabled={busy || !actions.canCancel}
          title={actions.cancelTitle}
          onClick={choose(() => actions.setConfirmation({ type: 'cancel-service', order }))}
        >
          <Trash size={17} weight="fill" aria-hidden="true" />
          Hủy
        </button>
      </>
    )
  }

  const total = rows.length
  const loading = servicesQuery.isLoading || comboQuery.isLoading
  const failed = servicesQuery.isError || comboQuery.isError
  const retry = () => {
    void servicesQuery.refetch()
    void comboQuery.refetch()
  }
  const approvedLoading = unpaidQuery.isLoading || (view === 'approved' && completedQuery.isLoading)
  const approvedFailed = unpaidQuery.isError || completedQuery.isError
  const retryApproved = () => {
    void unpaidQuery.refetch()
    void completedQuery.refetch()
  }

  // Cảnh báo "đã ghi phiếu cấn trừ nhưng CHƯA trừ ví": cố định tới khi xử lý, hiện ở mọi kiểu hiển thị.
  const alerts: ReactNode = actions.deductAlerts.map((alert) => (
    <InlineAlert key={alert.paymentId} tone="danger">
      <div className="ws-pending__alert">
        <strong>
          Đã ghi phiếu cấn trừ #{alert.paymentId} ({formatVnd(alert.amount)}) cho {alert.hostName || 'máy ??'} ·{' '}
          {alert.customerLabel} nhưng CHƯA trừ ví hội viên.
        </strong>
        <span>{describeAlertReason(alert.code)}</span>
        <div>
          {alert.retryable ? (
            <Button
              type="button"
              variant="primary"
              loading={actions.retryDeductMutation.isPending}
              disabled={busy}
              onClick={() => actions.retryDeductMutation.mutate(alert)}
            >
              Thử trừ ví lại
            </Button>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            disabled={actions.retryDeductMutation.isPending}
            onClick={() => actions.setDeductAlerts((current) => removeAlert(current, alert.paymentId))}
          >
            Đã xử lý / Đóng
          </Button>
        </div>
      </div>
    </InlineAlert>
  ))

  // Menu chuột phải + hộp đổi số lượng + hộp xác nhận tiền: render MỘT lần ở cấp trang, dùng cho cả hai kiểu hiển thị.
  const overlays: ReactNode = (
    <>
      {menu && menuRow
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              className="ws-pending__menu"
              style={{ left: menu.x, top: menu.y }}
              onKeyDown={onMenuKeyDown}
            >
              {renderMenu(menuRow)}
            </div>,
            document.body,
          )
        : null}

      <ConfirmAction
        open={qtyEdit !== null}
        title="Thay đổi số lượng"
        description={qtyEdit ? `${qtyEdit.order.hostName || 'Chưa xác định máy'} · ${qtyEdit.order.serviceName}` : undefined}
        confirmLabel="Lưu"
        cancelLabel="Đóng"
        onCancel={() => setQtyEdit(null)}
        onConfirm={() => {
          if (qtyEdit) actions.setQuantity(qtyEdit.order, qtyEdit.value)
          setQtyEdit(null)
        }}
      >
        {qtyEdit ? (
          <div className="ws-pending__qty">
            <div className="order-qty" role="group" aria-label="Số lượng">
              <button
                type="button"
                className="order-qty__btn"
                disabled={qtyEdit.value <= QTY_MIN}
                aria-label="Giảm số lượng"
                onClick={() => setQtyEdit({ ...qtyEdit, value: clampQuantity(qtyEdit.value - 1) })}
              >
                −
              </button>
              <input
                className="order-qty__input"
                inputMode="numeric"
                value={qtyEdit.value}
                aria-label="Số lượng"
                autoFocus
                onChange={(event) => {
                  const digits = event.target.value.replace(/\D/g, '')
                  if (digits) setQtyEdit({ ...qtyEdit, value: clampQuantity(Number(digits)) })
                }}
              />
              <button
                type="button"
                className="order-qty__btn"
                disabled={qtyEdit.value >= QTY_MAX}
                aria-label="Tăng số lượng"
                onClick={() => setQtyEdit({ ...qtyEdit, value: clampQuantity(qtyEdit.value + 1) })}
              >
                +
              </button>
            </div>
            <small>Số lượng mới được áp dụng khi Chấp nhận hoặc Thanh toán đơn này.</small>
          </div>
        ) : null}
      </ConfirmAction>
      <OrderConfirmDialog actions={actions} />
      {comboActions.dialog}
    </>
  )

  return {
    rows,
    total,
    loading,
    failed,
    retry,
    view,
    setView,
    unpaidRows,
    doneRows,
    approvedLoading,
    approvedFailed,
    retryApproved,
    now,
    mode,
    setMode,
    collapsed,
    toggleCollapsed,
    selectedKey,
    setSelectedKey,
    viewOf,
    customerLineOf,
    openMenuAt,
    onContextMenu,
    onRowKeyDown,
    // Dùng cho nút "Xem tất cả N đơn" của mục Hoàn thành (PendingServicePanel): hostName null = không lọc máy.
    openOrders,
    qtyOverrides: actions.qtyOverrides,
    alerts,
    overlays,
  }
}

export type PendingServices = ReturnType<typeof usePendingServices>
