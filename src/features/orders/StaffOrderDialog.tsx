// task staff-service-order (FE-1) — màn "Gọi món hộ": nhân viên chọn món thay khách rồi chấp nhận / thu
// tiền mặt / cấn trừ. Chuỗi 2 bước, mỗi bước 1 idem riêng (handoff §4.2.3, §4.4):
//   1) POST /service/staff-order  → tạo dòng Accept=0 (server tính giá + kiểm kho)
//   2) POST /service/accept | /service/payrequest (fullCore) theo ĐÚNG `detailId` bước 1 trả về
// Lỗi bước 2 KHÔNG tạo lại dòng; nút "Hủy đơn" bị khóa khi kết quả mơ hồ (xem `failureActions`).
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  CurrencyCircleDollar,
  ForkKnife,
  HandCoins,
  MagnifyingGlass,
  Minus,
  Plus,
  Printer,
  TrashSimple,
  X,
  XCircle,
} from '@phosphor-icons/react'
import { ApiError } from '../../api/client'
import {
  acceptServiceOrder,
  cancelServiceOrder,
  createStaffOrder,
  type StaffOrderResponse,
} from '../../api/orders'
import { payRequest } from '../../api/payment'
import { getServices } from '../../api/services'
import { getWorkstationsRuntime } from '../../api/workstations'
import { Button, Dialog, InlineAlert, Segmented, Select, StateView, StatusBadge } from '../../design-system/components'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  ORDER_RIGHTS,
  QTY_MAX,
  QTY_MIN,
  customerInfoOf,
  describeInventoryWarnings,
  describeProcessedCount,
} from './orderQueueModel'
import {
  SERVICE_EXCEPT_RIGHT,
  classifyPayError,
  classifyPayResult,
  describeAlertReason,
  formatVnd,
} from './orderPayModel'
import {
  SETTLE_LABEL,
  acceptPayload,
  addToCart,
  availableMethods,
  buildCatalog,
  cartIssues,
  cartTotal,
  classifyStepFailure,
  describeFailureKind,
  describeSettled,
  describeTarget,
  failureActions,
  listMachineTargets,
  methodGates,
  payRequestPayloadOf,
  removeFromCart,
  setCartQuantity,
  settleFingerprint,
  staffOrderFingerprint,
  staffOrderPayload,
  stockLimit,
  targetOfMachine,
  type CartLine,
  type MachineSearchField,
  type SettleFailureKind,
  type SettleMethod,
  type StaffOrderTarget,
} from './staffOrderModel'
import './staffOrder.css'

/** Chỉ liệt kê tối đa ngần này kết quả tìm máy (200-400 máy không thể hiện hết). */
const MACHINE_RESULT_LIMIT = 8

const actionIconProps = { size: 18, weight: 'bold' as const, 'aria-hidden': true as const }

type Props = {
  open: boolean
  onClose: () => void
  /** Mở hộp thoại "In phiếu" cho các dòng vừa xử lý xong. */
  onPrint: (detailIds: number[]) => void
}

type View =
  | { name: 'compose' }
  | { name: 'confirm'; method: Exclude<SettleMethod, 'tab'> }
  | { name: 'failed' }
  | { name: 'cancel-confirm' }
  | { name: 'done' }

// Chi tiết lỗi/kết quả giữ riêng khỏi `view` để "Quay lại" từ hộp xác nhận về đúng màn hình lỗi cũ.
type FailureInfo = { method: SettleMethod; kind: SettleFailureKind; message: string; hint?: string }
type DoneInfo = { method: SettleMethod; message: string; tone: 'success' | 'info' }

type SettleResult =
  | { ok: true; method: SettleMethod; message: string; tone: 'success' | 'info' }
  | { ok: false; step: 1; error: unknown }
  | {
      ok: false
      step: 2
      method: SettleMethod
      kind: SettleFailureKind
      message: string
      hint?: string
    }

function errorMessage(error: unknown) {
  return error instanceof Error && error.message ? error.message : 'Không xử lý được đơn.'
}

