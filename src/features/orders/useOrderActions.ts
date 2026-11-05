// Logic hành động trên đơn dịch vụ chờ (Chấp nhận / Thanh toán / Cấn trừ / Hủy / đổi số lượng) dùng chung cho
// trang /orders (OrderWorkspace) và khung "Dịch vụ chờ" ở trang Máy trạm. Tách nguyên văn từ OrderWorkspace
// (money-core: dryRun trước, `idem` theo fingerprint, không nest giao dịch) — KHÔNG đổi hành vi.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, RbacDeniedError } from '../../api/client'
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
import { acceptServiceOrder, cancelServiceOrder } from '../../api/orders'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { useAuthStore } from '../../store/auth'
import { pushToast } from '../../store/toast'
import {
  ORDER_RIGHTS,
  acceptedUnpaidDetailIds,
  clampQuantity,
  clearAcceptedVouchers,
  describeInventoryWarnings,
  describeProcessedCount,
  qrAcceptItems,
  qrCancelItems,
  serviceCancelItems,
  serviceItems,
  type AcceptedUnpaidGroup,
  type CancelItem,
  type GroupedOrder,
  type QrGroup,
  type QtyOverrides,
} from './orderQueueModel'
import {
  SERVICE_EXCEPT_RIGHT,
  classifyPayError,
  classifyPayResult,
  dryRunPayload,
  payFingerprint,
  payPayload,
  removeAlert,
  upsertAlert,
  type DeductAlert,
  type DeductRetry,
  type PayMethod,
} from './orderPayModel'
import { useServiceAutoPrint } from './useServiceAutoPrint'

// task orders-qr-qty P5: Chấp nhận / Xác nhận phục vụ KHÔNG còn hộp xác nhận (parity Qt — thu ngân
// bấm liên tục; idem vẫn bắt buộc). Chỉ hủy/từ chối và combo tiền mặt còn hỏi lại.
export type OrderConfirmation =
  // service-payrequest-core: Thanh toán / Cấn trừ LUÔN hỏi lại (tiền thật) và đi qua `dryRun` trước —
  // `preview` là số BE tính lại, hộp xác nhận hiển thị số đó chứ không phải số trên thẻ.
  | { type: 'pay-cash'; order: GroupedOrder; preview: PayRequestDryRunResponse }
  | { type: 'pay-deduct'; order: GroupedOrder; preview: PayRequestDryRunResponse }
  | { type: 'cancel-service'; order: GroupedOrder }
  | { type: 'cancel-qr'; group: QrGroup }
  // Hủy hàng loạt gộp 1 nút: `items` = đơn dịch vụ/QR (`/service/cancel`), `auGroups` = đơn đã duyệt
  // (`/service/clearaccepted`) -- hai endpoint khác nhau nên vẫn gọi riêng, chỉ UI là một.
  // `entryCount` = số thẻ đã chọn (hiện trên tiêu đề), `hasQr` = có thẻ QR (cần tick "hoàn tiền thủ công").
  | {
      type: 'cancel-selected'
      items: CancelItem[]
      auGroups: AcceptedUnpaidGroup[]
      entryCount: number
      hasQr: boolean
    }
  // Đơn ĐÃ DUYỆT còn nợ tiền — `/service/pay` nhánh `fullCore` (task service-pay-fullcore): cũng
  // đi qua `dryRun` trước, `preview` là số BE tính lại (+ số dư ví khi cấn trừ).
  | { type: 'au-pay-cash'; group: AcceptedUnpaidGroup; preview: PayRequestDryRunResponse }
  | { type: 'au-pay-deduct'; group: AcceptedUnpaidGroup; preview: PayRequestDryRunResponse }
  | { type: 'au-clear'; group: AcceptedUnpaidGroup }
  | null

type Options = {
  /** Hủy đơn dịch vụ/QR xong (view dùng để bỏ chọn). */
  onCancelled?: () => void
  /** Hủy hàng loạt đơn đã duyệt xong (view dùng để bỏ chọn). */
  onAcceptedUnpaidBulkCleared?: () => void
}

