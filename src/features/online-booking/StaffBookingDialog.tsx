import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import {
  createBooking,
  epochSeconds,
  quoteBooking,
  type BoardResponse,
  type QuoteResponse,
} from '../../api/onlineBooking'
import { Button, DatePicker, Dialog, InlineAlert, Select } from '../../design-system/components'
import { describeBookingError, formatMoney } from './onlineBookingModel'

type StaffBookingDialogProps = {
  open: boolean
  board: BoardResponse | undefined
  onClose: () => void
  onCreated: () => void
}

function toDatetimeLocal(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export function StaffBookingDialog({ open, board, onClose, onCreated }: StaffBookingDialogProps) {
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [pc, setPc] = useState('')
  const [fromValue, setFromValue] = useState('')
  const [hours, setHours] = useState(1)
  const [preview, setPreview] = useState<QuoteResponse | null>(null)

  const maxHours = board?.maxHours ?? 6
  const minLeadMin = board?.minLeadMin ?? 15
  const maxAheadMin = board?.maxAheadMin ?? 120

  const bookableMachines = useMemo(
    () => (board?.machines ?? []).filter((m) => m.pcState === 'off' && m.available && m.bookableNow),
    [board],
  )

  const minFrom = useMemo(() => toDatetimeLocal(new Date(Date.now() + minLeadMin * 60_000)), [minLeadMin])
  const maxFrom = useMemo(() => toDatetimeLocal(new Date(Date.now() + maxAheadMin * 60_000)), [maxAheadMin])

  useEffect(() => {
    if (!open) return
    setUsername('')
    setPhone('')
    setPc(bookableMachines[0]?.pc ?? '')
    setFromValue(minFrom)
    setHours(1)
    setPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ reset lúc mở dialog
  }, [open])

  const resetPreview = () => setPreview(null)

  const payload = useMemo(() => {
    const fromDate = fromValue ? new Date(fromValue) : null
    if (!fromDate || Number.isNaN(fromDate.getTime())) return null
    return { username: username.trim(), phone: phone.trim(), pc, from: epochSeconds(fromDate), hours }
  }, [username, phone, pc, fromValue, hours])

  const quoteMutation = useMutation({
    mutationFn: () => {
      if (!payload) throw new Error('Thiếu dữ liệu')
      return quoteBooking(payload)
    },
    onSuccess: (data) => setPreview(data),
    onError: () => setPreview(null),
  })

  const createMutation = useMutation({
    mutationFn: () => {
      if (!payload || !preview) throw new Error('Thiếu dữ liệu')
      return createBooking({ ...payload, expectedTotal: preview.total })
    },
    onSuccess: () => {
      onCreated()
      onClose()
    },
    onError: () => setPreview(null),
  })

  const canQuote =
    Boolean(payload) && username.trim().length > 0 && phone.trim().length > 0 && pc !== '' && hours >= 1 && hours <= maxHours

  return (
    <Dialog
      open={open}
      title="Đặt hộ máy online"
      description="Nhập đúng username + số điện thoại của hội viên. Cả hai phải khớp cùng một tài khoản."
      size="md"
      onClose={createMutation.isPending ? () => undefined : onClose}
      footer={
        <>
          <Button type="button" variant="secondary" disabled={createMutation.isPending} onClick={onClose}>
            Hủy
          </Button>
          {preview ? (
            <Button type="button" variant="primary" loading={createMutation.isPending} onClick={() => createMutation.mutate()}>
              Xác nhận đặt — {formatMoney(preview.total)}
            </Button>
          ) : (
            <Button
              type="button"
              variant="primary"
              disabled={!canQuote}
              loading={quoteMutation.isPending}
              onClick={() => quoteMutation.mutate()}
            >
              Xem trước tổng tiền
            </Button>
          )}
        </>
      }
    >
      <div className="ob-staff-form">
        <label className="ds-field">
          <span className="ds-field__label">Tên đăng nhập hội viên</span>
          <input
            className="ds-input"
            value={username}
            autoFocus
            onChange={(event) => {
              setUsername(event.target.value)
              resetPreview()
            }}
          />
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Số điện thoại hội viên</span>
          <input
            className="ds-input"
            value={phone}
            inputMode="tel"
            onChange={(event) => {
              setPhone(event.target.value)
              resetPreview()
            }}
          />
          <span className="ds-field__hint">Dùng để xác nhận đúng hội viên — không cần mật khẩu.</span>
        </label>
        <label className="ds-field">
          <span className="ds-field__label">Máy</span>
          <Select
            value={pc}
            aria-label="Chọn máy"
            onChange={(event) => {
              setPc(event.target.value)
              resetPreview()
            }}
          >
            {bookableMachines.length === 0 ? <option value="">Không có máy nào đang tắt và còn trống</option> : null}
            {bookableMachines.map((m) => (
              <option key={m.pc} value={m.pc}>
                {m.pc} · {m.machineGroup} · còn trống {m.bookableNow?.maxMinutes ?? 0} phút
              </option>
            ))}
          </Select>
        </label>
        <div className="ob-staff-form__row">
          <label className="ds-field">
            <span className="ds-field__label">Giờ bắt đầu</span>
            <DatePicker value={fromValue} showTime min={minFrom} max={maxFrom} onChange={(v) => { setFromValue(v); resetPreview() }} />
            <span className="ds-field__hint">Không được đặt sát giờ hơn {minLeadMin} phút.</span>
          </label>
          <label className="ds-field">
            <span className="ds-field__label">Số giờ</span>
            <input
              className="ds-input"
              type="number"
              min={1}
              max={maxHours}
              value={hours}
              onChange={(event) => {
                setHours(Number(event.target.value) || 1)
                resetPreview()
              }}
            />
            <span className="ds-field__hint">Tối đa {maxHours} giờ/đơn.</span>
          </label>
        </div>

        {quoteMutation.isError ? <InlineAlert tone="danger">{describeBookingError(quoteMutation.error)}</InlineAlert> : null}
        {createMutation.isError ? <InlineAlert tone="danger">{describeBookingError(createMutation.error)}</InlineAlert> : null}

        {preview ? (
          <InlineAlert tone="info">
            <strong>{preview.memberName}</strong> · {formatMoney(preview.pricePerHour)}/giờ
            {preview.fee > 0 ? ` + phí ${formatMoney(preview.fee)}` : ''} · Tổng <strong>{formatMoney(preview.total)}</strong>
          </InlineAlert>
        ) : null}
      </div>
    </Dialog>
  )
}
