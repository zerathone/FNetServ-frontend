// Hộp xác nhận cho mọi hành động tiền trên đơn dịch vụ chờ (Thanh toán / Cấn trừ / Hủy / Từ chối). Tách nguyên văn từ
// OrderWorkspace để khung "Dịch vụ chờ" ở trang Máy trạm dùng đúng cùng hộp — số hiển thị là số BE tính lại (dryRun).
import { useEffect, useState } from 'react'
import { ConfirmAction, InlineAlert } from '../../design-system/components'
import { getServicePaidLabel, type PendingOrder } from '../../api/orders'
import { orderAmount, quantityOf } from './orderQueueModel'
import { formatMoney, type OrderActions } from './useOrderActions'
import './orders.css'
import './staffOrder.css'

const QR_CANCEL_WARNING =
  'Khách đã chuyển khoản. Hệ thống chỉ đánh dấu phiếu đã hủy, KHÔNG hoàn tiền — phải hoàn tiền thủ công cho khách.'

type ConfirmLine = { key: number; name: string; quantity: number }

// Hộp xác nhận: luôn liệt kê TÊN từng món × số lượng (không ghi chung chung "N dòng").
function ConfirmItems({ lines }: { lines: ConfirmLine[] }) {
  return (
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
}

const ofLine = (line: PendingOrder, name = line.serviceName): ConfirmLine => ({
  key: line.serviceDetailId,
  name,
  quantity: line.quantity,
})

export function OrderConfirmDialog({ actions }: { actions: OrderActions }) {
  const { confirmation, qtyOverrides, pendingMutation } = actions
  const [qrCancelAck, setQrCancelAck] = useState(false)

  useEffect(() => {
    setQrCancelAck(false)
  }, [confirmation])

  // Danh sách món (tên × SL) hiện trong các hộp xác nhận hủy/từ chối đơn dịch vụ.
  const cancelLines: ConfirmLine[] | null = (() => {
    if (!confirmation) return null
    switch (confirmation.type) {
      case 'cancel-service':
        return [confirmation.order, ...confirmation.order.children].map((line) =>
          ofLine(line, line === confirmation.order ? line.serviceName : `+ ${line.serviceName}`),
        )
      case 'cancel-qr':
      case 'au-clear':
        return confirmation.group.lines.map((line) => ofLine(line))
      case 'cancel-selected':
        return [
          ...confirmation.items.map((item) => ({
            key: item.id,
            name: item.serviceName,
            quantity: item.quantity,
          })),
          ...confirmation.auGroups.flatMap((group) => group.lines.map((line) => ofLine(line))),
        ]
      default:
        return null
    }
  })()
  const confirmNeedsQrAck =
    confirmation?.type === 'cancel-qr' || (confirmation?.type === 'cancel-selected' && confirmation.hasQr)

  return (
    <ConfirmAction
      open={Boolean(confirmation)}
      title={
        confirmation?.type === 'pay-cash'
          ? 'Xác nhận đã thu tiền mặt?'
          : confirmation?.type === 'pay-deduct'
            ? 'Cấn trừ vào tài khoản hội viên?'
            : confirmation?.type === 'cancel-qr'
              ? `Hủy đơn đã trả QR #${confirmation.group.voucherId}?`
              : confirmation?.type === 'cancel-selected'
                ? `Hủy ${confirmation.entryCount} đơn đã chọn?`
                : confirmation?.type === 'au-pay-cash'
                  ? 'Xác nhận đã thu tiền mặt?'
                  : confirmation?.type === 'au-pay-deduct'
                    ? 'Cấn trừ vào tài khoản hội viên?'
                    : confirmation?.type === 'au-clear'
                      ? `Hủy phiếu #${confirmation.group.voucherId}?`
                      : 'Từ chối đơn dịch vụ?'
      }
      description={
        confirmation?.type === 'cancel-service' ||
        confirmation?.type === 'pay-cash' ||
        confirmation?.type === 'pay-deduct'
          ? `${confirmation.order.hostName || 'Chưa xác định máy'} · ${confirmation.order.userName || 'Khách vãng lai'}`
          : confirmation?.type === 'cancel-qr'
            ? `${confirmation.group.hostName || 'Chưa xác định máy'} · ${confirmation.group.userName || 'Khách vãng lai'}`
            : confirmation?.type === 'au-pay-cash' ||
                confirmation?.type === 'au-pay-deduct' ||
                confirmation?.type === 'au-clear'
              ? `${confirmation.group.hostName || 'Chưa xác định máy'} · ${confirmation.group.userName || 'Khách vãng lai'}`
              : undefined
      }
      confirmLabel={
        confirmation?.type === 'pay-cash' || confirmation?.type === 'au-pay-cash'
          ? 'Đã thu tiền mặt'
          : confirmation?.type === 'pay-deduct' || confirmation?.type === 'au-pay-deduct'
            ? 'Cấn trừ'
            : 'Xác nhận hủy'
      }
      danger={
        confirmation?.type === 'cancel-service' ||
        confirmation?.type === 'cancel-qr' ||
        confirmation?.type === 'cancel-selected' ||
        confirmation?.type === 'au-clear'
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
      onCancel={actions.closeConfirmation}
      onConfirm={actions.confirmAction}
    >
      {confirmation?.type === 'pay-cash' || confirmation?.type === 'pay-deduct' ? (
        <div className="order-confirm-stack">
          {confirmation.preview.ok === false ? (
            <InlineAlert tone="danger">{confirmation.preview.message || 'Không thực hiện được.'}</InlineAlert>
          ) : confirmation.type === 'pay-cash' ? (
            <InlineAlert tone="warning">Chỉ xác nhận sau khi đã nhận đủ tiền mặt.</InlineAlert>
          ) : (
            <InlineAlert tone="warning">
              Trừ trực tiếp vào tài khoản chính của hội viên đang online tại máy này. Không hoàn tác được từ trang này.
            </InlineAlert>
          )}
          <dl className="order-confirm-summary">
            <ConfirmItems
              lines={[confirmation.order, ...confirmation.order.children].map((line) => ({
                key: line.serviceDetailId,
                name: line === confirmation.order ? line.serviceName : `+ ${line.serviceName}`,
                quantity: quantityOf(line, qtyOverrides),
              }))}
            />
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
      ) : confirmation?.type === 'au-pay-cash' || confirmation?.type === 'au-pay-deduct' ? (
        // task service-pay-fullcore: số trong hộp là số BE tính lại qua `dryRun` (`/service/pay`).
        <div className="order-confirm-stack">
          {confirmation.preview.ok === false ? (
            <InlineAlert tone="danger">{confirmation.preview.message || 'Không thực hiện được.'}</InlineAlert>
          ) : (
            <InlineAlert tone="warning">
              {confirmation.type === 'au-pay-cash'
                ? 'Chỉ xác nhận sau khi đã nhận đủ tiền mặt.'
                : 'Trừ trực tiếp vào tài khoản chính của hội viên đang online tại máy này. Không hoàn tác được từ trang này.'}
            </InlineAlert>
          )}
          <dl className="order-confirm-summary">
            <div><dt>Phiếu</dt><dd>#{confirmation.group.voucherId}</dd></div>
            <ConfirmItems
              lines={confirmation.group.lines.map((line) => ({
                key: line.serviceDetailId,
                name: line.serviceName,
                quantity: line.quantity,
              }))}
            />
            <div>
              <dt>{confirmation.type === 'au-pay-cash' ? 'Cần thu' : 'Tổng phí cấn trừ'}</dt>
              <dd>
                {formatMoney(
                  typeof confirmation.preview.total === 'number' ? confirmation.preview.total : confirmation.group.total,
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
          {cancelLines ? (
            <dl className="order-confirm-summary">
              <ConfirmItems lines={cancelLines} />
            </dl>
          ) : null}
          <InlineAlert tone="danger">{QR_CANCEL_WARNING}</InlineAlert>
          <label className="order-confirm-ack">
            <input type="checkbox" checked={qrCancelAck} onChange={(event) => setQrCancelAck(event.target.checked)} />
            Tôi hiểu: phải hoàn tiền thủ công cho khách.
          </label>
        </div>
      ) : (
        <div className="order-confirm-stack">
          {cancelLines ? (
            <dl className="order-confirm-summary">
              <ConfirmItems lines={cancelLines} />
            </dl>
          ) : null}
          <InlineAlert tone="warning">
            Đơn bị hủy sẽ không sinh phiếu thu và khách không nhận món/combo này.
          </InlineAlert>
        </div>
      )}
    </ConfirmAction>
  )
}