export function useOrderActions(options: Options = {}) {
  const queryClient = useQueryClient()
  const staffId = useAuthStore((state) => state.staffId)
  // task orders-qr-qty P5: Hủy/Từ chối cần R_DELETE_ORDER (44). Chỉ là UX — backend vẫn chặn.
  const canCancel = useAuthStore((state) => state.hasRight(ORDER_RIGHTS.DELETE_ORDER))
  const cancelTitle = canCancel ? undefined : `Thiếu quyền hủy đơn (${ORDER_RIGHTS.DELETE_ORDER})`
  // service-payrequest-core: chỉ Cấn trừ cần 9224 (Thanh toán tiền mặt thì không — parity Qt). Chỉ là UX.
  const canDeduct = useAuthStore((state) => state.hasRight(SERVICE_EXCEPT_RIGHT))
  const [confirmation, setConfirmation] = useState<OrderConfirmation>(null)
  // task web-print-flows: tự in phiếu sau khi Web duyệt/thu (mặc định tắt, nhớ theo trình duyệt).
  const autoPrint = useServiceAutoPrint()
  const [qtyOverrides, setQtyOverrides] = useState<QtyOverrides>({})
  const serviceIntent = useIdempotentIntent('order-svc')
  const qrIntent = useIdempotentIntent('order-qr')
  const payIntent = useIdempotentIntent('order-pay')
  const acceptedUnpaidPayIntent = useIdempotentIntent('order-au-pay')
  // Banner cố định "đã ghi phiếu cấn trừ nhưng chưa trừ ví" — KHÔNG phải toast tự tắt (KNOWLEDGE §47).
  const [deductAlerts, setDeductAlerts] = useState<DeductAlert[]>([])
  const { onCancelled, onAcceptedUnpaidBulkCleared } = options

  // Thanh toán/hủy đổi luôn "Đơn hoàn thành" -- làm mới chung prefix ['orders-completed'].
  const refreshCompleted = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders-completed'] })
  }
  const refreshAcceptedUnpaid = () => {
    void queryClient.invalidateQueries({ queryKey: ['orders-accepted-unpaid'] })
    refreshCompleted()
  }
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
      if (response.accepted > 0) {
        autoPrint.run([order.serviceDetailId, ...order.children.map((child) => child.serviceDetailId)])
      }
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
      if (response.accepted > 0) autoPrint.run(qrAcceptItems(group).map((item) => item.detailId))
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
      onCancelled?.()
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
      // Chỉ in khi thật sự vừa thu xong (kind 'success'); 'info' = đã xử lý trước đó, không in lại.
      if (outcome.kind === 'success') {
        autoPrint.run(
          retry.endpoint === 'payrequest'
            ? retry.request.items.map((item) => item.detailId)
            : retry.request.vouchers.flatMap((voucher) => voucher.detailIds),
        )
      }
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
    mutationFn: (groups: AcceptedUnpaidGroup[]) =>
      clearAcceptedService({
        staffId: staffId ?? 0,
        vouchers: clearAcceptedVouchers(groups),
        fullCore: true,
      }),
    onSuccess: (response) => {
      setConfirmation(null)
      onAcceptedUnpaidBulkCleared?.()
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

  const pendingMutation =
    serviceMutation.isPending ||
    qrAcceptMutation.isPending ||
    previewMutation.isPending ||
    payMutation.isPending ||
    retryDeductMutation.isPending ||
    cancelMutation.isPending ||
    acceptedUnpaidPreviewMutation.isPending ||
    acceptedUnpaidPayMutation.isPending ||
    acceptedUnpaidClearMutation.isPending ||
    acceptedUnpaidBulkClearMutation.isPending

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
        if (confirmation.items.length > 0) cancelMutation.mutate(confirmation.items)
        if (confirmation.auGroups.length > 0) acceptedUnpaidBulkClearMutation.mutate(confirmation.auGroups)
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
    }
  }

  // Không memo hóa: các hàm đóng gói state của lần render hiện tại (qtyOverrides, confirmation...).
  return {
    staffId,
    canCancel,
    cancelTitle,
    canDeduct,
    autoPrint,
    confirmation,
    setConfirmation,
    closeConfirmation,
    confirmAction,
    qtyOverrides,
    setQuantity,
    deductAlerts,
    setDeductAlerts,
    retryDeductMutation,
    pendingMutation,
    serviceMutation,
    qrAcceptMutation,
    cancelMutation,
    previewMutation,
    acceptedUnpaidPreviewMutation,
    acceptedUnpaidClearMutation,
    refreshServiceQueue,
    refreshAcceptedUnpaid,
  }
}

export type OrderActions = ReturnType<typeof useOrderActions>

export function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}
