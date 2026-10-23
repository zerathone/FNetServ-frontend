import { useState } from 'react'
import { Button, Dialog, InlineAlert } from '../../design-system/components'
import { formatVnd } from '../orders/orderPayModel'
import { isValidBankTid, type QrOrderMeta } from './notificationModel'

type QrManualConfirmDialogProps = {
  order: QrOrderMeta | null
  pending: boolean
  error: string
  onCancel: () => void
  onConfirm: (tid: string) => void
}

// Hộp thoại "Đã nhận được tiền" (tương đương QInputDialog của panel Qt, task 6.3 §5.6.4).
// Mã giao dịch ngân hàng là khóa chống "ăn gian tiền" DUY NHẤT nên thu ngân PHẢI tự nhập từ
// app ngân hàng — không điền sẵn, không đoán. Số tiền chỉ để đối chiếu, server lấy từ đơn.
export function QrManualConfirmDialog({ order, pending, error, onCancel, onConfirm }: QrManualConfirmDialogProps) {
  // Dialog luôn mount nhưng `order` đổi theo lần mở ⇒ remount nội dung qua key để xóa ô nhập.
  return (
    <Dialog
      open={order !== null}
      title="Đã nhận được tiền"
      size="sm"
      onClose={pending ? () => undefined : onCancel}
    >
      {order ? (
        <QrManualConfirmForm
          key={order.orderId}
          order={order}
          pending={pending}
          error={error}
          onCancel={onCancel}
          onConfirm={onConfirm}
        />
      ) : null}
    </Dialog>
  )
}

function QrManualConfirmForm({
  order,
  pending,
  error,
  onCancel,
  onConfirm,
}: Omit<QrManualConfirmDialogProps, 'order'> & { order: QrOrderMeta }) {
  const [tid, setTid] = useState('')
  const trimmed = tid.trim()
  const invalid = trimmed !== '' && !isValidBankTid(trimmed)
  const canSubmit = trimmed !== '' && !invalid && !pending

  // Trường nào thiếu thì BỎ dòng đó (không in "(trống)"): thông báo cũ/đối tác có thể thiếu
  // khóa, và một dòng trống dễ khiến thu ngân tưởng đơn không có tài khoản.
  const rows: Array<[string, string]> = []
  if (order.pcname) rows.push(['Máy', order.pcname])
  if (order.uname) rows.push(['Tài khoản', order.uname])
  if (order.openedAt) rows.push(['Mở lúc', order.openedAt])
  if (order.orderId) rows.push(['Đơn', order.orderId])
  if (order.value > 0) rows.push(['Số tiền', formatVnd(order.value)])

  return (
    <form
      className="qr-confirm"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) onConfirm(trimmed)
      }}
    >
      {rows.length ? (
        <dl className="qr-confirm__summary">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      <label className="ds-field">
        <span className="ds-field__label">Nhập mã giao dịch</span>
        <input
          className="ds-input"
          type="text"
          autoFocus
          autoComplete="off"
          maxLength={50}
          value={tid}
          disabled={pending}
          placeholder="Mã giao dịch trên app ngân hàng"
          aria-invalid={invalid}
          onChange={(event) => setTid(event.target.value)}
        />
      </label>
      {invalid ? (
        <InlineAlert tone="warning">
          Mã giao dịch chỉ gồm chữ, số và các ký tự . _ - (tối đa 50 ký tự).
        </InlineAlert>
      ) : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}

      <div className="qr-confirm__footer">
        <Button type="submit" variant="primary" loading={pending} disabled={!canSubmit}>
          Đồng ý
        </Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={onCancel}>
          Hủy
        </Button>
      </div>
    </form>
  )
}
