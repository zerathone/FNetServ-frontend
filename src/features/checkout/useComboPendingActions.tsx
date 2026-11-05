// Hành động trên "Combo chờ xác nhận" (Đã thu tiền / Từ chối) dùng chung cho trang /combo_sale (ComboPendingPanel) và
// khung "Dịch vụ chờ" ở trang Máy trạm. Tách nguyên văn từ ComboPendingPanel: MONEY-CORE `/orders/combo/accept`
// (idem bắt buộc) và `/orders/combo/reject` — KHÔNG đổi hành vi.
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { acceptComboOrder, rejectComboOrder, type PendingComboOrder } from '../../api/orders'
import { ConfirmAction, InlineAlert } from '../../design-system/components'
import { fingerprintIntent, useIdempotentIntent } from '../../lib/idempotency'
import { invalidateMoneyQueries } from '../../lib/fintechQueries'
import { pushToast } from '../../store/toast'
import '../orders/orders.css'

function formatMoney(value: number) {
  return `${new Intl.NumberFormat('vi-VN').format(value)} đ`
}

type ComboConfirmation =
  | { type: 'accept-combo'; order: PendingComboOrder }
  | { type: 'reject-combo'; order: PendingComboOrder }
  | null

export function useComboPendingActions() {
  const queryClient = useQueryClient()
  const [confirmation, setConfirmation] = useState<ComboConfirmation>(null)
  const comboAcceptIntent = useIdempotentIntent('order-cb-acc')
  const comboRejectIntent = useIdempotentIntent('order-cb-rej')

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
        idem: comboRejectIntent.getKey(fingerprintIntent({ comboCardId: order.comboCardId })),
      }),
    onSuccess: (response) => {
      comboRejectIntent.clearKey()
      setConfirmation(null)
      pushToast(
        response.duplicated ? 'Đơn combo đã được xử lý trước đó.' : 'Đã từ chối đơn combo.',
        response.duplicated ? 'info' : 'success',
      )
      void queryClient.invalidateQueries({ queryKey: ['pending-orders-combo'] })
    },
    onError: (error) => pushToast(error.message, 'error'),
  })

  const pendingMutation = comboAcceptMutation.isPending || comboRejectMutation.isPending

  const closeConfirmation = () => {
    if (pendingMutation) return
    if (confirmation?.type === 'accept-combo') comboAcceptIntent.clearKey()
    if (confirmation?.type === 'reject-combo') comboRejectIntent.clearKey()
    setConfirmation(null)
  }

  const confirmAction = () => {
    if (!confirmation) return
    if (confirmation.type === 'accept-combo') comboAcceptMutation.mutate(confirmation.order)
    else comboRejectMutation.mutate(confirmation.order)
  }

  const askAccept = (order: PendingComboOrder) => setConfirmation({ type: 'accept-combo', order })
  const askReject = (order: PendingComboOrder) => setConfirmation({ type: 'reject-combo', order })

  const dialog = (
    <ConfirmAction
      open={Boolean(confirmation)}
      title={confirmation?.type === 'accept-combo' ? 'Xác nhận đã thu tiền combo?' : 'Từ chối đơn combo?'}
      description={
        confirmation
          ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.comboName}`
          : undefined
      }
      confirmLabel={confirmation?.type === 'accept-combo' ? 'Xác nhận đã thu tiền' : 'Xác nhận hủy'}
      danger={confirmation?.type === 'reject-combo'}
      pending={pendingMutation}
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
      ) : (
        <div className="order-confirm-stack">
          <InlineAlert tone="warning">
            Đơn bị hủy sẽ không sinh phiếu thu và khách không nhận món/combo này.
          </InlineAlert>
        </div>
      )}
    </ConfirmAction>
  )

  return { pendingMutation, askAccept, askReject, dialog }
}
