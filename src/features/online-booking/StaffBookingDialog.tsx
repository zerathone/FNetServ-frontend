import { useEffect, useMemo, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Clock, Desktop, Phone, User, X, XCircle } from '@phosphor-icons/react'
import {
  BOOKING_STEP_MIN,
  createBooking,
  epochSeconds,
  quoteBooking,
  type BoardMachine,
  type BoardResponse,
  type QuoteResponse,
} from '../../api/onlineBooking'
import { Button, DatePicker, Dialog, InlineAlert } from '../../design-system/components'
import { foldText } from '../orders/staffOrderModel'
import { describeBookingError, durationOptions, formatDuration, formatMoney } from './onlineBookingModel'

const floorToStep = (minutes: number) => Math.floor(minutes / BOOKING_STEP_MIN) * BOOKING_STEP_MIN

/** Chỉ liệt kê tối đa ngần này máy khớp (bảng có thể 200-400 máy). */
const MACHINE_RESULT_LIMIT = 8

function describeMachine(m: BoardMachine) {
  return `${m.pc} · ${m.machineGroup} · trống ${m.bookableNow?.maxMinutes ?? 0} phút`
}

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

/** Làm tròn lên slot 30 phút gần nhất (HH:00 hoặc HH:30).
 *  Ví dụ: 14:13 → 14:30 | 14:31 → 15:00 | 14:00:00 → 14:00 | 14:00:01 → 14:30 */
function roundUpTo30Min(date: Date): Date {
  const result = new Date(date)
  const minutes = result.getMinutes()
  const seconds = result.getSeconds()
  const ms = result.getMilliseconds()
  const remainder = minutes % 30
  if (remainder === 0 && seconds === 0 && ms === 0) {
    // Đúng khớp boundary, giữ nguyên
  } else {
    result.setMinutes(minutes + (30 - remainder), 0, 0)
  }
  return result
}