export function StaffOrderDialog({ open, onClose, onPrint }: Props) {
  const queryClient = useQueryClient()
  const staffId = useAuthStore((state) => state.staffId)
  const canDeduct = useAuthStore((state) => state.hasRight(SERVICE_EXCEPT_RIGHT))
  const canCancel = useAuthStore((state) => state.hasRight(ORDER_RIGHTS.DELETE_ORDER))

  const [mode, setMode] = useState<'machine' | 'guest'>('machine')
  const [machineSearch, setMachineSearch] = useState('')
  const [machineSearchField, setMachineSearchField] = useState<MachineSearchField>('customer')
  const [selectedHost, setSelectedHost] = useState<string | null>(null)
  const [catalogSearch, setCatalogSearch] = useState('')
  const [groupKey, setGroupKey] = useState<string>('all')
  const [cart, setCart] = useState<CartLine[]>([])
  const [view, setView] = useState<View>({ name: 'compose' })
  const [composeError, setComposeError] = useState<string | null>(null)
  const [failure, setFailure] = useState<FailureInfo | null>(null)
  const [done, setDone] = useState<DoneInfo | null>(null)
  // Dòng đã tạo ở bước 1 + khách tại thời điểm tạo (khóa lại: đổi lựa chọn sau đó không ảnh hưởng đơn).
  const [created, setCreated] = useState<StaffOrderResponse | null>(null)
  const [orderTarget, setOrderTarget] = useState<StaffOrderTarget | null>(null)

  const createIntent = useIdempotentIntent('staff-order')
  const settleIntent = useIdempotentIntent('staff-settle')

  // Cùng query key với trang Danh mục / Combo: dùng chung cache. Danh mục đổi chậm ⇒ staleTime dài; tồn kho
  // được làm mới bằng `invalidate` sau mỗi lần xử lý xong.
  const servicesQuery = useQuery({
    queryKey: ['services'],
    queryFn: getServices,
    enabled: open,
    staleTime: 3 * 60_000,
  })
  // Dùng chung cache `['workstations']` với /orders — KHÔNG thêm vòng polling mới.
  const workstationsQuery = useQuery({
    queryKey: ['workstations'],
    queryFn: getWorkstationsRuntime,
    enabled: open,
    retry: false,
  })

  const machines = useMemo(
    () => listMachineTargets(workstationsQuery.data?.items, machineSearch, machineSearchField),
    [workstationsQuery.data, machineSearch, machineSearchField],
  )
  const totalMachinesWithCustomer = useMemo(
    () => listMachineTargets(workstationsQuery.data?.items).length,
    [workstationsQuery.data],
  )
  const selectedMachine = useMemo(
    () => listMachineTargets(workstationsQuery.data?.items).find((machine) => machine.hostName === selectedHost),
    [workstationsQuery.data, selectedHost],
  )
  const target: StaffOrderTarget | null =
    mode === 'guest' ? { kind: 'guest' } : selectedMachine ? targetOfMachine(selectedMachine) : null

  const services = servicesQuery.data
  const catalog = useMemo(() => buildCatalog(services, catalogSearch), [services, catalogSearch])
  const visibleGroups = groupKey === 'all' ? catalog : catalog.filter((group) => group.key === groupKey)
  const serviceById = useMemo(() => new Map((services ?? []).map((service) => [service.id, service])), [services])
  const issues = useMemo(() => cartIssues(cart, services), [cart, services])
  const total = cartTotal(cart, services)

  const machineInfoOf = (hostName: string) => {
    const machine = workstationsQuery.data?.items.find((item) => item.hostName === hostName)
    return machine ? { status: machine.status, userId: machine.userId, userGroupType: machine.userGroupType } : undefined
  }
  const activeTarget = created ? orderTarget : target
  const gates = activeTarget
    ? methodGates(
        activeTarget,
        activeTarget.kind === 'member' ? machineInfoOf(activeTarget.hostName) : undefined,
        canDeduct,
      )
    : null

  const refreshAfterOrder = () => {
    void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
    void queryClient.invalidateQueries({ queryKey: ['orders-accepted-unpaid'] })
    void queryClient.invalidateQueries({ queryKey: ['orders-completed'] })
    void queryClient.invalidateQueries({ queryKey: ['services'] })
    void invalidateMoneyQueries(queryClient)
  }

  const resetOrder = (clearCart: boolean) => {
    createIntent.clearKey()
    settleIntent.clearKey()
    setCreated(null)
    setOrderTarget(null)
    setComposeError(null)
    setFailure(null)
    setDone(null)
    setView({ name: 'compose' })
    if (clearCart) setCart([])
  }

  // ---- chuỗi 2 bước. Trả kết quả (không ném) để biết lỗi xảy ra ở bước nào ----
  const settleMutation = useMutation({
    mutationFn: async ({ method }: { method: SettleMethod }): Promise<SettleResult> => {
      let order = created
      if (!order) {
        if (!target || cart.length === 0) return { ok: false, step: 1, error: new Error('Chưa chọn khách hoặc món.') }
        try {
          // Bước 1: idem riêng, sinh theo (khách + giỏ). Thành công ⇒ clearKey ngay (4.2.3 mục 6) để giỏ
          // thứ hai giống hệt (vd 2 khách vãng lai gọi cùng món) KHÔNG nhận lại `detailId` cũ.
          const key = createIntent.getKey(fingerprintIntent(staffOrderFingerprint(target, cart)))
          order = await createStaffOrder(staffOrderPayload(target, cart, key))
          createIntent.clearKey()
        } catch (error) {
          return { ok: false, step: 1, error }
        }
        setCreated(order)
        setOrderTarget(target)
        void queryClient.invalidateQueries({ queryKey: ['pending-orders'] })
      }

      const detailIds = order.items.map((line) => line.detailId)
      try {
        // Bước 2: idem MỚI, fingerprint = detailIds đã sắp xếp + cách thu ⇒ đổi cách thu là idem mới.
        const key = settleIntent.getKey(fingerprintIntent(settleFingerprint(detailIds, method)))
        if (method === 'tab') {
          const response = await acceptServiceOrder(acceptPayload(order, staffId ?? 0, key))
          settleIntent.clearKey()
          const result = describeProcessedCount(response.accepted, 'chấp nhận')
          const lowStock = describeInventoryWarnings(response.inventoryWarnings)
          if (lowStock) pushToast(lowStock, 'info')
          return {
            ok: true,
            method,
            tone: result.tone,
            message:
              response.accepted > 0
                ? describeSettled('tab', response.paymentId, response.amount ?? order.amount)
                : result.message,
          }
        }

        const response = await payRequest(payRequestPayloadOf(order, method, staffId ?? 0, key))
        const outcome = classifyPayResult(method, response)
        if (outcome.kind === 'manual-fix') {
          return {
            ok: false,
            step: 2,
            method,
            kind: 'manual-fix',
            message: outcome.message,
            hint: describeAlertReason(outcome.code),
          }
        }
        settleIntent.clearKey()
        // Kho trừ ở bước này (không phải bước 1) và `payrequest` không trả cảnh báo ⇒ dùng cảnh báo dự kiến
        // của bước 1 (cùng số lượng, cùng kho) — chỉ báo MỘT lần.
        const lowStock = describeInventoryWarnings(order.inventoryWarnings)
        if (lowStock) pushToast(lowStock, 'info')
        return {
          ok: true,
          method,
          tone: outcome.kind === 'success' ? 'success' : 'info',
          // Thành công: thông báo ngắn "Đã thu tiền #<phiếu> <số tiền>" (số do server tính lại).
          message:
            outcome.kind === 'success'
              ? describeSettled(
                  method,
                  response.paymentId,
                  (method === 'deduct' ? response.amount : response.total) ?? response.total ?? order.amount,
                )
              : outcome.message,
        }
      } catch (error) {
        const code = error instanceof ApiError ? error.code : undefined
        if (classifyPayError(code).resetKey) settleIntent.clearKey()
        return {
          ok: false,
          step: 2,
          method,
          kind: classifyStepFailure(error),
          message: errorMessage(error),
        }
      }
    },
    onSuccess: (result) => {
      if (result.ok) {
        setDone({ method: result.method, message: result.message, tone: result.tone })
        setFailure(null)
        setView({ name: 'done' })
        pushToast(result.message, result.tone)
        refreshAfterOrder()
        return
      }
      if (result.step === 1) {
        const code = result.error instanceof ApiError ? result.error.code : undefined
        if (code === 'invalid_service' || code === 'inventory_short') {
          void queryClient.invalidateQueries({ queryKey: ['services'] })
        }
        const kind = classifyStepFailure(result.error)
        setComposeError(
          kind === 'ambiguous'
            ? `${errorMessage(result.error)} Chưa biết máy chủ đã tạo đơn hay chưa — bấm lại cùng nút để thử lại an toàn (cùng mã giao dịch, không tạo trùng).`
            : errorMessage(result.error),
        )
        setView({ name: 'compose' })
        return
      }
      setFailure({ method: result.method, kind: result.kind, message: result.message, hint: result.hint })
      setView({ name: 'failed' })
      refreshAfterOrder()
    },
  })

  const cancelMutation = useMutation({
    mutationFn: () => {
      if (!created) throw new Error('Không có đơn để hủy.')
      const customer =
        orderTarget?.kind === 'member' ? customerInfoOf(orderTarget.userName) : customerInfoOf(undefined)
      const host = created.hostName
      return cancelServiceOrder({
        staffId: String(staffId ?? ''),
        items: created.items.map((line) => ({
          type: 'service' as const,
          id: line.detailId,
          machineName: host,
          customerInfo: customer,
          serviceName: serviceById.get(line.serviceId)?.name ?? `#${line.serviceId}`,
          quantity: line.quantity,
          amount: line.amount,
        })),
      })
    },
    onSuccess: (response) => {
      const result = describeProcessedCount(response.cancelled, 'hủy')
      pushToast(result.message, result.tone)
      // Giữ giỏ để nhân viên chỉnh lại; dòng đã hủy ⇒ bỏ `created` + 2 idem.
      resetOrder(false)
      refreshAfterOrder()
    },
    onError: (error) => {
      pushToast(error.message, 'error')
      setView((current) => (current.name === 'cancel-confirm' ? { name: 'failed' } : current))
      refreshAfterOrder()
    },
  })

  const pending = settleMutation.isPending || cancelMutation.isPending
  const canSubmit = Boolean(target) && cart.length > 0 && issues.length === 0 && !pending

  const start = (method: SettleMethod) => {
    setComposeError(null)
    if (method === 'tab') settleMutation.mutate({ method })
    else setView({ name: 'confirm', method })
  }

  const close = () => {
    if (pending) return
    if (created && view.name !== 'done') {
      pushToast(
        'Đơn chưa xử lý xong vẫn nằm ở danh sách Đơn chờ. Mở lại "Tạo đơn" để tiếp tục hoặc xử lý ở đó.',
        'info',
      )
    }
    if (view.name === 'done') resetOrder(true)
    // Hộp xác nhận chưa gửi gì: đóng thì về màn chọn món (giữ giỏ), không để lại màn "đã thu tiền?" treo.
    else if (view.name === 'confirm' && !created) setView({ name: 'compose' })
    onClose()
  }

  const orderLabel = activeTarget ? describeTarget(activeTarget) : ''
  const amountLabel = created ? formatVnd(created.amount) : `${formatVnd(total)} (tạm tính)`

  // ===================== nội dung theo màn hình =====================
  const renderCompose = () => (
    <div className="staff-order">
      <section className="staff-order__section" aria-label="Khách được gọi hộ">
        <Segmented
          ariaLabel="Đối tượng gọi món hộ"
          value={mode}
          options={[
            { value: 'machine', label: 'Máy online' },
            { value: 'guest', label: 'Tại quầy' },
          ]}
          onChange={(next) => {
            setMode(next)
            setComposeError(null)
          }}
        />
        {mode === 'guest' ? (
          <p className="staff-order__hint">
            Khách không dùng máy, thu tiền mặt ngay tại quầy (đơn ghi khách vãng lai).
          </p>
        ) : (
          <>
            {/* Parity thanh tìm của /logs/system và /orders: chọn trường (Tài khoản | Tên máy) + 1 ô nhập.
                Cùng một dòng với số máy đang có khách (200-400 máy không thể liệt kê hết ⇒ chỉ hiện kết quả
                khi gõ từ khóa). */}
            <div className="staff-order__search-row">
              <label className="ds-field staff-order__search-field">
                <span className="ds-visually-hidden">Tìm máy đang có khách</span>
                <div className="ds-input-group ds-input-group--search">
                  <Select
                    value={machineSearchField}
                    onChange={(event) => setMachineSearchField(event.target.value as MachineSearchField)}
                  >
                    <option value="customer">Tài khoản</option>
                    <option value="host">Tên máy</option>
                  </Select>
                  <div className="ds-search-input">
                    <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                    {selectedMachine ? (
                      <span className="staff-order__tag" title={`${selectedMachine.userName || 'Tài khoản đang đăng nhập'} · ${selectedMachine.hostName} · ${selectedMachine.kindLabel}`}>
                        <strong>{selectedMachine.userName || 'Tài khoản đang đăng nhập'}</strong>
                        <span className="staff-order__machine-host">{selectedMachine.hostName}</span>
                        <button
                          type="button"
                          className="staff-order__tag-close"
                          aria-label="Bỏ chọn khách"
                          onClick={() => {
                            setSelectedHost(null)
                            setComposeError(null)
                          }}
                        >
                          <X size={12} weight="bold" aria-hidden="true" />
                        </button>
                      </span>
                    ) : null}
                    <input
                      className="ds-input"
                      type="search"
                      placeholder={selectedMachine ? '' : machineSearchField === 'host' ? 'Nhập tên máy' : 'Nhập tên tài khoản'}
                      value={machineSearch}
                      onChange={(event) => setMachineSearch(event.target.value)}
                      onKeyDown={(event) => {
                        // Backspace khi ô trống ⇒ gỡ tag (như ô chọn nhiều giá trị thông thường).
                        if (event.key === 'Backspace' && !machineSearch && selectedMachine) setSelectedHost(null)
                      }}
                    />
                    {machineSearch ? (
                      <button
                        type="button"
                        className="ds-search-input__clear"
                        aria-label="Xóa từ khóa tìm kiếm"
                        title="Xóa từ khóa"
                        onClick={() => setMachineSearch('')}
                      >
                        <XCircle size={17} weight="fill" aria-hidden="true" />
                      </button>
                    ) : null}
                  </div>
                </div>
              </label>
              <span className="staff-order__machine-count" aria-live="polite">
                {workstationsQuery.isLoading ? '…' : <strong>{totalMachinesWithCustomer}</strong>} máy online
              </span>
            </div>
            {workstationsQuery.isError ? (
              <InlineAlert tone="danger">
                Không tải được danh sách máy: {(workstationsQuery.error as Error).message}{' '}
                <Button type="button" variant="ghost" onClick={() => void workstationsQuery.refetch()}>
                  Thử lại
                </Button>
              </InlineAlert>
            ) : !machineSearch.trim() ? (
              selectedMachine ? null : (
                <p className="staff-order__hint">Gõ tên tài khoản hoặc tên máy để chọn khách.</p>
              )
            ) : machines.length === 0 ? (
              <p className="staff-order__hint">Không có máy khớp từ khóa.</p>
            ) : (
              <div className="staff-order__machines" role="listbox" aria-label="Kết quả tìm máy">
                {machines.slice(0, MACHINE_RESULT_LIMIT).map((machine) => (
                  <button
                    key={machine.hostName}
                    type="button"
                    role="option"
                    aria-selected={machine.hostName === selectedHost}
                    title={`${machine.userName || 'Tài khoản đang đăng nhập'} · ${machine.hostName} · ${machine.kindLabel}`}
                    className={`staff-order__machine ${machine.hostName === selectedHost ? 'is-active' : ''}`}
                    onClick={() => {
                      setSelectedHost(machine.hostName)
                      setMachineSearch('')
                      setComposeError(null)
                    }}
                  >
                    <strong>{machine.userName || 'Tài khoản đang đăng nhập'}</strong>
                    <span className="staff-order__machine-host">{machine.hostName}</span>
                  </button>
                ))}
                {machines.length > MACHINE_RESULT_LIMIT ? (
                  <p className="staff-order__hint">
                    Còn {machines.length - MACHINE_RESULT_LIMIT} kết quả nữa — gõ thêm để thu hẹp.
                  </p>
                ) : null}
              </div>
            )}
            {!selectedMachine && selectedHost && !workstationsQuery.isLoading ? (
              <InlineAlert tone="warning">
                Máy {selectedHost} không còn khách đăng nhập — hãy chọn lại.
              </InlineAlert>
            ) : null}
          </>
        )}
      </section>

      <div className="staff-order__columns">
        <section className="staff-order__section staff-order__catalog" aria-label="Danh mục dịch vụ">
          <label className="ds-field">
            <span className="ds-visually-hidden">Tìm món</span>
            <div className="ds-input-group ds-input-group--search">
              <div className="ds-search-input">
                <MagnifyingGlass className="ds-search-input__icon" size={18} weight="bold" aria-hidden="true" />
                <input
                  className="ds-input"
                  type="search"
                  placeholder="Tìm món"
                  value={catalogSearch}
                  onChange={(event) => setCatalogSearch(event.target.value)}
                />
                {catalogSearch ? (
                  <button
                    type="button"
                    className="ds-search-input__clear"
                    aria-label="Xóa từ khóa tìm kiếm"
                    title="Xóa từ khóa"
                    onClick={() => setCatalogSearch('')}
                  >
                    <XCircle size={17} weight="fill" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
          </label>
          {catalog.length > 1 ? (
            <div className="staff-order__chips" role="group" aria-label="Lọc theo nhóm">
              <button
                type="button"
                className={`staff-order__chip ${groupKey === 'all' ? 'is-active' : ''}`}
                aria-pressed={groupKey === 'all'}
                onClick={() => setGroupKey('all')}
              >
                Tất cả
              </button>
              {catalog.map((group) => (
                <button
                  key={group.key}
                  type="button"
                  className={`staff-order__chip ${groupKey === group.key ? 'is-active' : ''}`}
                  aria-pressed={groupKey === group.key}
                  onClick={() => setGroupKey(group.key)}
                >
                  {group.name}
                </button>
              ))}
            </div>
          ) : null}
          <div className="staff-order__services">
            {servicesQuery.isLoading ? (
              <StateView title="Đang tải danh mục dịch vụ" />
            ) : servicesQuery.isError ? (
              <StateView
                title="Không tải được danh mục dịch vụ"
                description={(servicesQuery.error as Error).message}
                action={<Button onClick={() => void servicesQuery.refetch()}>Thử lại</Button>}
              />
            ) : visibleGroups.length === 0 ? (
              <p className="staff-order__hint">
                {catalogSearch ? 'Không có món khớp từ khóa.' : 'Chưa có dịch vụ nào đang bán.'}
              </p>
            ) : (
              visibleGroups.map((group) => (
                <div key={group.key} className="staff-order__group">
                  {catalog.length > 1 && groupKey === 'all' ? (
                    <h3 className="staff-order__group-title">{group.name}</h3>
                  ) : null}
                  {group.services.map((service) => {
                    const inCart = cart.find((line) => line.serviceId === service.id)?.quantity ?? 0
                    const limit = stockLimit(service)
                    const soldOut = limit < QTY_MIN
                    return (
                      <button
                        key={service.id}
                        type="button"
                        className="staff-order__service"
                        disabled={pending || soldOut}
                        onClick={() => {
                          setCart((current) => addToCart(current, service))
                          setComposeError(null)
                        }}
                      >
                        <span className="staff-order__service-main">
                          <strong>{service.name}</strong>
                          <small>
                            {formatVnd(service.price)}
                            {service.unit ? ` · ${service.unit}` : ''}
                            {service.inventoryManagement === 1 ? ` · tồn ${service.inventory}` : ''}
                          </small>
                        </span>
                        {soldOut ? (
                          <StatusBadge tone="danger">Hết hàng</StatusBadge>
                        ) : inCart > 0 ? (
                          <StatusBadge tone="info">× {inCart}</StatusBadge>
                        ) : (
                          <Plus {...actionIconProps} />
                        )}
                      </button>
                    )
                  })}
                </div>
              ))
            )}
          </div>
        </section>

        <section className="staff-order__section staff-order__cart" aria-label="Giỏ dịch vụ">
          <h3 className="staff-order__cart-title">
            Giỏ dịch vụ <small>({cart.length}/50 dòng)</small>
          </h3>
          {cart.length === 0 ? (
            <p className="staff-order__hint">Chưa có món nào. Bấm vào món bên trái để thêm.</p>
          ) : (
            <ul className="staff-order__cart-list">
              {cart.map((line) => {
                const service = serviceById.get(line.serviceId)
                const max = service ? stockLimit(service) : QTY_MAX
                return (
                  <li key={line.serviceId} className="staff-order__cart-line">
                    <span className="staff-order__service-main">
                      <strong>{service?.name ?? `Món #${line.serviceId}`}</strong>
                      <small>{service ? formatVnd(service.price * line.quantity) : '—'}</small>
                    </span>
                    <div className="order-qty" role="group" aria-label={`Số lượng ${service?.name ?? ''}`}>
                      <button
                        type="button"
                        className="order-qty__btn"
                        disabled={pending || line.quantity <= QTY_MIN}
                        aria-label="Giảm số lượng"
                        onClick={() => service && setCart((current) => setCartQuantity(current, service, line.quantity - 1))}
                      >
                        <Minus size={14} weight="bold" aria-hidden="true" />
                      </button>
                      <input
                        className="order-qty__input"
                        inputMode="numeric"
                        value={line.quantity}
                        aria-label="Số lượng"
                        disabled={pending}
                        onChange={(event) => {
                          const digits = event.target.value.replace(/\D/g, '')
                          if (digits && service) setCart((current) => setCartQuantity(current, service, Number(digits)))
                        }}
                      />
                      <button
                        type="button"
                        className="order-qty__btn"
                        disabled={pending || line.quantity >= max}
                        aria-label="Tăng số lượng"
                        onClick={() => service && setCart((current) => setCartQuantity(current, service, line.quantity + 1))}
                      >
                        <Plus size={14} weight="bold" aria-hidden="true" />
                      </button>
                    </div>
                    <button
                      type="button"
                      className="staff-order__remove"
                      aria-label={`Bỏ ${service?.name ?? 'món'} khỏi giỏ`}
                      title="Bỏ khỏi giỏ"
                      disabled={pending}
                      onClick={() => setCart((current) => removeFromCart(current, line.serviceId))}
                    >
                      <TrashSimple size={18} weight="bold" aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="staff-order__total">
            <span>Tạm tính</span>
            <strong>{formatVnd(total)}</strong>
          </div>
          {issues.map((issue) => (
            <InlineAlert key={issue.serviceId} tone="warning">
              {issue.reason === 'unavailable'
                ? `${issue.name} đã ngừng bán hoặc không còn trong danh mục — hãy bỏ khỏi giỏ.`
                : `${issue.name} chỉ còn ${issue.limit} — giảm số lượng trong giỏ.`}
            </InlineAlert>
          ))}
          {composeError ? <InlineAlert tone="danger">{composeError}</InlineAlert> : null}
          {gates && target
            ? availableMethods(target)
                .filter((method) => !gates[method].enabled && gates[method].reason)
                .map((method) => (
                  <small key={method} className="staff-order__hint">
                    {SETTLE_LABEL[method]}: {gates[method].reason}
                  </small>
                ))
            : null}
        </section>
      </div>
    </div>
  )

  // Hiện TÊN từng món × số lượng (đơn đã tạo: lấy theo dòng server trả; chưa tạo: theo giỏ).
  const summaryLines = (created
    ? created.items.map((line) => ({ serviceId: line.serviceId, quantity: line.quantity }))
    : cart
  ).map((line) => ({
    key: line.serviceId,
    name: serviceById.get(line.serviceId)?.name ?? `Món #${line.serviceId}`,
    quantity: line.quantity,
  }))

  const renderSummary = () => {
    const isGuest = activeTarget?.kind === 'guest'
    const customerName = activeTarget?.kind === 'member'
      ? (activeTarget.userName || 'Tài khoản đang đăng nhập')
      : 'Tại quầy'
    const hostName = activeTarget?.kind === 'member'
      ? activeTarget.hostName
      : 'Tại quầy'

    return (
      <dl className="order-confirm-summary">
        <div><dt>Khách</dt><dd>{customerName}</dd></div>
        {!isGuest && <div><dt>Máy</dt><dd>{hostName}</dd></div>}
        {isGuest && <div><dt>Hình thức</dt><dd>Tại quầy — thu tiền mặt</dd></div>}
        <div className="order-confirm-summary__items">
          <dt>Món</dt>
          <dd>
            <ul className="staff-order__summary-items">
              {summaryLines.map((line) => (
                <li key={line.key}>
                  <span>{line.name}</span>
                  <span>× {line.quantity}</span>
                </li>
              ))}
            </ul>
          </dd>
        </div>
        <div><dt>{created ? 'Số tiền' : 'Tạm tính'}</dt><dd>{amountLabel}</dd></div>
      </dl>
    )
  }

  const renderConfirm = (method: Exclude<SettleMethod, 'tab'>) => (
    <div className="order-confirm-stack">
      {method === 'deduct' ? (
        <InlineAlert tone="warning">
          Trừ trực tiếp vào tài khoản chính của hội viên, không hoàn tác giao dịch này.
        </InlineAlert>
      ) : null}
      {renderSummary()}
    </div>
  )

  const renderFailed = (state: FailureInfo) => {
    const guest = activeTarget?.kind === 'guest'
    return (
      <div className="order-confirm-stack">
        <InlineAlert tone="danger">
          <strong>{SETTLE_LABEL[state.method]} chưa hoàn tất.</strong> {state.message}
        </InlineAlert>
        <p className="staff-order__hint">{describeFailureKind(state.kind, guest)}</p>
        {state.hint ? <p className="staff-order__hint">{state.hint}</p> : null}
        {renderSummary()}
        <small className="staff-order__hint">
          Các dòng đã tạo vẫn nằm ở danh sách Đơn chờ. Thử lại luôn dùng cùng mã giao dịch nên không thu hai lần.
        </small>
      </div>
    )
  }

  const renderDone = (state: DoneInfo) => (
    <div className="order-confirm-stack">
      <InlineAlert tone={state.tone}>{state.message}</InlineAlert>
      {renderSummary()}
    </div>
  )

  // ===================== chân hộp thoại theo màn hình =====================
  const closeButton = (
    <Button type="button" variant="secondary" disabled={pending} onClick={close}>
      Đóng
    </Button>
  )

  const renderFooter = () => {
    if (view.name === 'compose') {
      const methods = target ? availableMethods(target) : (['tab', 'cash', 'deduct'] as SettleMethod[])
      return (
        <>
          {closeButton}
          {methods.map((method) => {
            const gate = gates?.[method] ?? { enabled: true }
            const icon =
              method === 'cash' ? (
                <CurrencyCircleDollar {...actionIconProps} />
              ) : method === 'deduct' ? (
                <HandCoins {...actionIconProps} />
              ) : (
                <ForkKnife {...actionIconProps} />
              )
            return (
              <Button
                key={method}
                type="button"
                variant={method === 'cash' ? 'primary' : 'secondary'}
                icon={icon}
                loading={settleMutation.isPending && settleMutation.variables?.method === method}
                disabled={!canSubmit || !gate.enabled}
                title={gate.reason}
                onClick={() => start(method)}
              >
                {SETTLE_LABEL[method]}
              </Button>
            )
          })}
        </>
      )
    }
    if (view.name === 'confirm') {
      const { method } = view
      return (
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setView(created && failure ? { name: 'failed' } : { name: 'compose' })}
          >
            Quay lại
          </Button>
          <Button
            type="button"
            variant="primary"
            loading={settleMutation.isPending}
            onClick={() => settleMutation.mutate({ method })}
          >
            {method === 'cash' ? 'Đã thu tiền mặt' : 'Cấn trừ'}
          </Button>
        </>
      )
    }
    if (view.name === 'failed' && failure) {
      const guest = activeTarget?.kind === 'guest'
      const actions = failureActions(failure.kind, guest)
      const others = (activeTarget ? availableMethods(activeTarget) : []).filter(
        (method) => method !== failure.method && (gates?.[method].enabled ?? true),
      )
      return (
        <>
          {closeButton}
          {actions.cancel ? (
            <Button
              type="button"
              variant={actions.suggestCancel ? 'danger' : 'danger-outline'}
              disabled={pending || !canCancel}
              title={canCancel ? undefined : `Thiếu quyền hủy đơn (${ORDER_RIGHTS.DELETE_ORDER})`}
              onClick={() => setView({ name: 'cancel-confirm' })}
            >
              Hủy đơn
            </Button>
          ) : null}
          {actions.changeMethod
            ? others.map((method) => (
                <Button key={method} type="button" variant="secondary" disabled={pending} onClick={() => start(method)}>
                  Đổi sang {SETTLE_LABEL[method].toLocaleLowerCase('vi')}
                </Button>
              ))
            : null}
          {actions.retry ? (
            <Button
              type="button"
              variant="primary"
              loading={settleMutation.isPending}
              disabled={pending}
              onClick={() => settleMutation.mutate({ method: failure.method })}
            >
              Thử lại
            </Button>
          ) : null}
        </>
      )
    }
    if (view.name === 'cancel-confirm') {
      return (
        <>
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => setView({ name: 'failed' })}
          >
            Không hủy
          </Button>
          <Button type="button" variant="danger" loading={cancelMutation.isPending} onClick={() => cancelMutation.mutate()}>
            Xác nhận hủy
          </Button>
        </>
      )
    }
    // done
    return (
      <>
        {closeButton}
        <Button
          type="button"
          variant="secondary"
          icon={<Printer {...actionIconProps} />}
          onClick={() => created && onPrint(created.items.map((line) => line.detailId))}
        >
          In phiếu
        </Button>
        <Button
          type="button"
          variant="primary"
          icon={<ForkKnife {...actionIconProps} />}
          onClick={() => resetOrder(true)}
        >
          Gọi món tiếp
        </Button>
      </>
    )
  }

  const body =
    view.name === 'compose'
      ? renderCompose()
      : view.name === 'confirm'
        ? renderConfirm(view.method)
        : view.name === 'failed' && failure
          ? renderFailed(failure)
          : view.name === 'cancel-confirm'
            ? (
                <div className="order-confirm-stack">
                  <InlineAlert tone="warning">
                    Hủy các dòng vừa tạo (chưa thu tiền). Chỉ hủy khi chắc chắn máy chủ chưa ghi phiếu — kết quả
                    mơ hồ thì nút này đã bị khóa.
                  </InlineAlert>
                  {renderSummary()}
                </div>
              )
            : done
              ? renderDone(done)
              : null

  return (
    <Dialog
      open={open}
      title="Đơn hàng"
      size={view.name === 'compose' ? 'lg' : 'md'}
      onClose={close}
      footer={renderFooter()}
    >
      {body}
    </Dialog>
  )
}
