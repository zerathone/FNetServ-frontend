import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { cardsApi } from '../../api/cards'
import {
  Button,
  ConfirmAction,
  Dialog,
  InlineAlert,
  MoneyInput,
  Select,
} from '../../design-system/components'
import { pushToast } from '../../store/toast'
import { CredentialOutputDialog } from '../printers/CredentialOutputDialog'
import type { VoucherCredential } from '../printers/credentialPrintModel'

type Props = {
  open: boolean
  onClose: () => void
}

function localDateAfter(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

function localTimeParts() {
  const now = new Date()
  return {
    date: new Intl.DateTimeFormat('en-CA').format(now),
    time: new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now),
  }
}

export function BatchCreateVoucherDialog({ open, onClose }: Props) {
  const queryClient = useQueryClient()
  const [count, setCount] = useState(1)
  const [value, setValue] = useState<number | null>(50_000)
  const [expiry, setExpiry] = useState(() => localDateAfter(365))
  const [note, setNote] = useState('')
  const [walletType, setWalletType] = useState<0 | 1>(0)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [generated, setGenerated] = useState<VoucherCredential[]>([])
  const tomorrow = localDateAfter(1)
  const invalid = count < 1 || count > 1_000 || !value || value <= 0 || expiry < tomorrow || note.length > 40

  const mutation = useMutation({
    retry: false,
    mutationFn: () => {
      if (invalid || value === null) throw new Error('Thông tin tạo thẻ không hợp lệ.')
      return cardsApi.generateCards({
        count,
        value,
        expiry,
        note: note.trim() || undefined,
        walletType,
      })
    },
    onSuccess: (response) => {
      const createdAt = localTimeParts()
      setConfirmOpen(false)
      setGenerated(response.cards.map((card) => ({
        kind: 'voucher',
        ...card,
        walletType: card.walletType === 1 ? 1 : 0,
        createdDate: createdAt.date,
        createdTime: createdAt.time,
      })))
      pushToast(`Đã tạo ${response.count} thẻ. Hãy lưu mã trước khi đóng.`, 'success')
      void queryClient.invalidateQueries({ queryKey: ['cards'] })
    },
    onError: (error: Error) => {
      setConfirmOpen(false)
      pushToast(error.message, 'error')
    },
  })

  const close = () => {
    if (mutation.isPending) return
    setConfirmOpen(false)
    setGenerated([])
    onClose()
  }

  if (generated.length) {
    return (
      <CredentialOutputDialog
        open={open}
        records={generated}
        sourceLabel="Mã thẻ bí mật chỉ được máy chủ trả về trong lần tạo này."
        onClose={close}
      />
    )
  }

  return (
    <>
      <Dialog
        open={open}
        title="Tạo thẻ nạp hàng loạt"
        description="Tạo từ 1 đến 1.000 thẻ, sau đó xuất Text hoặc in POS/A4."
        size="sm"
        onClose={close}
        footer={
          <>
            <Button type="button" variant="secondary" disabled={mutation.isPending} onClick={close}>Hủy</Button>
            <Button type="button" variant="primary" disabled={invalid} onClick={() => setConfirmOpen(true)}>Kiểm tra và tạo {count} thẻ</Button>
          </>
        }
      >
        <div className="card-generate-form">
          <MoneyInput
            label="Mệnh giá"
            value={value}
            onChange={setValue}
            error={value !== null && value <= 0 ? 'Mệnh giá phải lớn hơn 0.' : undefined}
          />
          <label className="ds-field">
            <span className="ds-field__label">Số lượng (1–1.000)</span>
            <input className="ds-input" type="number" min={1} max={1000} value={count} onChange={(event) => setCount(Number(event.target.value))} />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Ngày hết hạn</span>
            <input className="ds-input" type="date" min={tomorrow} value={expiry} onChange={(event) => setExpiry(event.target.value)} />
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Loại ví khi nạp</span>
            <Select value={walletType} onChange={(event) => setWalletType(Number(event.target.value) as 0 | 1)}>
              <option value={0}>Ví chính</option>
              <option value={1}>Ví khuyến mãi</option>
            </Select>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Ghi chú</span>
            <input className="ds-input" maxLength={40} value={note} onChange={(event) => setNote(event.target.value)} />
            <span className="ds-field__hint">{note.length}/40 ký tự</span>
          </label>
          <InlineAlert tone="warning">
            Lệnh tạo thẻ không idempotent. WebUI không tự gửi lại khi lỗi hoặc mất kết nối.
          </InlineAlert>
        </div>
      </Dialog>

      <ConfirmAction
        open={confirmOpen}
        title={`Tạo ${count} thẻ nạp?`}
        description={`Tổng mệnh giá phát hành: ${((value ?? 0) * count).toLocaleString('vi-VN')} đ.`}
        confirmLabel="Xác nhận tạo thẻ"
        pending={mutation.isPending}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => mutation.mutate()}
      >
        <InlineAlert tone="warning">
          Sau khi gửi, không bấm lại nếu chưa biết kết quả. Hãy kiểm tra danh sách thẻ trước khi tạo lại.
        </InlineAlert>
      </ConfirmAction>
    </>
  )
}