export function StaffBookingDialog({ open, board, onClose, onCreated }: StaffBookingDialogProps) {
  const [username, setUsername] = useState('')
  const [phone, setPhone] = useState('')
  const [pc, setPc] = useState('')
  const [pcSearch, setPcSearch] = useState('')
  const [fromValue, setFromValue] = useState('')
  const [minutes, setMinutes] = useState(60)
  const [preview, setPreview] = useState<QuoteResponse | null>(null)

  const maxHours = board?.maxHours ?? 6
  // task OB-R8: sàn dưới mỗi đơn do quán cấu hình (trước đây là hằng số 30 phút).
  const minMinutes = (board?.minHours ?? 1) * 60
  const minLeadMin = board?.minLeadMin ?? 15
  const maxAheadMin = board?.maxAheadMin ?? 1440

  // task OB-R8: KHÔNG còn lọc `pcState === 'off'` ở đây — luật "máy phải tắt" nay phụ thuộc giờ bắt đầu và
  // đã được server tính sẵn vào `available`/`bookableNow` (không nhân đôi luật ở frontend).
  const bookableMachines = useMemo(
    () =>
      (board?.machines ?? [])
        .filter((m) => m.available && m.bookableNow)
        .sort((a, b) => a.pc.localeCompare(b.pc, 'vi', { numeric: true })),
    [board],
  )
  const matchedMachines = useMemo(() => {
    const needle = foldText(pcSearch)
    if (!needle) return bookableMachines
    return bookableMachines.filter((m) => foldText(`${m.pc} ${m.machineGroup}`).includes(needle))
  }, [bookableMachines, pcSearch])
  // Máy đã chọn nhưng giữa chừng không còn tắt/trống (bảng làm mới) ⇒ coi như chưa chọn, tag biến mất.
  const selectedMachine = useMemo(() => bookableMachines.find((m) => m.pc === pc), [bookableMachines, pc])
  // Thời lượng tối đa chọn được: trần cấu hình (max_hours) và phần còn trống của máy đã chọn, tròn xuống bước 30'.
  const maxMinutesForMachine = Math.min(
    maxHours * 60,
    selectedMachine?.bookableNow ? floorToStep(selectedMachine.bookableNow.maxMinutes) : Infinity,
  )

  const minFrom = useMemo(() => toDatetimeLocal(new Date(Date.now() + minLeadMin * 60_000)), [minLeadMin])
  const maxFrom = useMemo(() => toDatetimeLocal(new Date(Date.now() + maxAheadMin * 60_000)), [maxAheadMin])
  // Giá trị mặc định khi mở form: slot 30p kế tiếp thỏa minLeadMin (HH:00 hoặc HH:30)
  const defaultFrom = useMemo(
    () => toDatetimeLocal(roundUpTo30Min(new Date(Date.now() + minLeadMin * 60_000))),
    [minLeadMin],
  )

  useEffect(() => {
    if (!open) return
    setUsername('')
    setPhone('')
    setPc('')
    setPcSearch('')
    setFromValue(defaultFrom)
    setMinutes(Math.max(60, minMinutes))  // task OB-R8: không mở form với thời lượng dưới sàn của quán
    setPreview(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ reset lúc mở dialog
  }, [open])

  const resetPreview = () => setPreview(null)

  const payload = useMemo(() => {
    const fromDate = fromValue ? new Date(fromValue) : null
    if (!fromDate || Number.isNaN(fromDate.getTime())) return null
    return { username: username.trim(), phone: phone.trim(), pc, from: epochSeconds(fromDate), minutes }
  }, [username, phone, pc, fromValue, minutes])

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
    Boolean(payload) &&
    username.trim().length > 0 &&
    phone.trim().length > 0 &&
    Boolean(selectedMachine) &&
    minutes >= minMinutes &&
    minutes <= maxMinutesForMachine

  return (
    <Dialog
      open={open}
      title="Đặt máy"
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
        {/* ── Thông tin hội viên ── */}
        <fieldset className="ob-staff-form__section">
          <legend>Thông tin hội viên</legend>

          {/* Tên đăng nhập */}
          <div className="ds-field ob-staff-form__field ob-staff-form__wide">
            <div className="ds-input-group ob-staff-form__group">
              <label className="ob-staff-form__prefix" htmlFor="ob-username" title="Tên đăng nhập hội viên">
                <User size={18} weight="bold" aria-hidden="true" />
                <span className="ds-visually-hidden">Tên đăng nhập hội viên</span>
              </label>
              <input
                id="ob-username"
                className="ds-input"
                placeholder="Tên đăng nhập *"
                value={username}
                autoFocus
                autoComplete="off"
                onChange={(event) => {
                  setUsername(event.target.value)
                  resetPreview()
                }}
              />
            </div>
          </div>

          {/* Số điện thoại */}
          <div className="ds-field ob-staff-form__field ob-staff-form__wide">
            <div className="ds-input-group ob-staff-form__group">
              <label className="ob-staff-form__prefix" htmlFor="ob-phone" title="Số điện thoại hội viên">
                <Phone size={18} weight="bold" aria-hidden="true" />
                <span className="ds-visually-hidden">Số điện thoại hội viên</span>
              </label>
              <input
                id="ob-phone"
                className="ds-input"
                placeholder="Số điện thoại *"
                value={phone}
                inputMode="tel"
                autoComplete="off"
                onChange={(event) => {
                  setPhone(event.target.value)
                  resetPreview()
                }}
              />
            </div>
            <span className="ds-field__hint">Dùng để xác nhận đúng hội viên — không cần mật khẩu.</span>
          </div>
        </fieldset>

        {/* ── Chi tiết đặt máy ── */}
        <fieldset className="ob-staff-form__section">
          <legend>Chi tiết đặt máy</legend>

          {/* Chọn máy — chiếm cả hàng. Cùng kiểu ô chọn máy của "Gọi món hộ": gõ để lọc, bấm nút máy để chọn,
              máy đã chọn hiện thành tag ngay trong ô nhập (Backspace khi ô trống hoặc bấm × để bỏ chọn). */}
          <div className="ds-field ob-staff-form__field ob-staff-form__wide">
            <div className="ob-pc-row">
            <div className="ds-input-group ds-input-group--search ob-staff-form__group ob-pc-row__field">
              <label className="ob-staff-form__prefix" htmlFor="ob-pc" title="Chọn máy">
                <Desktop size={18} weight="bold" aria-hidden="true" />
                <span className="ds-visually-hidden">Chọn máy</span>
              </label>
              <div className="ds-search-input ob-pc-search">
                {selectedMachine ? (
                  <span className="ob-pc-tag" title={describeMachine(selectedMachine)}>
                    <strong>{selectedMachine.pc}</strong>
                    <span className="ob-pc-tag__meta">{selectedMachine.machineGroup}</span>
                    <button
                      type="button"
                      className="ob-pc-tag__close"
                      aria-label="Bỏ chọn máy"
                      onClick={() => {
                        setPc('')
                        resetPreview()
                      }}
                    >
                      <X size={12} weight="bold" aria-hidden="true" />
                    </button>
                  </span>
                ) : null}
                <input
                  id="ob-pc"
                  className="ds-input"
                  type="search"
                  autoComplete="off"
                  placeholder={selectedMachine ? '' : 'Nhập tên máy hoặc nhóm máy *'}
                  value={pcSearch}
                  onChange={(event) => setPcSearch(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Backspace' && !pcSearch && selectedMachine) {
                      setPc('')
                      resetPreview()
                    }
                  }}
                />
                {pcSearch ? (
                  <button
                    type="button"
                    className="ds-search-input__clear"
                    aria-label="Xóa từ khóa tìm kiếm"
                    title="Xóa từ khóa"
                    onClick={() => setPcSearch('')}
                  >
                    <XCircle size={17} weight="fill" aria-hidden="true" />
                  </button>
                ) : null}
              </div>
            </div>
              <span className="ob-pc-row__count" aria-live="polite">
                <strong>{bookableMachines.length}</strong> máy trống
              </span>
            </div>
            {bookableMachines.length === 0 ? (
              <span className="ds-field__hint">Không có máy nào đang tắt và trống.</span>
            ) : !pcSearch.trim() ? (
              selectedMachine ? null : <span className="ds-field__hint">Gõ tên máy hoặc nhóm máy để chọn.</span>
            ) : matchedMachines.length === 0 ? (
              <span className="ds-field__hint">Không có máy khớp từ khóa.</span>
            ) : (
              <div className="ob-pc-results" role="listbox" aria-label="Kết quả tìm máy">
                {matchedMachines.slice(0, MACHINE_RESULT_LIMIT).map((m) => (
                  <button
                    key={m.pc}
                    type="button"
                    role="option"
                    aria-selected={m.pc === pc}
                    title={describeMachine(m)}
                    className={`ob-pc-chip${m.pc === pc ? ' is-active' : ''}`}
                    onClick={() => {
                      setPc(m.pc)
                      setPcSearch('')
                      // Thời lượng đang chọn vượt phần máy này còn trống ⇒ hạ xuống mức tối đa của máy.
                      setMinutes((current) => Math.min(current, floorToStep(m.bookableNow?.maxMinutes ?? current)))
                      resetPreview()
                    }}
                  >
                    <strong>{m.pc}</strong>
                    <span className="ob-pc-chip__meta">{m.machineGroup}</span>
                    <span className="ob-pc-chip__meta">trống {m.bookableNow?.maxMinutes ?? 0} phút</span>
                  </button>
                ))}
                {matchedMachines.length > MACHINE_RESULT_LIMIT ? (
                  <span className="ds-field__hint">
                    Còn {matchedMachines.length - MACHINE_RESULT_LIMIT} kết quả nữa — gõ thêm để thu hẹp.
                  </span>
                ) : null}
              </div>
            )}
          </div>

          {/* Giờ bắt đầu */}
          <div className="ds-field ob-staff-form__field ob-staff-form__wide">
            <div className="ds-input-group ob-staff-form__group">
              <label className="ob-staff-form__prefix" htmlFor="ob-from" title="Giờ bắt đầu">
                <Clock size={18} weight="bold" aria-hidden="true" />
                <span className="ds-visually-hidden">Giờ bắt đầu</span>
              </label>
              <DatePicker
                id="ob-from"
                value={fromValue}
                showTime
                min={minFrom}
                max={maxFrom}
                onChange={(v) => { setFromValue(v); resetPreview() }}
              />
            </div>
            <span className="ds-field__hint">Không được đặt sát giờ hơn {minLeadMin} phút.</span>
          </div>

          {/* Thời lượng — chọn nhanh theo bước 30 phút (OB-R7), chiếm cả hàng để các nút không dính ô giờ bắt đầu */}
          <div className="ds-field ob-staff-form__field ob-staff-form__wide">
            <span className="ds-field__label" id="ob-duration-label">
              Thời lượng
            </span>
            <div className="ob-duration" role="radiogroup" aria-labelledby="ob-duration-label">
              {/* task OB-R8: danh sách bắt đầu từ `minHours * 60`, không còn từ 30 phút cứng. */}
              {durationOptions(maxMinutesForMachine, BOOKING_STEP_MIN, minMinutes).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={value === minutes}
                  className={`ob-duration__chip${value === minutes ? ' is-active' : ''}`}
                  onClick={() => {
                    setMinutes(value)
                    resetPreview()
                  }}
                >
                  {formatDuration(value)}
                </button>
              ))}
            </div>
            <span className="ds-field__hint">
              Từ {formatDuration(minMinutes)} đến {formatDuration(maxMinutesForMachine)}/đơn, theo bước{' '}
              {BOOKING_STEP_MIN} phút.
            </span>
          </div>
        </fieldset>

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
